package id

import "crypto/rand"

const (
	alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32 chars, base32-like (no I, O, 0, 1)
	length   = 6
)

// Generate returns a cryptographically random 6-character ID
// using a base32-like alphabet.
func Generate() string {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	for i := range b {
		b[i] = alphabet[b[i]%byte(len(alphabet))]
	}
	return string(b)
}
