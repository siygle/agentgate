package server

import (
	"testing"
	"time"
)

func TestSessionRoundTrip(t *testing.T) {
	secret := []byte("test-secret-0123456789")
	tok := newSessionToken(secret, authMethodOwnerKey, time.Hour)

	claims, ok := verifySession(secret, tok)
	if !ok {
		t.Fatal("verifySession rejected a freshly signed token")
	}
	if claims.Sub != "owner" || claims.Method != authMethodOwnerKey {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if claims.Exp <= claims.Iat {
		t.Fatalf("exp %d should be after iat %d", claims.Exp, claims.Iat)
	}
}

func TestSessionRejectsTampering(t *testing.T) {
	secret := []byte("test-secret-0123456789")
	tok := newSessionToken(secret, authMethodOwnerKey, time.Hour)

	// Wrong secret.
	if _, ok := verifySession([]byte("other-secret"), tok); ok {
		t.Fatal("verifySession accepted a token signed with a different secret")
	}
	// Flipped last char of the signature.
	bad := tok[:len(tok)-1]
	if tok[len(tok)-1] == 'A' {
		bad += "B"
	} else {
		bad += "A"
	}
	if _, ok := verifySession(secret, bad); ok {
		t.Fatal("verifySession accepted a token with a mutated signature")
	}
	// Garbage / empty.
	if _, ok := verifySession(secret, ""); ok {
		t.Fatal("verifySession accepted an empty token")
	}
	if _, ok := verifySession(secret, "v1.only-two"); ok {
		t.Fatal("verifySession accepted a malformed token")
	}
	if _, ok := verifySession(nil, tok); ok {
		t.Fatal("verifySession accepted a token with no secret")
	}
}

func TestSessionRejectsExpired(t *testing.T) {
	secret := []byte("test-secret-0123456789")
	// A token that expired an hour ago.
	tok := newSessionToken(secret, authMethodPasskey, -time.Hour)
	if _, ok := verifySession(secret, tok); ok {
		t.Fatal("verifySession accepted an expired token")
	}
}
