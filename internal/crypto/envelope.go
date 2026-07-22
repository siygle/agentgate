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
