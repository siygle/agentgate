# Reset & Re-share — Plan 1: Crypto foundation + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add envelope encryption (v2) with an offline ECDH-P256 recovery key to the Go crypto package and CLI, so uploads can be re-keyed later without the original passphrase.

**Architecture:** Content is encrypted under a random per-share DEK. The DEK is wrapped under the passphrase (PBKDF2 path, unchanged from v1) and, when a recovery public key is configured, additionally wrapped to that key via ECIES (ephemeral ECDH-P256 → HKDF-SHA256 → AES-256-GCM). All of this lives inside the existing opaque `encrypted_data` JSON — no DB or API changes in this plan.

**Tech Stack:** Go stdlib `crypto/ecdh`, `crypto/aes`, `crypto/cipher`, `crypto/rand`, `crypto/sha256`; `golang.org/x/crypto/pbkdf2` (already used) and `golang.org/x/crypto/hkdf` (same module, already vendored). No new dependencies.

## Global Constraints

- Crypto params copied verbatim from `internal/crypto/crypto.go`: `pbkdf2Iterations = 600_000`, `keyLen = 32` (AES-256), `saltLen = 16`, `nonceLen = 12`.
- All wire fields are **standard** base64 (`base64.StdEncoding`), matching v1 and the Web Crypto API.
- v2 is **opt-in**: the CLI emits v1 exactly as today unless `AGENTGATE_RECOVERY_PUBKEY` is set. This keeps rollout safe before v2-aware servers/viewers (Plans 2–3) are deployed.
- Recovery **private** key never appears in uploaded data or on any server.
- ECIES HKDF info string is exactly `agentgate/recovery-wrap/v2`.

### ⚠️ Rollout ordering (blocking prerequisite)

`AGENTGATE_RECOVERY_PUBKEY` MUST NOT be set until the v2-aware servers (Plan 2) and web viewer (Plan 3) are deployed. Setting it earlier causes silent, unrecoverable data loss: the current create handlers on both backends only persist `{ciphertext, iv, salt}` from `encrypted_data`, so the v2-only fields (`iv_p`, `wrap_pass`, `wrap_recov`) are silently dropped and the resulting share can never be decrypted, even though the upload reports success.

---

### Task 1: Envelope crypto primitives in `internal/crypto`

**Files:**
- Create: `internal/crypto/envelope.go`
- Test: `internal/crypto/envelope_test.go`

**Interfaces:**
- Consumes: existing `deriveKey(passphrase string, salt []byte) []byte`, and consts `keyLen`, `saltLen`, `nonceLen` from `internal/crypto/crypto.go`.
- Produces:
  - `type RecovWrap struct { EPK, IV, CT string }` (json: `epk`,`iv`,`ct`)
  - `type Envelope struct { V int; Ciphertext, IV, Salt, IVP, WrapPass string; WrapRecov *RecovWrap }` (json: `v`,`ciphertext`,`iv`,`salt`,`iv_p`,`wrap_pass`,`wrap_recov,omitempty`)
  - `func GenerateRecoveryKey() (privB64, pubB64 string, err error)`
  - `func EncryptEnvelope(plaintext, passphrase, recoveryPubB64 string) (Envelope, error)`
  - `func DecryptEnvelope(env Envelope, passphrase string) (string, error)`
  - `func RecoverDEK(w RecovWrap, privB64 string) ([]byte, error)`
  - `func WrapDEKPassphrase(dek []byte, passphrase string) (salt, ivP, wrapPass string, err error)`

- [ ] **Step 1: Write the failing test**

