// Command crossvector emits a deterministic Go->JS interop test vector for the
// v2 envelope + recovery-key scheme implemented in internal/crypto. It is a
// regression artifact for Plan 3 / Task 5 ("owner reset & re-share"): unit
// tests validate each language against itself, but this proves that a real
// envelope produced by the Go crypto package can be decrypted AND recovered by
// the browser's web/static/js/crypto.js.
//
// Usage:
//
//	go run ./cmd/crossvector > /tmp/ag-crossvector.json
//	node web/static/js/crypto.crossvector.test.mjs /tmp/ag-crossvector.json
//
// This program does not talk to any server or network; it only exercises the
// real internal/crypto package and prints its output as JSON.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/siygle/agentgate/internal/crypto"
)

// vector is the JSON shape consumed by crypto.crossvector.test.mjs.
type vector struct {
	Priv       string          `json:"priv"`
	Pub        string          `json:"pub"`
	Passphrase string          `json:"passphrase"`
	Plaintext  string          `json:"plaintext"`
	Envelope   crypto.Envelope `json:"envelope"`
}

func main() {
	priv, pub, err := crypto.GenerateRecoveryKey()
	if err != nil {
		fmt.Fprintf(os.Stderr, "generate recovery key: %v\n", err)
		os.Exit(1)
	}

	const plaintext = "the quick brown fox — cross vector"
	const passphrase = "oldpass"

	env, err := crypto.EncryptEnvelope(plaintext, passphrase, pub)
	if err != nil {
		fmt.Fprintf(os.Stderr, "encrypt envelope: %v\n", err)
		os.Exit(1)
	}

	v := vector{
		Priv:       priv,
		Pub:        pub,
		Passphrase: passphrase,
		Plaintext:  plaintext,
		Envelope:   env,
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		fmt.Fprintf(os.Stderr, "encode vector: %v\n", err)
		os.Exit(1)
	}
}
