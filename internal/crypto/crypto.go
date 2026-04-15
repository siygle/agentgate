package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/pbkdf2"
)

const (
	pbkdf2Iterations = 600_000
	keyLen           = 32 // AES-256
	saltLen          = 16
	nonceLen         = 12 // GCM standard nonce size
)

// deriveKey derives a 256-bit AES key from the passphrase and salt using
// PBKDF2-SHA256.
func deriveKey(passphrase string, salt []byte) []byte {
	return pbkdf2.Key([]byte(passphrase), salt, pbkdf2Iterations, keyLen, sha256.New)
}

// Encrypt encrypts plaintext with the given passphrase using AES-256-GCM.
// It returns base64-encoded ciphertext (with appended GCM auth tag), IV, and
// salt. The output is compatible with the Web Crypto API.
func Encrypt(plaintext, passphrase string) (ciphertext, iv, salt string, err error) {
	// Generate random salt and nonce.
	saltBytes := make([]byte, saltLen)
	if _, err = rand.Read(saltBytes); err != nil {
		return "", "", "", fmt.Errorf("generate salt: %w", err)
	}

	nonceBytes := make([]byte, nonceLen)
	if _, err = rand.Read(nonceBytes); err != nil {
		return "", "", "", fmt.Errorf("generate nonce: %w", err)
	}

	// Derive key and create cipher.
	key := deriveKey(passphrase, saltBytes)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", "", fmt.Errorf("create cipher: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", "", fmt.Errorf("create GCM: %w", err)
	}

	// Seal appends the auth tag to the ciphertext, which is the same format
	// that Web Crypto API produces.
	sealed := aead.Seal(nil, nonceBytes, []byte(plaintext), nil)

	ciphertext = base64.StdEncoding.EncodeToString(sealed)
	iv = base64.StdEncoding.EncodeToString(nonceBytes)
	salt = base64.StdEncoding.EncodeToString(saltBytes)

	return ciphertext, iv, salt, nil
}

// Decrypt decrypts base64-encoded ciphertext using the given IV, salt, and
// passphrase. All three encoded values must use standard base64 encoding.
func Decrypt(ciphertext, iv, salt, passphrase string) (string, error) {
	sealed, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}

	nonceBytes, err := base64.StdEncoding.DecodeString(iv)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}

	saltBytes, err := base64.StdEncoding.DecodeString(salt)
	if err != nil {
		return "", fmt.Errorf("decode salt: %w", err)
	}

	key := deriveKey(passphrase, saltBytes)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create GCM: %w", err)
	}

	plaintext, err := aead.Open(nil, nonceBytes, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}

	return string(plaintext), nil
}
