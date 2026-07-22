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
