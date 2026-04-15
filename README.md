# AgentGate

A lightweight, self-hosted encrypted diff & file sharing tool. Rewritten in Go from [diff4](https://github.com/djyde/diff4).

Single binary, SQLite storage, zero external dependencies. All content is encrypted end-to-end with AES-256-GCM — the server never sees plaintext.

## How it works

1. **Encrypt locally** — diffs and files are encrypted with AES-256-GCM on your machine before upload. The server never sees plaintext.
2. **Share a link** — get a URL like `your-server.com/p/ABC123`. Recipients need the passphrase to decrypt.
3. **Auto-expiry** — all content expires after 24 hours.

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
```

## CLI commands

| Command | Description |
|---------|-------------|
| `agentgate key-gen [key]` | Generate or set encryption passphrase |
| `agentgate key-get` | Print current passphrase |
| `agentgate git-latest` | Encrypt & share the latest commit diff |
| `agentgate git-staged` | Encrypt & share staged changes |
| `agentgate files <paths...>` | Encrypt & share file contents |

All upload commands accept `-s, --server <url>` and `-p, --passphrase <key>` flags.

## CLI environment variables

| Env | Flag | Description |
|-----|------|-------------|
| `AGENTGATE_SERVER` | `-s, --server` | Server URL (required) |
| `AGENTGATE_PASSPHRASE` | `-p, --passphrase` | Encryption passphrase |

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

## Security

- **AES-256-GCM** encryption
- **PBKDF2-SHA256** key derivation with 600,000 iterations
- Client-side encryption only — the server stores ciphertext
- Passphrase shared out-of-band by you
- All content auto-expires after 24 hours

## Tech stack

- **Server** — Go, Chi router, SQLite (pure Go, no CGO), embedded static assets
- **CLI** — Go, cross-compiled to single binaries
- **Frontend** — Vanilla JS, diff2html, highlight.js, marked.js

## Project structure

```
cmd/server/        Server entry point
cmd/cli/           CLI entry point
internal/server/   HTTP handlers, router, middleware
internal/db/       SQLite database layer
internal/crypto/   AES-256-GCM encryption
internal/id/       ID generation
internal/cleanup/  Expired content cleanup
web/templates/     HTML templates
web/static/        CSS, JS, vendor libraries
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
