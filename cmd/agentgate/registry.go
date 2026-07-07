package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/siygle/agentgate/internal/crypto"
)

// encBlob is an AES-256-GCM ciphertext bundle (base64 fields), matching the
// on-wire encrypted_data shape. In the registry it holds a per-share passphrase
// encrypted under the master passphrase.
type encBlob struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Salt       string `json:"salt"`
}

// shareRecord is one entry in the local owner registry (~/.agentgate/shares.json).
// It records the metadata needed to list and manage shares this machine created.
// The owner token is stored in plaintext (it cannot decrypt content, and it is
// already part of the manage URL the user keeps); only the passphrase — which
// CAN decrypt content — is encrypted, under the master passphrase.
type shareRecord struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`    // "diff" | "files" — selects the API endpoint
	Display       string   `json:"display"` // "diff|files|app|plan|docs" — label / pretty URL
	Title         string   `json:"title,omitempty"`
	Server        string   `json:"server,omitempty"` // resolved server base, for refresh/rekey
	PreviewURL    string   `json:"preview_url"`
	ManageURL     string   `json:"manage_url,omitempty"`
	OwnerToken    string   `json:"owner_token,omitempty"`
	PassphraseEnc *encBlob `json:"passphrase_enc,omitempty"` // omitted when no master available
	NeverExpires  bool     `json:"never_expires"`
	ExpiresAt     string   `json:"expires_at,omitempty"`
	CreatedAt     string   `json:"created_at"`

	// Status is a runtime-only field populated by `list --refresh`; never stored.
	Status string `json:"-"`
}

// registryPath returns ~/.agentgate/shares.json.
func registryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".agentgate", "shares.json"), nil
}

// loadRegistry reads all records, returning an empty slice when the file does
// not exist yet.
func loadRegistry() ([]shareRecord, error) {
	p, err := registryPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []shareRecord{}, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return []shareRecord{}, nil
	}
	var recs []shareRecord
	if err := json.Unmarshal(data, &recs); err != nil {
		return nil, fmt.Errorf("parse registry %s: %w", p, err)
	}
	return recs, nil
}

// saveRegistry writes records atomically with tight permissions (dir 0700,
// file 0600).
func saveRegistry(recs []shareRecord) error {
	p, err := registryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(recs, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// upsertRecord inserts rec, or replaces an existing record with the same ID.
func upsertRecord(rec shareRecord) error {
	recs, err := loadRegistry()
	if err != nil {
		return err
	}
	for i := range recs {
		if recs[i].ID == rec.ID {
			recs[i] = rec
			return saveRegistry(recs)
		}
	}
	recs = append(recs, rec)
	return saveRegistry(recs)
}

// findRecord returns a copy of the record with the given ID, plus ok.
func findRecord(id string) (shareRecord, bool, error) {
	recs, err := loadRegistry()
	if err != nil {
		return shareRecord{}, false, err
	}
	for _, r := range recs {
		if r.ID == id {
			return r, true, nil
		}
	}
	return shareRecord{}, false, nil
}

// encryptPassphrase encrypts a per-share passphrase under the master passphrase.
func encryptPassphrase(passphrase, master string) (*encBlob, error) {
	ct, iv, salt, err := crypto.Encrypt(passphrase, master)
	if err != nil {
		return nil, err
	}
	return &encBlob{Ciphertext: ct, IV: iv, Salt: salt}, nil
}

// decryptPassphrase recovers a per-share passphrase using the master passphrase.
func decryptPassphrase(b *encBlob, master string) (string, error) {
	if b == nil {
		return "", fmt.Errorf("no stored passphrase")
	}
	return crypto.Decrypt(b.Ciphertext, b.IV, b.Salt, master)
}

// resolveMaster resolves the master passphrase from flag, then the
// AGENTGATE_MASTER_PASSPHRASE env var. When required and neither is set, it
// prompts interactively (no echo). When not required, it returns "" if unset.
func resolveMaster(flag string, required bool) (string, error) {
	if flag != "" {
		return flag, nil
	}
	if env := os.Getenv("AGENTGATE_MASTER_PASSPHRASE"); env != "" {
		return env, nil
	}
	if !required {
		return "", nil
	}
	m, err := readSecret("Master passphrase: ")
	if err != nil {
		return "", err
	}
	if m == "" {
		return "", fmt.Errorf("master passphrase required (set -m or AGENTGATE_MASTER_PASSPHRASE)")
	}
	return m, nil
}

// readSecret prompts on stderr and reads a line from stdin without echoing it,
// using stty when stdin is a terminal. Falls back to a normal (echoed) read on
// non-terminals so piped input still works.
func readSecret(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)

	disable := exec.Command("stty", "-echo")
	disable.Stdin = os.Stdin
	echoDisabled := disable.Run() == nil

	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')

	if echoDisabled {
		enable := exec.Command("stty", "echo")
		enable.Stdin = os.Stdin
		_ = enable.Run()
		fmt.Fprintln(os.Stderr)
	}
	if err != nil && err != io.EOF {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}
