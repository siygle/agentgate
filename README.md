# AgentGate

Self-hosted, end-to-end encrypted sharing for the things a coding agent produces — diffs,
files, documents, plans, and runnable prototypes.

Content is encrypted on your machine with AES-256-GCM before upload. The server only ever
stores ciphertext, and never sees the passphrase. Recipients open a link, enter the
passphrase, and everything is decrypted and rendered in their browser.

Runs as a single Go binary with SQLite, or on Cloudflare Workers.

## How it works

1. **Encrypt locally** — the CLI encrypts before uploading. The server never sees plaintext.
2. **Share a link** — you get `your-server.com/s/ABC123`. The passphrase goes out-of-band.
3. **Auto-expiry** — 7 days by default, overridable per upload, or `--no-expiry`.
4. **Owner controls** — each upload also returns a private Manage URL for retention.

Decrypted content is rendered inside a sandboxed, network-less iframe rather than on the
page holding the decryption key. That boundary is the main design constraint of the project
— see [docs/architecture.md](docs/architecture.md).

## Quick start

Run a server:

```bash
./agentgate-server --port 8080 --base-url https://your-domain.com
# or: docker compose up -d
```

Then share something:

```bash
export AGENTGATE_SERVER=https://your-domain.com
agentgate key-gen && source ~/.zshrc   # first time only

agentgate git-latest              # latest commit diff
agentgate git-staged              # staged changes
agentgate files src/foo.ts        # arbitrary files
agentgate docs ./notes.md         # Markdown/MDX documents
agentgate plan ./plans/my-plan    # a reviewable visual plan
agentgate webapp ./dist           # a runnable static prototype

agentgate files -t 24h src/foo.ts     # custom TTL
agentgate files --no-expiry src/foo.ts
```

Every share previews at `/s/{id}`; the viewer works out how to render it from the decrypted
payload.

## What you can share

| Command | Renders as |
|---------|-----------|
| `git-latest`, `git-staged` | Split/unified diff with syntax highlighting |
| `files` | File browser with markdown preview and per-block copy |
| `docs` | Markdown/MDX document, as written |
| `plan` | Visual plan — MDX components, mermaid diagrams, review notes |
| `webapp` | A self-contained static page, run in the sandbox |

## Documentation

| | |
|---|---|
| [docs/cli.md](docs/cli.md) | Commands, flags, share URLs, per-kind notes, managing expiry |
| [docs/agents.md](docs/agents.md) | Wiring AgentGate into a coding agent; built-in libraries for webapps |
| [docs/self-host.md](docs/self-host.md) | Server options, Docker, systemd, blob storage, builds, tests |
| [docs/cloudflare.md](docs/cloudflare.md) | Deploying on Workers with D1 (R2 optional) |
| [docs/admin.md](docs/admin.md) | Owner dashboard, and passphrase recovery via an offline key |
| [docs/architecture.md](docs/architecture.md) | How rendering is sandboxed, project layout, encryption |
| [docs/api-contract.md](docs/api-contract.md) | The HTTP contract both backends implement |

A running server also serves `/llms.txt` and `/llms-full.txt` for agents.

## Security

- **AES-256-GCM** content encryption, **PBKDF2-SHA256** key derivation (600,000 iterations)
- Client-side encryption only — the server stores ciphertext and never sees the passphrase
- Decrypted content renders in an opaque-origin iframe under `connect-src 'none'`, so it can
  reach neither the decryption key nor the network
- Owner tokens are returned once, stored only as SHA-256 hashes, and travel in the URL
  fragment so they are not sent to the server on a page load
- Optional offline recovery key for resetting a share whose passphrase was lost
- Everything auto-expires by default

## Tech stack

- **Self-host server** — Go, Chi, SQLite (pure Go, no CGO), embedded assets
- **Cloudflare Worker** — TypeScript, Hono, D1 (+ optional R2), on workerd
- **CLI** — Go, single cross-compiled binary
- **Frontend** — vanilla JS, shared verbatim by both backends

Both backends implement the same contract and are verified against it by
`test/contract/run.mjs`.

## Credits

Rewritten in Go from [diff4](https://github.com/djyde/diff4) by
[Randy Lu](https://x.com/randyloop). The original is built with Next.js, PostgreSQL, and
Prisma; this rewrite swaps that for Go + SQLite to get a lighter, single-binary self-hosted
deployment.
