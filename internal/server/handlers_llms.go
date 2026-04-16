package server

import (
	"fmt"
	"net/http"
)

// handleLLMsTxt serves a markdown document following the llmstxt.org spec.
func (s *Server) handleLLMsTxt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, llmsTxtTemplate, s.baseURL, s.baseURL, s.baseURL)
}

// handleLLMsFullTxt serves the full detailed reference for AI agents.
func (s *Server) handleLLMsFullTxt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, llmsFullTxtTemplate, s.baseURL, s.baseURL, s.baseURL, s.baseURL)
}

const llmsTxtTemplate = `# AgentGate

> Self-hosted encrypted diff & file sharing. AES-256-GCM end-to-end encryption, single binary, SQLite storage, 24-hour auto-expiry.

AgentGate encrypts code diffs and files client-side before uploading. The server never sees plaintext. Recipients need the passphrase to decrypt.

## Docs

- [Full LLM reference](%s/llms-full.txt): Complete API, CLI, encryption, and payload format details for building integrations
- [Source code](https://github.com/siygle/diff4): GitHub repository with README, issues, and releases
- [CLI releases](https://github.com/siygle/diff4/releases): Prebuilt binaries for all platforms

## API

- [POST /api/diff](%s/llms-full.txt): Create an encrypted diff — send JSON with encrypted_data containing ciphertext, iv, and salt
- [POST /api/files](%s/llms-full.txt): Create an encrypted file bundle — same format, preview URL uses /f/ prefix

## Optional

- [Go module](https://pkg.go.dev/github.com/siygle/agentgate): Go package documentation on pkg.go.dev
`

const llmsFullTxtTemplate = `# AgentGate

> Self-hosted encrypted diff & file sharing. AES-256-GCM end-to-end encryption, single binary, SQLite storage, 24-hour auto-expiry.

AgentGate encrypts code diffs and files client-side before uploading. The server never sees plaintext. Recipients need the passphrase to decrypt.

Server: %s

## CLI Installation

Install with Go:

    go install github.com/siygle/agentgate/cmd/agentgate@latest

Or download a prebuilt binary from [GitHub Releases](https://github.com/siygle/diff4/releases).

## CLI Setup

Set the server URL (required) and generate an encryption passphrase:

    export AGENTGATE_SERVER=%s
    agentgate key-gen
    source ~/.zshrc  # or ~/.bashrc

## CLI Commands

- ` + "`agentgate git-latest`" + `: Share the latest commit diff
- ` + "`agentgate git-staged`" + `: Share staged changes
- ` + "`agentgate files <paths...>`" + `: Share one or more files
- ` + "`agentgate key-gen [key]`" + `: Generate or set encryption passphrase
- ` + "`agentgate key-get`" + `: Print current passphrase

All upload commands accept ` + "`-s <server>`" + ` and ` + "`-p <passphrase>`" + ` flags to override environment variables.

## Environment Variables

- ` + "`AGENTGATE_SERVER`" + `: Server URL (required, no default)
- ` + "`AGENTGATE_PASSPHRASE`" + `: Encryption passphrase

## API Reference

### POST /api/diff

Create an encrypted diff. Request body:

` + "```" + `json
{
  "encrypted_data": {
    "ciphertext": "<base64-encoded ciphertext>",
    "iv": "<base64-encoded initialization vector>",
    "salt": "<base64-encoded salt>"
  }
}
` + "```" + `

Response (201 Created):

` + "```" + `json
{
  "success": true,
  "data": {
    "preview_url": "%s/p/<id>",
    "id": "<id>"
  }
}
` + "```" + `

### POST /api/files

Create an encrypted file bundle. Same request/response format as POST /api/diff. The preview URL uses ` + "`/f/<id>`" + ` instead of ` + "`/p/<id>`" + `.

## Encryption Details

- Algorithm: AES-256-GCM
- Key derivation: PBKDF2-SHA256 with 600,000 iterations
- Encryption is performed client-side only
- The server stores only ciphertext, IV, and salt
- The passphrase is never transmitted to the server

## Plaintext Payload Formats

These are the JSON structures that get encrypted before being sent to the API.

### Diff payload (before encryption)

` + "```" + `json
{
  "title": "commit subject or description",
  "files": [
    {
      "filename": "path/to/file.go",
      "language": "go",
      "patch": "diff --git a/... unified diff content"
    }
  ]
}
` + "```" + `

### Files payload (before encryption)

` + "```" + `json
{
  "files": [
    {
      "title": "filename.go",
      "content": "file content as string"
    }
  ]
}
` + "```" + `

## Source Code

- [GitHub repository](https://github.com/siygle/diff4)
- [CLI releases](https://github.com/siygle/diff4/releases)
- [Go module](https://pkg.go.dev/github.com/siygle/agentgate)

## Creating a Skill

To create a skill or integration for AgentGate CLI, an agent needs to:

1. Check that ` + "`agentgate`" + ` is installed (run ` + "`agentgate key-get`" + ` to verify)
2. If not installed, run ` + "`go install github.com/siygle/agentgate/cmd/agentgate@latest`" + `
3. Ensure ` + "`AGENTGATE_SERVER`" + ` and ` + "`AGENTGATE_PASSPHRASE`" + ` are set
4. Use the CLI commands to share diffs or files — output is JSON with a ` + "`preview_url`" + `
5. Present the preview URL to the user

Example workflow for sharing the latest commit:

    agentgate git-latest -s %s

The command prints JSON to stdout containing ` + "`preview_url`" + ` which can be shared directly.
`