```go
// internal/crypto/envelope_test.go
package crypto

import (
	"encoding/base64"
	"testing"
)

func TestEnvelopePassphraseRoundTrip(t *testing.T) {
	env, err := EncryptEnvelope("hello world", "pw-correct", "")
	if err != nil {
		t.Fatalf("EncryptEnvelope: %v", err)
	}
	if env.V != 2 || env.WrapPass == "" || env.Ciphertext == "" {
		t.Fatalf("unexpected envelope: %+v", env)
	}
	if env.WrapRecov != nil {
		t.Fatalf("expected no recovery wrap when pubkey empty")
	}
	got, err := DecryptEnvelope(env, "pw-correct")
	if err != nil || got != "hello world" {
		t.Fatalf("DecryptEnvelope = %q, %v", got, err)
	}
	if _, err := DecryptEnvelope(env, "pw-wrong"); err == nil {
		t.Fatalf("expected wrong-passphrase decrypt to fail")
	}
}

func TestEnvelopeRecoveryRoundTrip(t *testing.T) {
	priv, pub, err := GenerateRecoveryKey()
	if err != nil {
		t.Fatalf("GenerateRecoveryKey: %v", err)
	}
	env, err := EncryptEnvelope("secret content", "pw-correct", pub)
	if err != nil {
		t.Fatalf("EncryptEnvelope: %v", err)
	}
	if env.WrapRecov == nil {
		t.Fatalf("expected recovery wrap")
	}
	// Recover the DEK with the private key, then re-key to a NEW passphrase
	// WITHOUT the old passphrase — the core reset capability.
	dek, err := RecoverDEK(*env.WrapRecov, priv)
	if err != nil {
		t.Fatalf("RecoverDEK: %v", err)
	}
	if len(dek) != keyLen {
		t.Fatalf("DEK len = %d, want %d", len(dek), keyLen)
	}
	salt, ivP, wrapPass, err := WrapDEKPassphrase(dek, "pw-new")
	if err != nil {
		t.Fatalf("WrapDEKPassphrase: %v", err)
	}
	rekeyed := env
	rekeyed.Salt, rekeyed.IVP, rekeyed.WrapPass = salt, ivP, wrapPass
	got, err := DecryptEnvelope(rekeyed, "pw-new")
	if err != nil || got != "secret content" {
		t.Fatalf("re-keyed decrypt = %q, %v", got, err)
	}
	if _, err := DecryptEnvelope(rekeyed, "pw-correct"); err == nil {
		t.Fatalf("old passphrase must no longer decrypt the re-keyed envelope")
	}
}

func TestRecoverDEKWrongKeyFails(t *testing.T) {
	_, pub, _ := GenerateRecoveryKey()
	otherPriv, _, _ := GenerateRecoveryKey()
	env, _ := EncryptEnvelope("x", "pw", pub)
	if _, err := RecoverDEK(*env.WrapRecov, otherPriv); err == nil {
		t.Fatalf("recovering with the wrong private key must fail")
	}
	_ = base64.StdEncoding
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/crypto/ -run TestEnvelope -v`
Expected: FAIL — `undefined: EncryptEnvelope` (and the other new symbols).

- [ ] **Step 3: Write minimal implementation**

