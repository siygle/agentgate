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

> Self-hosted encrypted diff & file sharing. AES-256-GCM end-to-end encryption, single binary, SQLite storage, 7-day default auto-expiry.

AgentGate encrypts code diffs and files client-side before uploading. The server never sees plaintext. Recipients need the passphrase to decrypt.

## Docs

- [Full LLM reference](%s/llms-full.txt): Complete API, CLI, encryption, and payload format details for building integrations
- [Source code](https://github.com/siygle/agentgate): GitHub repository with README, issues, and releases
- [CLI releases](https://github.com/siygle/agentgate/releases): Prebuilt binaries for all platforms

## API

- [POST /api/diff](%s/llms-full.txt): Create an encrypted diff — send JSON with encrypted_data containing ciphertext, iv, and salt
- [POST /api/files](%s/llms-full.txt): Create an encrypted file bundle — same format, preview URL uses /f/ prefix

## Optional

- [Go module](https://pkg.go.dev/github.com/siygle/agentgate): Go package documentation on pkg.go.dev
`

const llmsFullTxtTemplate = `# AgentGate

> Self-hosted encrypted diff & file sharing. AES-256-GCM end-to-end encryption, single binary, SQLite storage, 7-day default auto-expiry.

AgentGate encrypts code diffs and files client-side before uploading. The server never sees plaintext. Recipients need the passphrase to decrypt.

Server: %s

## CLI Installation

Install with Go:

    go install github.com/siygle/agentgate/cmd/agentgate@latest

Or download a prebuilt binary from [GitHub Releases](https://github.com/siygle/agentgate/releases).

## CLI Setup

Set the server URL (required) and generate an encryption passphrase:

    export AGENTGATE_SERVER=%s
    agentgate key-gen
    source ~/.zshrc  # or ~/.bashrc

## CLI Commands

- ` + "`agentgate git-latest`" + `: Share the latest commit diff
- ` + "`agentgate git-staged`" + `: Share staged changes
- ` + "`agentgate files <paths...>`" + `: Share one or more files
- ` + "`agentgate docs <file|dir>`" + `: Share rendered Markdown/MDX documents
- ` + "`agentgate plan <file|dir>`" + `: Share a visual plan bundle
- ` + "`agentgate webapp <dir>`" + `: Share a runnable static webapp containing index.html
- ` + "`agentgate key-gen [key]`" + `: Generate or set encryption passphrase
- ` + "`agentgate key-get`" + `: Print current passphrase

All upload commands accept ` + "`-s <server>`" + `, ` + "`-p <passphrase>`" + `, ` + "`-t <duration>`" + `, and ` + "`--no-expiry`" + ` flags to override environment variables and retention.

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

## Built-in webapp assets

AgentGate webapps run in a sandboxed iframe with ` + "`connect-src 'none'`" + `: the framed app
**cannot make any network request**, so every library it uses must be present locally. Rather
than bundling megabytes into each encrypted upload, reference a built-in library with an
` + "`agentgate:`" + ` URL. The app viewer inlines the vendored copy from the server into the
sandbox before rendering, so it costs nothing in the payload.

| Reference | Global it defines | Library |
|-----------|-------------------|---------|
| ` + "`agentgate:marked`" + ` | ` + "`marked`" + ` | Markdown rendering |
| ` + "`agentgate:highlight`" + ` | ` + "`hljs`" + ` | Syntax highlighting |
| ` + "`agentgate:mermaid`" + ` | ` + "`mermaid`" + ` | Diagrams (flowcharts, sequence, ER, …) |
| ` + "`agentgate:diff2html`" + ` | ` + "`Diff2Html`" + ` | Unified-diff rendering |
| ` + "`agentgate:lightweight-charts`" + ` | ` + "`LightweightCharts`" + ` | TradingView financial charts |

Stylesheets use the same mechanism via ` + "`<link rel=\"stylesheet\">`" + `:

| Reference | Pairs with |
|-----------|-----------|
| ` + "`agentgate:highlight-css`" + ` | ` + "`agentgate:highlight`" + ` (light theme) |
| ` + "`agentgate:highlight-dark-css`" + ` | ` + "`agentgate:highlight`" + ` (dark theme) |
| ` + "`agentgate:diff2html-css`" + ` | ` + "`agentgate:diff2html`" + ` |
| ` + "`agentgate:tokens`" + ` | AgentGate's design tokens (colours, fonts, light/dark) |
| ` + "`agentgate:renderer`" + ` | AgentGate's content styles (` + "`.markdown-body`" + `, tables, code blocks) |

Link ` + "`agentgate:tokens`" + ` and ` + "`agentgate:renderer`" + ` if you want the webapp to look like the
rest of AgentGate; skip them and style it yourself otherwise.

Example ` + "`index.html`" + ` using several at once:

` + "```" + `html
<link rel="stylesheet" href="agentgate:highlight-css">
<script src="agentgate:marked"></script>
<script src="agentgate:highlight"></script>
<script src="agentgate:mermaid"></script>

<div id="out"></div>
<script>
  document.getElementById("out").innerHTML = marked.parse("# Report\n\nSome **text**.");
  document.querySelectorAll("pre code").forEach((el) => hljs.highlightElement(el));
  mermaid.initialize({ startOnLoad: true });
</script>
` + "```" + `

Each reference also accepts the longer spellings ` + "`agentgate://vendor/<name>.js`" + ` and
` + "`/static/vendor/<real-filename>`" + `. Anything not in the tables above is left untouched:
a bundle-local path resolves from the uploaded files, and a remote URL stays remote — which
means the sandbox will block it.

Use ` + "`agentgate webapp <dir>`" + ` to upload. The directory must contain ` + "`index.html`" + ` at its root.

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

- [GitHub repository](https://github.com/siygle/agentgate)
- [CLI releases](https://github.com/siygle/agentgate/releases)
- [Go module](https://pkg.go.dev/github.com/siygle/agentgate)

## Creating a Skill

To create a skill or integration for AgentGate CLI, an agent needs to:

1. Check that ` + "`agentgate`" + ` is installed (run ` + "`agentgate key-get`" + ` to verify)
2. If not installed, run ` + "`go install github.com/siygle/agentgate/cmd/agentgate@latest`" + `
3. Ensure ` + "`AGENTGATE_SERVER`" + ` and ` + "`AGENTGATE_PASSPHRASE`" + ` are set
4. Use the CLI commands to share diffs, files, docs, plans, or webapps
5. Present the public Preview/Docs/Plan/App URL to the user
6. Keep the passphrase and Manage URL private unless the user explicitly asks for ownership controls

Example workflow for sharing the latest commit:

    agentgate git-latest -s %s

The command prints a human-readable URL line, such as ` + "`Preview URL: https://...`" + `. Extract that URL and share it with the user. Do not reveal ` + "`AGENTGATE_PASSPHRASE`" + ` in chat.
`
