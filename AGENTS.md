# render4 — diff4 encrypted diff/file sharing platform

## Monorepo layout

- `packages/server/` — Next.js 16 app (pnpm). Has its own git repo and `AGENTS.md`.
- `packages/cli/` — Bun CLI (`@diff4/cli`). Commander.js, builds to standalone binaries via `bun build`.
- `skills/diff4/` — OpenCode skill definition for the CLI.
- `docker-compose.yml` — PostgreSQL 16 for the server (port 59876, user/db `postgres`/`render4`).

The two packages use **different package managers** and **different runtimes**: pnpm/Node for server, Bun for CLI.

## Server setup (from `packages/server/`)

```bash
docker compose up -d          # from repo root — starts PostgreSQL
pnpm install
pnpm db:generate              # generates Prisma client to app/generated/prisma (gitignored)
pnpm db:push                  # pushes schema to DB
pnpm dev                      # Next.js dev server on :3000
```

Requires `.env` with `DATABASE_URL` and `NEXT_PUBLIC_BASE_URL` (see `packages/server/.env` for local defaults).

## Server commands (from `packages/server/`)

- **Lint:** `pnpm lint` (flat ESLint config with eslint-config-next)
- **Typecheck:** `npx tsc --noEmit` — do NOT use `next build` for type checking
- **Build:** `pnpm build` (produces standalone output for Docker)

## CLI commands (from `packages/cli/`)

- **Dev:** `bun run src/index.ts`
- **Build:** `bun run build` (single JS file)
- **Cross-platform binaries:** `bun run build:binary`
- **Lint:** `tsc --noEmit`

## Key conventions

- **Prisma client location** is `app/generated/prisma` (non-default). Import via `@/app/generated/prisma/client`.
- **API routes** must use `ok(data)` / `err(error)` from `@/lib/api-response` — never return raw JSON.
- **Server actions** use `next-safe-action` via `@/lib/safe-action`.
- **Prisma adapter** is `@prisma/adapter-pg` (not the default driver adapter). Config in `prisma.config.ts` loads `dotenv/config`.
- **Next.js is version 16** — APIs may differ from training data. Check `node_modules/next/dist/docs/` if unsure.
- **fumadocs** powers `/docs` from MDX in `content/docs/`. Generated output in `.source` (gitignored).
- **Tailwind CSS v4** with `@tailwindcss/postcss` (not v3 config format).
- **UI libraries:** shadcn (radix-ui), base-ui, lucide-react, motion.
- **Release:** Git tags (`v*`) trigger `.github/workflows/release.yml` which builds CLI binaries and attaches to GitHub Release.

## Architecture quick reference

- `/` — Landing page
- `/p/[id]` — Diff viewer (decrypts client-side)
- `/f/[id]` — File bundle viewer (decrypts client-side)
- `/docs` — fumadocs MDX documentation
- `/api/diff`, `/api/files`, `/api/search` — API routes
- `lib/crypto.ts` — AES-256-GCM encryption/decryption (shared logic with CLI)
- `components/ai/` — AI-related UI components