```go
// internal/crypto/envelope.go
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

const recoveryHKDFInfo = "agentgate/recovery-wrap/v2"

// RecovWrap is a DEK wrapped to a recovery public key via ECIES
// (ephemeral ECDH-P256 -> HKDF-SHA256 -> AES-256-GCM). All fields are
// standard-base64.
type RecovWrap struct {
	EPK string `json:"epk"` // ephemeral public key (uncompressed P-256 point)
	IV  string `json:"iv"`  // AES-GCM nonce
	CT  string `json:"ct"`  // wrapped DEK
}

// Envelope is the v2 encrypted_data JSON: content encrypted under a random DEK,
// with the DEK wrapped under the passphrase and (optionally) a recovery key.
type Envelope struct {
	V          int        `json:"v"`
	Ciphertext string     `json:"ciphertext"` // content, AES-256-GCM under DEK
	IV         string     `json:"iv"`         // content nonce
	Salt       string     `json:"salt"`       // PBKDF2 salt for the passphrase wrap
	IVP        string     `json:"iv_p"`       // nonce for wrap_pass
	WrapPass   string     `json:"wrap_pass"`  // DEK wrapped under KDF(passphrase, salt)
	WrapRecov  *RecovWrap `json:"wrap_recov,omitempty"`
}

func aesGCMSeal(key, plaintext []byte) (ct, nonce []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, nonceLen)
	if _, err = rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return aead.Seal(nil, nonce, plaintext, nil), nonce, nil
}

func aesGCMOpen(key, nonce, ct []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ct, nil)
}

func hkdfKey(secret []byte) ([]byte, error) {
	r := hkdf.New(sha256.New, secret, nil, []byte(recoveryHKDFInfo))
	key := make([]byte, keyLen)
	if _, err := io.ReadFull(r, key); err != nil {
		return nil, err
	}
	return key, nil
}

// GenerateRecoveryKey returns a new P-256 recovery keypair as standard-base64:
// privB64 = raw 32-byte scalar; pubB64 = uncompressed point (65 bytes).
func GenerateRecoveryKey() (privB64, pubB64 string, err error) {
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate recovery key: %w", err)
	}
	return base64.StdEncoding.EncodeToString(priv.Bytes()),
		base64.StdEncoding.EncodeToString(priv.PublicKey().Bytes()), nil
}

// WrapDEKPassphrase wraps a DEK under a passphrase with a fresh salt+nonce.
func WrapDEKPassphrase(dek []byte, passphrase string) (salt, ivP, wrapPass string, err error) {
	saltB := make([]byte, saltLen)
	if _, err = rand.Read(saltB); err != nil {
		return "", "", "", fmt.Errorf("generate salt: %w", err)
	}
	key := deriveKey(passphrase, saltB)
	ct, nonce, err := aesGCMSeal(key, dek)
	if err != nil {
		return "", "", "", fmt.Errorf("wrap dek: %w", err)
	}
	return base64.StdEncoding.EncodeToString(saltB),
		base64.StdEncoding.EncodeToString(nonce),
		base64.StdEncoding.EncodeToString(ct), nil
}

func eciesWrap(recoveryPubB64 string, dek []byte) (RecovWrap, error) {
	pubBytes, err := base64.StdEncoding.DecodeString(recoveryPubB64)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("decode recovery pubkey: %w", err)
	}
	pub, err := ecdh.P256().NewPublicKey(pubBytes)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("parse recovery pubkey: %w", err)
	}
	eph, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("ephemeral key: %w", err)
	}
	ss, err := eph.ECDH(pub)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("ecdh: %w", err)
	}
	wk, err := hkdfKey(ss)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("hkdf: %w", err)
	}
	ct, nonce, err := aesGCMSeal(wk, dek)
	if err != nil {
		return RecovWrap{}, fmt.Errorf("wrap dek: %w", err)
	}
	return RecovWrap{
		EPK: base64.StdEncoding.EncodeToString(eph.PublicKey().Bytes()),
		IV:  base64.StdEncoding.EncodeToString(nonce),
		CT:  base64.StdEncoding.EncodeToString(ct),
	}, nil
}

// RecoverDEK unwraps the DEK from a RecovWrap using the recovery private key.
func RecoverDEK(w RecovWrap, privB64 string) ([]byte, error) {
	privBytes, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil {
		return nil, fmt.Errorf("decode recovery privkey: %w", err)
	}
	priv, err := ecdh.P256().NewPrivateKey(privBytes)
	if err != nil {
		return nil, fmt.Errorf("parse recovery privkey: %w", err)
	}
	epkBytes, err := base64.StdEncoding.DecodeString(w.EPK)
	if err != nil {
		return nil, fmt.Errorf("decode epk: %w", err)
	}
	epk, err := ecdh.P256().NewPublicKey(epkBytes)
	if err != nil {
		return nil, fmt.Errorf("parse epk: %w", err)
	}
	ss, err := priv.ECDH(epk)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}
	wk, err := hkdfKey(ss)
	if err != nil {
		return nil, fmt.Errorf("hkdf: %w", err)
	}
	iv, err := base64.StdEncoding.DecodeString(w.IV)
	if err != nil {
		return nil, fmt.Errorf("decode iv: %w", err)
	}
	ct, err := base64.StdEncoding.DecodeString(w.CT)
	if err != nil {
		return nil, fmt.Errorf("decode ct: %w", err)
	}
	dek, err := aesGCMOpen(wk, iv, ct)
	if err != nil {
		return nil, fmt.Errorf("unwrap dek: %w", err)
	}
	return dek, nil
}

// EncryptEnvelope encrypts plaintext into a v2 Envelope. A random 256-bit DEK
// encrypts the content; the DEK is wrapped under the passphrase and — when
// recoveryPubB64 is non-empty — also wrapped to the recovery public key.
func EncryptEnvelope(plaintext, passphrase, recoveryPubB64 string) (Envelope, error) {
	dek := make([]byte, keyLen)
	if _, err := rand.Read(dek); err != nil {
		return Envelope{}, fmt.Errorf("generate dek: %w", err)
	}
	ct, ivC, err := aesGCMSeal(dek, []byte(plaintext))
	if err != nil {
		return Envelope{}, fmt.Errorf("encrypt content: %w", err)
	}
	salt, ivP, wrapPass, err := WrapDEKPassphrase(dek, passphrase)
	if err != nil {
		return Envelope{}, err
	}
	env := Envelope{
		V:          2,
		Ciphertext: base64.StdEncoding.EncodeToString(ct),
		IV:         base64.StdEncoding.EncodeToString(ivC),
		Salt:       salt,
		IVP:        ivP,
		WrapPass:   wrapPass,
	}
	if recoveryPubB64 != "" {
		w, werr := eciesWrap(recoveryPubB64, dek)
		if werr != nil {
			return Envelope{}, fmt.Errorf("wrap to recovery key: %w", werr)
		}
		env.WrapRecov = &w
	}
	return env, nil
}

// DecryptEnvelope decrypts a v2 Envelope using the passphrase path.
func DecryptEnvelope(env Envelope, passphrase string) (string, error) {
	salt, err := base64.StdEncoding.DecodeString(env.Salt)
	if err != nil {
		return "", fmt.Errorf("decode salt: %w", err)
	}
	ivP, err := base64.StdEncoding.DecodeString(env.IVP)
	if err != nil {
		return "", fmt.Errorf("decode iv_p: %w", err)
	}
	wrapPass, err := base64.StdEncoding.DecodeString(env.WrapPass)
	if err != nil {
		return "", fmt.Errorf("decode wrap_pass: %w", err)
	}
	dek, err := aesGCMOpen(deriveKey(passphrase, salt), ivP, wrapPass)
	if err != nil {
		return "", fmt.Errorf("unwrap dek: %w", err)
	}
	ivC, err := base64.StdEncoding.DecodeString(env.IV)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	ct, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	pt, err := aesGCMOpen(dek, ivC, ct)
	if err != nil {
		return "", fmt.Errorf("decrypt content: %w", err)
	}
	return string(pt), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/crypto/ -v`
