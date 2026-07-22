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
