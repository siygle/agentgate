package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/siygle/agentgate/internal/crypto"
)

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

func runList(args []string) {
	var masterFlag, serverFlag string
	var showSecrets, refresh bool
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-m", "--master":
			if i+1 < len(args) {
				masterFlag = args[i+1]
				i++
			}
		case "-s":
			if i+1 < len(args) {
				serverFlag = args[i+1]
				i++
			}
		case "--show-secrets":
			showSecrets = true
		case "--refresh":
			refresh = true
		}
	}

	recs, err := loadRegistry()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading registry: %v\n", err)
		os.Exit(1)
	}
	if len(recs) == 0 {
		fmt.Println("No shares recorded yet. Create one (e.g. `agentgate files ...`) and it will appear here.")
		return
	}

	if refresh {
		changed := refreshRecords(recs, serverFlag)
		if changed {
			if err := saveRegistry(recs); err != nil {
				fmt.Fprintf(os.Stderr, "warning: could not persist refreshed registry: %v\n", err)
			}
		}
	}

	var master string
	if showSecrets {
		master, err = resolveMaster(masterFlag, true)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}

	if showSecrets {
		printListDetailed(recs, master)
		return
	}
	printListTable(recs)
}

// printListTable prints a compact aligned overview.
func printListTable(recs []shareRecord) {
	tw := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, "TYPE\tTITLE\tEXPIRES\tPREVIEW")
	for _, r := range recs {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
			r.Display, truncate(r.Title, 28), expiryLabel(r), r.PreviewURL)
	}
	tw.Flush()
	fmt.Println("\nUse --show-secrets to reveal manage URLs and passphrases (needs the master passphrase).")
}

// printListDetailed prints a block per record including manage URL and the
// decrypted passphrase.
func printListDetailed(recs []shareRecord, master string) {
	for i, r := range recs {
		if i > 0 {
			fmt.Println()
		}
		title := r.Title
		if title == "" {
			title = "(untitled)"
		}
		fmt.Printf("[%s] %s\n", r.Display, title)
		fmt.Printf("  id:         %s\n", r.ID)
		fmt.Printf("  preview:    %s\n", r.PreviewURL)
		if r.ManageURL != "" {
			fmt.Printf("  manage:     %s\n", r.ManageURL)
		}
		fmt.Printf("  passphrase: %s\n", passphraseLabel(r, master))
		fmt.Printf("  expires:    %s\n", expiryLabel(r))
		if r.Status != "" {
			fmt.Printf("  status:     %s\n", r.Status)
		}
	}
}

func passphraseLabel(r shareRecord, master string) string {
	if r.PassphraseEnc == nil {
		return "(not stored)"
	}
	pass, err := decryptPassphrase(r.PassphraseEnc, master)
	if err != nil {
		return "(unlock failed — wrong master passphrase?)"
	}
	return pass
}

func expiryLabel(r shareRecord) string {
	if r.Status == "gone" {
		return "gone"
	}
	if r.NeverExpires {
		return "never"
	}
	if r.ExpiresAt == "" {
		return "unknown"
	}
	return r.ExpiresAt
}

