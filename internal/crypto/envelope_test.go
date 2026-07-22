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