Expected: PASS (new `TestEnvelope*`/`TestRecoverDEK*` plus existing crypto tests).

- [ ] **Step 5: Verify hkdf is already available (no go.mod change)**

Run: `go build ./internal/crypto/`
Expected: builds clean. `golang.org/x/crypto/hkdf` resolves from the already-present `golang.org/x/crypto` module (same module as `pbkdf2`). If it reports a missing package, run `go mod tidy` and commit the go.mod/go.sum delta in Step 6.

- [ ] **Step 6: Commit**

```bash
git add internal/crypto/envelope.go internal/crypto/envelope_test.go go.mod go.sum
git commit -m "feat(crypto): v2 envelope encryption with ECDH-P256 recovery wrap"
```

---

### Task 2: CLI `recovery-keygen` command

**Files:**
- Modify: `cmd/agentgate/commands.go` (add `runRecoveryKeygen`)
- Modify: `cmd/agentgate/main.go` (dispatch `recovery-keygen`; usage text near `main.go:111`)
- Test: `cmd/agentgate/recovery_keygen_test.go`

**Interfaces:**
- Consumes: `crypto.GenerateRecoveryKey()`, `crypto.Encrypt()` (existing, for optional private-key-at-rest protection).
- Produces: `func buildRecoveryKeygen(protectPass string) (pubB64 string, privFileContents string, err error)` — pure, testable core. `privFileContents` is the raw base64 private key, or (when `protectPass != ""`) a JSON `{"enc":{ciphertext,iv,salt}}` blob produced via `crypto.Encrypt`.

- [ ] **Step 1: Write the failing test**