// refreshRecords queries each share's live status via GET and updates expiry
// fields in place. Returns whether any record changed.
func refreshRecords(recs []shareRecord, serverFlag string) bool {
	changed := false
	for i := range recs {
		base := apiBase(&recs[i], serverFlag)
		if base == "" {
			recs[i].Status = "unknown (no server)"
			continue
		}
		endpoint := strings.TrimRight(base, "/") + "/api/" + recs[i].Kind + "/" + recs[i].ID
		resp, err := cliHTTPClient.Get(endpoint)
		if err != nil {
			recs[i].Status = "unreachable"
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			recs[i].Status = "gone"
			continue
		}
		if resp.StatusCode != http.StatusOK {
			recs[i].Status = fmt.Sprintf("http %d", resp.StatusCode)
			continue
		}
		var gr struct {
			Success bool `json:"success"`
			Data    struct {
				NeverExpires bool   `json:"never_expires"`
				ExpiresAt    string `json:"expires_at"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &gr); err == nil && gr.Success {
			if recs[i].NeverExpires != gr.Data.NeverExpires || recs[i].ExpiresAt != gr.Data.ExpiresAt {
				recs[i].NeverExpires = gr.Data.NeverExpires
				recs[i].ExpiresAt = gr.Data.ExpiresAt
				changed = true
			}
			recs[i].Status = "active"
		} else {
			recs[i].Status = "active"
		}
	}
	return changed
}

// ---------------------------------------------------------------------------
// rekey (reset passphrase)
// ---------------------------------------------------------------------------

func runRekey(args []string) {
	var serverFlag, newPassFlag, masterFlag, oldPassFlag, ownerTokenFlag string
	var rest []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-s":
			if i+1 < len(args) {
				serverFlag = args[i+1]
				i++
			}
		case "-p":
			if i+1 < len(args) {
				newPassFlag = args[i+1]
				i++
			}
		case "-m", "--master":
			if i+1 < len(args) {
				masterFlag = args[i+1]
				i++
			}
		case "--old-passphrase":
			if i+1 < len(args) {
				oldPassFlag = args[i+1]
				i++
			}
		case "--owner-token":
			if i+1 < len(args) {
				ownerTokenFlag = args[i+1]
				i++
			}
		default:
			rest = append(rest, args[i])
		}
	}

	if len(rest) != 1 {
		fmt.Fprintln(os.Stderr, "usage: agentgate rekey [-s server] [-p newpass] [-m master] <id|url>")
		os.Exit(1)
	}
	ref := rest[0]

	id, kindFromURL, ownerFromURL, serverFromURL := parseShareRef(ref)
	if id == "" {
		fmt.Fprintln(os.Stderr, "error: could not determine share id from argument")
		os.Exit(1)
	}

	rec, haveRec, err := findRecord(id)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading registry: %v\n", err)
		os.Exit(1)
	}

	// Resolve kind (may still be empty for /s/{id} URLs not in the local registry;
	// fetchShareForRekey resolves it via GET /api/share/{id}).
	kind := kindFromURL
	if kind == "" && haveRec {
		kind = rec.Kind
	}

	// Resolve server.
	server := serverFlag
	if server == "" && haveRec {
		server = rec.Server
	}
	if server == "" {
		server = serverFromURL
	}
	server, err = resolveServer(server)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	// Resolve owner token.
	ownerToken := ownerTokenFlag
	if ownerToken == "" {
		ownerToken = ownerFromURL
	}
	if ownerToken == "" && haveRec {
		ownerToken = rec.OwnerToken
	}
	if ownerToken == "" {
		fmt.Fprintln(os.Stderr, "error: owner token required (pass the manage URL, --owner-token, or have it in the registry)")
		os.Exit(1)
	}

	// Resolve old passphrase: flag > registry (needs master) > AGENTGATE_PASSPHRASE.
	oldPass := oldPassFlag
	if oldPass == "" && haveRec && rec.PassphraseEnc != nil {
		master, merr := resolveMaster(masterFlag, true)
		if merr != nil {
			fmt.Fprintln(os.Stderr, merr)
			os.Exit(1)
		}
		p, derr := decryptPassphrase(rec.PassphraseEnc, master)
		if derr != nil {
			fmt.Fprintln(os.Stderr, "error: could not decrypt stored passphrase (wrong master passphrase?)")
			os.Exit(1)
		}
		oldPass = p
		masterFlag = master // reuse below for re-storing
	}
	if oldPass == "" {
		if env := os.Getenv("AGENTGATE_PASSPHRASE"); env != "" {
			oldPass = env
		}
	}
	if oldPass == "" {
		p, rerr := readSecret("Current passphrase: ")
		if rerr != nil {
			fmt.Fprintln(os.Stderr, rerr)
			os.Exit(1)
		}
		oldPass = p
	}
	if oldPass == "" {
		fmt.Fprintln(os.Stderr, "error: current passphrase required to re-encrypt content")
		os.Exit(1)
	}

	// Resolve new passphrase.
	newPass := newPassFlag
	if newPass == "" {
		p, rerr := readSecret("New passphrase: ")
		if rerr != nil {
			fmt.Fprintln(os.Stderr, rerr)
			os.Exit(1)
		}
		newPass = p
	}
	if newPass == "" {
		fmt.Fprintln(os.Stderr, "error: new passphrase required")
		os.Exit(1)
	}

	// 1) Fetch current ciphertext (and auto-resolve kind for /s/{id} shares).
	resolvedKind, rawEnc, err := fetchShareForRekey(cliHTTPClient, server, kind, id)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	kind = resolvedKind

	// 2-3) Re-key locally (supports both v1 blobs and v2 recovery-capable envelopes).
	newEnc, err := rekeyEncryptedData(rawEnc, oldPass, newPass)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	// 4) PUT the new ciphertext (owner-token authenticated).
	base := strings.TrimRight(server, "/")
	putURL := base + "/api/" + kind + "/" + id
	putBody, _ := json.Marshal(map[string]any{"encrypted_data": newEnc})
	req, err := http.NewRequest(http.MethodPut, putURL, bytes.NewReader(putBody))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error building request: %v\n", err)
		os.Exit(1)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ownerToken)
	putResp, err := cliHTTPClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error sending update: %v\n", err)
		os.Exit(1)
	}
	putRespBody, _ := io.ReadAll(putResp.Body)
	putResp.Body.Close()
	if putResp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "error: server rejected the update (http %d): %s\n", putResp.StatusCode, string(putRespBody))
		os.Exit(1)
	}

	fmt.Printf("Re-keyed %s — the passphrase has been reset. The link and owner token are unchanged.\n", id)
	fmt.Println("The old passphrase no longer decrypts this share.")

	// 5) Update the registry entry's stored passphrase (best-effort).
	if haveRec {
		master := masterFlag
		if master == "" {
			master, _ = resolveMaster("", false)
		}
		if master != "" {
			if blob, err := encryptPassphrase(newPass, master); err == nil {
				rec.PassphraseEnc = blob
				if err := upsertRecord(rec); err != nil {
					fmt.Fprintf(os.Stderr, "warning: re-key succeeded but could not update local registry: %v\n", err)
				}
			}
		}
	}
}

// fetchShareForRekey retrieves a share's encrypted_data and resolves its kind.
// When kind is empty (e.g. a /s/{id} URL not in the local registry), it queries
// the kind-agnostic /api/share/{id} endpoint.
func fetchShareForRekey(client *http.Client, server, kind, id string) (string, json.RawMessage, error) {
	base := strings.TrimRight(server, "/")
	endpoint := base + "/api/share/" + id
	if kind != "" {
		endpoint = base + "/api/" + kind + "/" + id
	}
	resp, err := client.Get(endpoint)
	if err != nil {
		return "", nil, fmt.Errorf("fetching share: %w", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("share not found or unavailable (http %d)", resp.StatusCode)
	}
	var gr struct {
		Success bool `json:"success"`
		Data    struct {
			Kind          string          `json:"kind"`
			EncryptedData json.RawMessage `json:"encrypted_data"`
		} `json:"data"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &gr); err != nil || !gr.Success || len(gr.Data.EncryptedData) == 0 {
		return "", nil, fmt.Errorf("unexpected server response: %s", string(body))
	}
	resolvedKind := kind
	if resolvedKind == "" {
		resolvedKind = gr.Data.Kind
	}
	if resolvedKind == "" {
		return "", nil, fmt.Errorf("server did not report share kind")
	}
	return resolvedKind, gr.Data.EncryptedData, nil
}

// rekeyEncryptedData rotates a share's passphrase locally. For v2 envelopes it
// unwraps the DEK with oldPass and re-wraps it under newPass, keeping ciphertext,
// iv, and wrap_recov intact; for v1 blobs it decrypts and re-encrypts.
func rekeyEncryptedData(raw json.RawMessage, oldPass, newPass string) (any, error) {
	var env crypto.Envelope
	if err := json.Unmarshal(raw, &env); err == nil && env.V == 2 && env.WrapPass != "" {
		dek, err := crypto.UnwrapDEKPassphrase(env, oldPass)
		if err != nil {
			return nil, fmt.Errorf("could not decrypt with the current passphrase — nothing was changed")
		}
		salt, ivP, wrapPass, err := crypto.WrapDEKPassphrase(dek, newPass)
		if err != nil {
			return nil, fmt.Errorf("re-wrapping content key: %w", err)
		}
		env.Salt = salt
		env.IVP = ivP
		env.WrapPass = wrapPass
		return env, nil
	}

	var blob encBlob
	if err := json.Unmarshal(raw, &blob); err != nil || blob.Ciphertext == "" {
		return nil, fmt.Errorf("unrecognized encrypted_data format")
	}
	plaintext, err := crypto.Decrypt(blob.Ciphertext, blob.IV, blob.Salt, oldPass)
	if err != nil {
		return nil, fmt.Errorf("could not decrypt with the current passphrase — nothing was changed")
	}
	ct, iv, salt, err := crypto.Encrypt(plaintext, newPass)
	if err != nil {
		return nil, fmt.Errorf("re-encrypting: %w", err)
	}
	return map[string]string{"ciphertext": ct, "iv": iv, "salt": salt}, nil
}

// ---------------------------------------------------------------------------
// recovery-keygen
// ---------------------------------------------------------------------------

// buildRecoveryKeygen creates a recovery keypair. It returns the base64 public
// key (for AGENTGATE_RECOVERY_PUBKEY) and the private-key file contents. When
// protectPass is non-empty the private key is encrypted under it (JSON blob);
// otherwise the raw base64 scalar is returned.
func buildRecoveryKeygen(protectPass string) (pubB64, privFile string, err error) {
	priv, pub, err := crypto.GenerateRecoveryKey()
	if err != nil {
		return "", "", err
	}
	if protectPass == "" {
		return pub, priv, nil
	}
	ct, iv, salt, err := crypto.Encrypt(priv, protectPass)
	if err != nil {
		return "", "", err
	}
	blob, err := json.Marshal(map[string]any{
		"enc": map[string]string{"ciphertext": ct, "iv": iv, "salt": salt},
	})
	if err != nil {
		return "", "", err
	}
	return pub, string(blob), nil
}

// runRecoveryKeygen is the `agentgate recovery-keygen [-o file] [-p passphrase]`
// entrypoint. The public key goes to stdout; the private key is written to the
// -o path (or stdout with a warning) and MUST be stored offline.
func runRecoveryKeygen(args []string) {
	fs := flag.NewFlagSet("recovery-keygen", flag.ExitOnError)
	out := fs.String("o", "", "write the private key to this file (recommended)")
	protect := fs.String("p", "", "encrypt the private key at rest under this passphrase")
	_ = fs.Parse(args)

	pub, privFile, err := buildRecoveryKeygen(*protect)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error generating recovery key: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("Recovery PUBLIC key (set as AGENTGATE_RECOVERY_PUBKEY on your uploader):")
	fmt.Println(pub)
	if *out != "" {
		if err := os.WriteFile(*out, []byte(privFile+"\n"), 0o600); err != nil {
			fmt.Fprintf(os.Stderr, "error writing private key: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "\nPrivate key written to %s (mode 0600). Store it OFFLINE — it can recover every v2 share.\n", *out)
	} else {
		fmt.Println("\nRecovery PRIVATE key (store OFFLINE; never put on a server):")
		fmt.Println(privFile)
	}
	fmt.Fprintln(os.Stderr, "\n⚠️  Do NOT set AGENTGATE_RECOVERY_PUBKEY until your AgentGate server AND web")
	fmt.Fprintln(os.Stderr, "    viewer both support v2 envelopes. Setting it against an older server")
	fmt.Fprintln(os.Stderr, "    causes SILENT, UNRECOVERABLE data loss (the wrapped key is dropped and")
	fmt.Fprintln(os.Stderr, "    the share can never be decrypted). Enable it only after the v2 server")
	fmt.Fprintln(os.Stderr, "    and viewer are deployed.")
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// parseShareRef extracts the id, and (when given a URL) the kind, owner token,
// and server base from a share reference. A bare id returns only the id.
func parseShareRef(ref string) (id, kind, ownerToken, server string) {
	if !strings.Contains(ref, "://") {
		return ref, "", "", ""
	}
	u, err := url.Parse(ref)
	if err != nil {
		return ref, "", "", ""
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) >= 2 {
		// /s/ says nothing about the kind (that is the point of it), so kind stays empty
		// and callers fall back to the registry or ask for the exact URL. The older
		// prefixes still name their kind and are kept forever.
		switch parts[0] {
		case "p":
			kind = "diff"
		case "f", "app", "plan", "d":
			kind = "files"
		}
		id = parts[len(parts)-1]
	}
	// Owner token lives in the fragment as "owner=...".
	frag := u.Fragment
	for _, kv := range strings.Split(frag, "&") {
		if strings.HasPrefix(kv, "owner=") {
			ownerToken = strings.TrimPrefix(kv, "owner=")
		}
	}
	if u.Scheme != "" && u.Host != "" {
		server = u.Scheme + "://" + u.Host
	}
	return id, kind, ownerToken, server
}

// apiBase returns the server base to use for a record: explicit flag, then the
// record's stored server, then the host from its preview URL.
func apiBase(r *shareRecord, serverFlag string) string {
	if serverFlag != "" {
		return serverFlag
	}
	if r.Server != "" {
		return r.Server
	}
	if r.PreviewURL != "" {
		if u, err := url.Parse(r.PreviewURL); err == nil && u.Scheme != "" && u.Host != "" {
			return u.Scheme + "://" + u.Host
		}
	}
	return ""
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:n])
	}
	return string(r[:n-1]) + "…"
}
