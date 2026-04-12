# diff4

Beautiful file previews for AI coding agents. Turn your AI agent's file changes into shareable, beautifully rendered web pages — encrypted end-to-end.

## How it works

1. **Encrypt locally** — diffs and files are encrypted with AES-256-GCM on your machine before upload. The server never sees plaintext.
2. **Share a link** — get a URL like `diff4.com/p/abc123`. Recipients need the passphrase to decrypt.
3. **Auto-expiry** — all content expires after 24 hours.

## Install

```bash
# Install the CLI
npm install -g @diff4/cli

# Or use with AI agents
npx skills add djyde/diff4
```

## Quick start

```bash
# Set up encryption key (first time only)
diff4 key-gen
source ~/.zshrc   # or ~/.bashrc

# Share your latest commit diff
diff4 git-latest

# Share staged changes
diff4 git-staged

# Share arbitrary files
diff4 files src/foo.ts src/bar.ts
```

## CLI commands

| Command | Description |
|---------|-------------|
| `diff4 key-gen [key]` | Generate or set encryption passphrase |
| `diff4 key-get` | Print current passphrase |
| `diff4 git-latest` | Encrypt & share the latest commit diff |
| `diff4 git-staged` | Encrypt & share staged changes |
| `diff4 files <paths...>` | Encrypt & share file contents |

All upload commands accept `-s, --server <url>` and `-p, --passphrase <key>` flags.

## Security

- **AES-256-GCM** encryption
- **PBKDF2-SHA256** key derivation with 600,000 iterations
- Client-side encryption only — the server stores ciphertext
- Passphrase shared out-of-band by you

## Self-hosting

### Server

```bash
# Start PostgreSQL
docker compose up -d

# Set up the server
cd packages/server
pnpm install
pnpm db:generate
pnpm db:push

# Configure .env
# DATABASE_URL=postgresql://postgres:postgres@localhost:59876/render4
# NEXT_PUBLIC_BASE_URL=http://localhost:3000

pnpm dev
```

### CLI with custom server

```bash
# Set environment variable
export DIFF4_SERVER=https://your-server.com

# Or use the flag
diff4 git-latest -s https://your-server.com
```

## Tech stack

- **Server** — Next.js 16, PostgreSQL 16, Prisma, Tailwind CSS v4
- **CLI** — Bun, Commander.js, builds to standalone binaries
- **Docs** — fumadocs with MDX

## Monorepo structure

```
packages/server/   Next.js app (pnpm)
packages/cli/      CLI tool @diff4/cli (Bun)
skills/diff4/      OpenCode skill definition
```

## Release

Git tags (`v*`) trigger `.github/workflows/release.yml` which builds CLI binaries and attaches them to a GitHub Release.

## Author

Made by [Randy Lu](https://x.com/randyloop)