```go
// cmd/agentgate/recovery_keygen_test.go
package main

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/siygle/agentgate/internal/crypto"
)

func TestBuildRecoveryKeygenPlain(t *testing.T) {
	pub, privFile, err := buildRecoveryKeygen("")
	if err != nil {
		t.Fatalf("buildRecoveryKeygen: %v", err)
	}
	if _, err := base64.StdEncoding.DecodeString(pub); err != nil {
		t.Fatalf("pub not base64: %v", err)
	}
	// Plain private file is the raw base64 scalar and must round-trip via ECIES.
	env, err := crypto.EncryptEnvelope("data", "pw", pub)
	if err != nil {
		t.Fatalf("EncryptEnvelope: %v", err)
	}
	if _, err := crypto.RecoverDEK(*env.WrapRecov, privFile); err != nil {
		t.Fatalf("RecoverDEK with generated priv: %v", err)
	}
}

func TestBuildRecoveryKeygenProtected(t *testing.T) {
	_, privFile, err := buildRecoveryKeygen("master-pw")
	if err != nil {
		t.Fatalf("buildRecoveryKeygen: %v", err)
	}
	var blob struct {
		Enc struct{ Ciphertext, IV, Salt string } `json:"enc"`
	}
	if err := json.Unmarshal([]byte(privFile), &blob); err != nil {
		t.Fatalf("protected file not JSON: %v", err)
	}
	if _, err := crypto.Decrypt(blob.Enc.Ciphertext, blob.Enc.IV, blob.Enc.Salt, "master-pw"); err != nil {
		t.Fatalf("cannot decrypt protected private key with correct passphrase: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/agentgate/ -run TestBuildRecoveryKeygen -v`
Expected: FAIL — `undefined: buildRecoveryKeygen`.

- [ ] **Step 3: Write minimal implementation**

Add to `cmd/agentgate/commands.go`:

```go
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
}
```

Ensure `cmd/agentgate/commands.go` imports include `flag` (add if missing).

In `cmd/agentgate/main.go`, add a dispatch case alongside the other subcommands (match the existing switch/registry pattern) so `recovery-keygen` calls `runRecoveryKeygen(os.Args[2:])`, and add a usage line near `main.go:111`:

```
  recovery-keygen [-o file] [-p passphrase]                                Generate an offline owner recovery keypair
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./cmd/agentgate/ -run TestBuildRecoveryKeygen -v`
Expected: PASS.

- [ ] **Step 5: Smoke-test the command**

Run: `go run ./cmd/agentgate recovery-keygen`
Expected: prints a PUBLIC key block and a PRIVATE key block, both base64.

- [ ] **Step 6: Commit**

```bash
git add cmd/agentgate/commands.go cmd/agentgate/main.go cmd/agentgate/recovery_keygen_test.go
git commit -m "feat(cli): recovery-keygen command for offline owner recovery keypair"
```

---

### Task 3: CLI uploads emit v2 when a recovery pubkey is configured

**Files:**
- Modify: `cmd/agentgate/main.go:291-327` (`encryptAndPostMode`)
- Test: `cmd/agentgate/create_body_test.go`

**Interfaces:**
- Consumes: `crypto.Encrypt` (v1), `crypto.EncryptEnvelope` (v2).
- Produces: `func buildCreateBody(plaintext, passphrase, recoveryPubB64 string) (map[string]any, error)` — the testable core that returns the `encrypted_data` (and nothing else); `encryptAndPostMode` calls it and then adds ttl/never_expires.

- [ ] **Step 1: Write the failing test**

```go
// cmd/agentgate/create_body_test.go
package main

import (
	"encoding/json"
	"testing"

	"github.com/siygle/agentgate/internal/crypto"
)

func TestBuildCreateBodyV1WhenNoRecoveryKey(t *testing.T) {
	body, err := buildCreateBody("payload", "pw", "")
	if err != nil {
		t.Fatalf("buildCreateBody: %v", err)
	}
	ed, _ := body["encrypted_data"].(map[string]string)
	if ed == nil || ed["ciphertext"] == "" || ed["iv"] == "" || ed["salt"] == "" {
		t.Fatalf("v1 encrypted_data malformed: %+v", body["encrypted_data"])
	}
	if _, hasV := body["encrypted_data"].(map[string]string)["v"]; hasV {
		t.Fatalf("v1 body must not carry a version field")
	}
}

func TestBuildCreateBodyV2WhenRecoveryKeySet(t *testing.T) {
	priv, pub, _ := crypto.GenerateRecoveryKey()
	body, err := buildCreateBody("payload", "pw", pub)
	if err != nil {
		t.Fatalf("buildCreateBody: %v", err)
	}
	// Re-marshal through JSON to confirm the on-wire shape is a v2 Envelope.
	raw, _ := json.Marshal(body["encrypted_data"])
	var env crypto.Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("encrypted_data not an Envelope: %v", err)
	}
	if env.V != 2 || env.WrapRecov == nil {
		t.Fatalf("expected v2 with recovery wrap, got %+v", env)
	}
	if got, _ := crypto.DecryptEnvelope(env, "pw"); got != "payload" {
		t.Fatalf("passphrase decrypt failed")
	}
	if _, err := crypto.RecoverDEK(*env.WrapRecov, priv); err != nil {
		t.Fatalf("recovery unwrap failed: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./cmd/agentgate/ -run TestBuildCreateBody -v`
