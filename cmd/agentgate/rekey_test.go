package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/siygle/agentgate/internal/crypto"
)

func TestRekeyEncryptedData_V1(t *testing.T) {
	const plaintext = `{"files":[{"title":"hello.md","content":"# hi"}]}`
	ct, iv, salt, err := crypto.Encrypt(plaintext, "old-pass")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	raw, _ := json.Marshal(map[string]string{"ciphertext": ct, "iv": iv, "salt": salt})

	out, err := rekeyEncryptedData(raw, "old-pass", "new-pass")
	if err != nil {
		t.Fatalf("rekeyEncryptedData v1: %v", err)
	}
	m, ok := out.(map[string]string)
	if !ok {
		t.Fatalf("expected map[string]string, got %T", out)
	}
	got, err := crypto.Decrypt(m["ciphertext"], m["iv"], m["salt"], "new-pass")
	if err != nil {
		t.Fatalf("decrypt with new pass failed: %v", err)
	}
	if got != plaintext {
		t.Fatalf("plaintext mismatch: got %q want %q", got, plaintext)
	}
	if _, err := crypto.Decrypt(m["ciphertext"], m["iv"], m["salt"], "old-pass"); err == nil {
		t.Fatal("old passphrase unexpectedly still decrypted v1 share")
	}
}

func TestRekeyEncryptedData_V2PreservesRecovery(t *testing.T) {
	privB64, pubB64, err := crypto.GenerateRecoveryKey()
	if err != nil {
		t.Fatalf("GenerateRecoveryKey: %v", err)
	}
	const plaintext = `{"kind":"documents","files":[{"title":"plan.md","content":"secret"}]}`
	orig, err := crypto.EncryptEnvelope(plaintext, "old-v2-pass", pubB64)
	if err != nil {
		t.Fatalf("EncryptEnvelope: %v", err)
	}
	raw, _ := json.Marshal(orig)

	out, err := rekeyEncryptedData(raw, "old-v2-pass", "new-v2-pass")
	if err != nil {
		t.Fatalf("rekeyEncryptedData v2: %v", err)
	}
	next, ok := out.(crypto.Envelope)
	if !ok {
		t.Fatalf("expected crypto.Envelope, got %T", out)
	}
	if next.V != 2 {
		t.Fatalf("expected v=2, got %d", next.V)
	}
	if next.Ciphertext != orig.Ciphertext || next.IV != orig.IV {
		t.Fatal("expected ciphertext and iv to be preserved when re-wrapping DEK")
	}
	if next.WrapRecov == nil || next.WrapRecov.CT != orig.WrapRecov.CT {
		t.Fatal("expected wrap_recov to be preserved verbatim")
	}
	got, err := crypto.DecryptEnvelope(next, "new-v2-pass")
	if err != nil {
		t.Fatalf("DecryptEnvelope with new pass failed: %v", err)
	}
	if got != plaintext {
		t.Fatalf("plaintext mismatch: got %q want %q", got, plaintext)
	}
	if _, err := crypto.DecryptEnvelope(next, "old-v2-pass"); err == nil {
		t.Fatal("old passphrase unexpectedly still decrypted v2 share")
	}
	// Offline recovery key must still unwrap the same DEK.
	if _, err := crypto.RecoverDEK(*next.WrapRecov, privB64); err != nil {
		t.Fatalf("RecoverDEK after rekey failed: %v", err)
	}
}

func TestFetchShareForRekey_KindAgnosticSRoute(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/share/ABC123" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"id":"ABC123","kind":"files","encrypted_data":{"ciphertext":"ct","iv":"iv","salt":"sa"}}}`))
	}))
	defer srv.Close()

	kind, raw, err := fetchShareForRekey(srv.Client(), srv.URL, "", "ABC123")
	if err != nil {
		t.Fatalf("fetchShareForRekey: %v", err)
	}
	if kind != "files" {
		t.Fatalf("expected kind=files, got %q", kind)
	}
	if len(raw) == 0 {
		t.Fatal("expected non-empty encrypted_data")
	}
}
