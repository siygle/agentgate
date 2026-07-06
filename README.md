# AgentGate

A lightweight, self-hosted encrypted diff & file sharing tool. Rewritten in Go from [diff4](https://github.com/djyde/diff4).

Single binary, SQLite storage, zero external dependencies. All content is encrypted end-to-end with AES-256-GCM — the server never sees plaintext.

## How it works

1. **Encrypt locally** — diffs and files are encrypted with AES-256-GCM on your machine before upload. The server never sees plaintext.
2. **Share a link** — get a URL like `your-server.com/p/ABC123`. Recipients need the passphrase to decrypt.
3. **Auto-expiry** — all content expires after 7 days by default; upload commands can override TTL.
4. **Owner controls** — every new upload also returns a private Manage URL with an owner token. Open it to toggle whether a share should be kept indefinitely.

## Features

- End-to-end encrypted diff and file sharing
- Local CLI for sharing latest commits, staged changes, or arbitrary files
- Configurable TTL per upload (`30m`, `24h`, `7d`, etc.)
- `--no-expiry` uploads for shares that should be preserved from the start
- Private Manage URL (`#owner=...`) for toggling indefinite retention after upload
- Expiry badges in the web UI, including a preserved/permanent state
- Markdown rendering for shared `.md` files

## Quick start

### Run the server

```bash
# Single binary
./agentgate-server --port 8080 --base-url https://your-domain.com

# Or with Docker
docker compose up -d
```

### Use the CLI

```bash
# Set your server URL (required)
export AGENTGATE_SERVER=https://your-domain.com

# Set up encryption key (first time only)
agentgate key-gen
source ~/.zshrc   # or ~/.bashrc

# Share your latest commit diff
agentgate git-latest

# Share staged changes
agentgate git-staged

# Share arbitrary files
agentgate files src/foo.ts src/bar.ts

# Share a runnable static webapp (a directory containing index.html)
agentgate webapp ./dist

# Share generic encrypted documents (no visual-plan-specific UI)
agentgate docs ./docs/owner-mode-security-design.md

# Share an encrypted visual plan (plan.mdx / plan.md or a folder)
agentgate plan ./plans/my-plan

# Share with custom TTL
agentgate files -t 24h src/foo.ts
agentgate files -t 7d src/foo.ts

# Share without expiry
agentgate files --no-expiry src/foo.ts
```

## AI agent / skill setup

AgentGate works well as a small tool that coding agents can call when they need to share encrypted diffs, files, docs, plans, or static prototypes. The agent only needs the CLI, a server URL, and a passphrase.

### 1. Install the CLI where the agent runs

```bash
go install github.com/siygle/agentgate/cmd/agentgate@latest
```

Or place a prebuilt `agentgate` binary somewhere on the agent's `PATH`.

### 2. Configure non-interactive environment variables

Set these in the agent runtime, shell profile, `.envrc`, systemd unit, or secret manager:

```bash
export AGENTGATE_SERVER=https://your-domain.com
export AGENTGATE_PASSPHRASE="use-a-long-random-shared-passphrase"
```

For a local one-time setup you can also run:

```bash
agentgate key-gen
source ~/.zshrc   # or ~/.bashrc
```

For unattended agents, prefer setting `AGENTGATE_PASSPHRASE` explicitly through your normal secrets mechanism instead of relying on an interactive shell profile.

### 3. Add an agent skill/instruction

Example `SKILL.md` for agents that support filesystem-based skills:

```markdown
---
name: agentgate-share
description: Share encrypted code diffs, files, docs, plans, or static webapps with AgentGate. Use when the user asks for a secure preview/share link.
---

# AgentGate sharing

Use `agentgate` to create encrypted AgentGate links.

Before sharing:
1. Confirm `agentgate` is installed: `agentgate key-get`.
2. Confirm `AGENTGATE_SERVER` and `AGENTGATE_PASSPHRASE` are available.
3. Never print or commit the passphrase.
4. Keep the Manage URL private unless the user explicitly needs ownership controls.

Commands:
- `agentgate git-staged` — share staged changes.
- `agentgate git-latest` — share the latest commit diff.
- `agentgate files <paths...>` — share selected files.
- `agentgate docs <file|dir>` — share rendered Markdown/MDX documents.
- `agentgate plan <file|dir>` — share a visual plan bundle.
- `agentgate webapp <dir>` — share a runnable static prototype with `index.html`.

TTL:
- Default server TTL is 7 days.
- Use `-t 24h`, `-t 7d`, or `--no-expiry` when the user requests a different lifetime.

After upload, return the public Preview/Docs/Plan/App URL to the user. Do not expose the passphrase in chat; share it out-of-band if needed.
```

For pi, one possible location is `~/.pi/agent/skills/agentgate-share/SKILL.md`. Other agents can use the same text as a tool instruction or custom skill.

### 4. Optional: point agents at the LLM reference

A running AgentGate server exposes:

- `/llms.txt` — short integration index
- `/llms-full.txt` — complete CLI/API/encryption reference for agents

Add `https://your-domain.com/llms-full.txt` to your agent's project docs or retrieval sources when it supports URL-based documentation.

## CLI commands

| Command | Description |
|---------|-------------|
| `agentgate key-gen [key]` | Generate or set encryption passphrase |
| `agentgate key-get` | Print current passphrase |
| `agentgate git-latest` | Encrypt & share the latest commit diff |
| `agentgate git-staged` | Encrypt & share staged changes |
| `agentgate files <paths...>` | Encrypt & share file contents |
| `agentgate webapp <dir>` | Encrypt & share a runnable static webapp |
| `agentgate docs <file\|dir>` | Encrypt & share generic documents at `/d/{id}` |
| `agentgate plan <file\|dir>` | Encrypt & share a visual plan bundle at `/plan/{id}` |

All upload commands accept `-s, --server <url>`, `-p, --passphrase <key>`, `-t, --ttl <duration>`, and `--no-expiry` flags. TTL examples: `30m`, `24h`, `7d`.

`--no-expiry` is mutually exclusive with `-t/--ttl`.

## Sharing documents

`agentgate docs <file|dir>` encrypts a Markdown/MDX file or folder and returns a **Docs URL** at `/d/{id}`. After the recipient enters the passphrase, the bundle is decrypted in the browser and rendered according to the files you uploaded. AgentGate does not add `canvas.mdx`, visual-plan labels, recap labels, or feedback UI in generic document mode.

Use this mode for normal specs, reports, notes, and security design docs where the uploaded file structure should be preserved as-is.

## Sharing a visual plan

`agentgate plan <file|dir>` encrypts a `plan.mdx`, `plan.md`, or plan folder and returns a **Plan URL** at `/plan/{id}`. After the recipient enters the passphrase, the bundle is decrypted in the browser and rendered as a reviewable Markdown/MDX-style visual plan.

This first version is designed for Agent-Native-style `/visual-plan` output in local-files form: `plan.mdx` is used as the entry document when present, with a sidebar showing the rest of the bundled files. The server stores only encrypted data; plan text is never visible server-side.

## Sharing a webapp

`agentgate webapp <dir>` encrypts a directory of static files (the same end-to-end encryption as `files`) and returns an **App URL** at `/app/{id}`. After the recipient enters the passphrase, the bundle is decrypted in the browser, assembled into a single self-contained page, and run inside a sandboxed `<iframe>`.

The directory must contain `index.html` at its root. Referenced local stylesheets and scripts (`<link href>`, `<script src>`) are inlined; local `<img>`/SVG references become data URIs.

Limitations (this is for sharing runnable prototypes, not hosting a site):

- **Text assets only.** HTML/CSS/JS/SVG survive; binary assets (PNG, fonts, etc.) are skipped with a warning — embed them as data URIs or external URLs.
- **Opaque origin.** The iframe runs without `allow-same-origin`, so `localStorage`, cookies, and same-origin `fetch` are unavailable to the app by design.
- The same record is also viewable as a plain file bundle at `/f/{id}`, and the Manage URL controls retention for both views.

Successful uploads print both a public Preview URL and, on supported servers, a private Manage URL:

```text
Preview URL: https://your-domain.com/f/ABC123
Manage URL:  https://your-domain.com/f/ABC123#owner=<owner-token>
```

Keep the Manage URL private. Anyone with this URL can toggle indefinite retention for that share.

If the server returns a `localhost`/`127.0.0.1` link (because its `--base-url` was left at the default) the CLI rewrites the scheme and host to match the `-s`/`AGENTGATE_SERVER` address you uploaded to, so the printed links stay usable.

## CLI environment variables

| Env | Flag | Description |
|-----|------|-------------|
| `AGENTGATE_SERVER` | `-s, --server` | Server URL (required) |
| `AGENTGATE_PASSPHRASE` | `-p, --passphrase` | Encryption passphrase |
| — | `-t, --ttl` | Optional share lifetime, e.g. `24h`, `7d`, `30m`. Default: `7d` |
| — | `--no-expiry` | Create the share with indefinite retention enabled |

## Managing expiry

AgentGate creates an owner token for each new share and stores only its SHA-256 hash server-side. The token is returned once as part of the Manage URL fragment:

```text
https://your-domain.com/f/ABC123#owner=<owner-token>
```

When this URL is opened in the browser, the page shows a **永久保留** toggle. Turning it on sets the share to never expire; turning it off restores normal expiration. If the previous deadline is already in the past, the server resets expiration to the default 7 days.

The same operation is available through authenticated PATCH endpoints:

```bash
curl -X PATCH https://your-domain.com/api/files/ABC123 \
  -H "Authorization: Bearer <owner-token>" \
  -H "Content-Type: application/json" \
  -d '{"never_expires":true}'
```

Use `/api/diff/{id}` for diff shares and `/api/files/{id}` for file shares.

## Server options

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `--port` | `PORT` | `8080` | HTTP port |
| `--db` | `DATABASE_PATH` | `./agentgate.db` | SQLite database path |
| `--base-url` | `BASE_URL` | `http://localhost:8080` | Public base URL for shared links |

## Deployment

### Docker Compose

```yaml
services:
  agentgate:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - data:/data
    environment:
      BASE_URL: https://your-domain.com

volumes:
  data:
```

### systemd

```ini
[Unit]
Description=AgentGate server

[Service]
ExecStart=/usr/local/bin/agentgate-server --db /var/lib/agentgate/agentgate.db --base-url https://your-domain.com
Restart=always

[Install]
WantedBy=multi-user.target
```

### Cloudflare Workers

AgentGate can also run on Cloudflare Workers (edge, no server to host). The Worker
lives in [`worker/`](worker/) and is a TypeScript + Hono port of the same HTTP API,
with **hybrid storage**: share metadata in **D1**, encrypted blobs in **R2**, and a
**Cron Trigger** for expired-record cleanup. The frontend in `web/static` and the
CLI are shared unchanged — a shared HTTP contract (`docs/api-contract.md`) is
verified against both backends by `test/contract/`.

> **Why no one-click button?** The frontend in `web/static` is shared with the
> self-host server, so the Worker is intentionally *not* self-contained in `worker/`
> (its build step reads `../web/static`). Cloudflare's one-click "Deploy to Cloudflare"
> button isolates the chosen subdirectory and would miss those files. Connect the
> **full repo** via Workers Builds (below) so the shared assets are present at build time.

#### 1. Provision resources

```bash
cd worker
npm install
npx wrangler d1 create agentgate            # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create agentgate-blobs
```

#### 2. Deploy via Git (Workers Builds)

In the Cloudflare dashboard: **Workers & Pages → Create → Workers → Import a
repository**, select your fork of `siygle/agentgate`, and set:

- **Root directory**: `worker`
- **Build command**: `npm run build` (runs `sync-assets`)
- **Deploy command**: `npx wrangler deploy`

Cloudflare clones the **full repo** (so `../web/static` is available) and reads
`worker/wrangler.jsonc` to bind the D1 database and R2 bucket. Each push rebuilds.

Or deploy manually from a full checkout:

```bash
cd worker
npm run deploy                              # sync-assets, then wrangler deploy
```

#### 3. Apply migrations and set the public URL

```bash
npx wrangler d1 migrations apply agentgate --remote
```

Then set the `BASE_URL` variable (Worker → Settings → Variables) to your public URL
(`https://<name>.workers.dev` or a custom domain) so returned Preview/Manage links
are correct.

#### Local development

`npm run dev` runs `wrangler dev` with a local D1 + R2 and serves `web/static`. Apply
the local schema once with `npx wrangler d1 migrations apply agentgate --local`, then
verify with the shared contract test:
`node ../test/contract/run.mjs http://localhost:8787`.

The CLI does not change — point it at the Worker with
`export AGENTGATE_SERVER=https://<name>.workers.dev`.

## Security

- **AES-256-GCM** encryption
- **PBKDF2-SHA256** key derivation with 600,000 iterations
- Client-side encryption only — the server stores ciphertext
- Passphrase shared out-of-band by you
- Owner tokens are returned once and stored only as SHA-256 hashes
- Manage URLs use URL fragments (`#owner=...`), so owner tokens are not sent to the server during normal page loads
- All content auto-expires after 7 days by default, with per-upload TTL override or explicit no-expiry mode

## Tech stack

Two interchangeable backends behind one shared HTTP API and frontend:

- **Self-host server** — Go, Chi router, SQLite (pure Go, no CGO), embedded static assets
- **Cloudflare Worker** — TypeScript, Hono, D1 (metadata) + R2 (encrypted blobs), Cron Trigger cleanup
- **CLI** — Go, cross-compiled to single binaries (unchanged across both backends)
- **Frontend** — Vanilla JS, diff2html, highlight.js, marked.js; pages fetch ciphertext via the JSON API

## Project structure

```
cmd/server/        Self-host server entry point
cmd/agentgate/     CLI entry point (shared by both backends)
internal/server/   HTTP handlers, router, middleware
internal/db/       SQLite database layer
internal/crypto/   AES-256-GCM encryption (CLI)
internal/id/       ID generation
internal/cleanup/  Expired content cleanup (goroutine)
web/static/        Shared frontend: CSS, JS, vendor libs, static view shells (views/)
worker/            Cloudflare Worker (TypeScript + Hono, D1 + R2)
test/contract/     HTTP contract test run against both backends
docs/api-contract.md  Shared API contract (single source of truth)
```

## Building from source

```bash
# Build both binaries
make build

# Cross-compile for all platforms
make release

# Build Docker image
make docker
```

## Credits

Rewritten in Go from [diff4](https://github.com/djyde/diff4) by [Randy Lu](https://x.com/randyloop). The original project is built with Next.js, PostgreSQL, and Prisma. This rewrite replaces the stack with Go + SQLite for a lighter, single-binary self-hosted deployment.