Expected: FAIL — `undefined: buildCreateBody`.

- [ ] **Step 3: Write minimal implementation**

Add to `cmd/agentgate/main.go`:

```go
// buildCreateBody produces the request body's encrypted_data. It emits the v1
// {ciphertext,iv,salt} shape unless AGENTGATE_RECOVERY_PUBKEY (recoveryPubB64)
// is set, in which case it emits a v2 Envelope (adding the recovery wrap).
func buildCreateBody(plaintext, passphrase, recoveryPubB64 string) (map[string]any, error) {
	if recoveryPubB64 == "" {
		ciphertext, iv, salt, err := crypto.Encrypt(plaintext, passphrase)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"encrypted_data": map[string]string{"ciphertext": ciphertext, "iv": iv, "salt": salt},
		}, nil
	}
	env, err := crypto.EncryptEnvelope(plaintext, passphrase, recoveryPubB64)
	if err != nil {
		return nil, err
	}
	return map[string]any{"encrypted_data": env}, nil
}
```

Replace the current encrypt-and-build block in `encryptAndPostMode` (`main.go:303-315`) with:

```go
	body, err := buildCreateBody(string(jsonBytes), passphrase, os.Getenv("AGENTGATE_RECOVERY_PUBKEY"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error encrypting: %v\n", err)
		os.Exit(1)
	}
```

Leave the subsequent `ttl`/`noExpiry` additions to `body` and the POST unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./cmd/agentgate/ -v`
Expected: PASS (new `TestBuildCreateBody*` plus existing CLI tests).

- [ ] **Step 5: Full build + vet**

Run: `go build ./... && go vet ./...`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add cmd/agentgate/main.go cmd/agentgate/create_body_test.go
git commit -m "feat(cli): emit v2 envelope uploads when AGENTGATE_RECOVERY_PUBKEY is set"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):** §4.1 envelope + ECIES → Task 1. §4.2 v2 JSON shape (tags) → Task 1 `Envelope`. §5 recovery keypair generation + optional at-rest protection → Task 2. §5 `AGENTGATE_RECOVERY_PUBKEY` upload wiring + graceful v1 fallback → Task 3. §9 backward-compat (v1 stays default) → Task 3 (opt-in). Server/API/web/reset-flow (§6–§8) are intentionally **out of scope** here → Plans 2 & 3.

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands.

**Type consistency:** `Envelope`/`RecovWrap` field + JSON names are identical across Tasks 1–3 (`v`,`ciphertext`,`iv`,`salt`,`iv_p`,`wrap_pass`,`wrap_recov`/`epk`,`iv`,`ct`). `EncryptEnvelope`, `DecryptEnvelope`, `RecoverDEK`, `WrapDEKPassphrase`, `GenerateRecoveryKey`, `buildRecoveryKeygen`, `buildCreateBody` signatures match between their definitions and every call site/test.

## Downstream (separate plans)

- **Plan 2 — server passthrough + admin endpoints:** Go `handlers_api.go` opaque `encrypted_data` passthrough (parse to `json.RawMessage`, validate ciphertext/iv/salt, store verbatim); Worker `index.ts` store whole object; `GET /api/admin/{kind}/{id}/recovery-dek` + `POST /api/admin/{kind}/{id}/reset-reshare` on both backends; `test/contract/run.mjs` cases; `docs/api-contract.md` update.
- **Plan 3 — web viewer + admin UI:** `web/static/js/crypto.js` v2 decrypt (unwrap→decrypt) + `encrypt`/`wrapDEKPassphrase`/ECIES `unwrapDEKRecovery` (WebCrypto ECDH+HKDF); `admin-dashboard.js`/`admin-api.js` reset flow with offline private-key load + new-passphrase display.
