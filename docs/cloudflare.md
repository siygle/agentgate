# Deploying on Cloudflare Workers

AgentGate can run on Cloudflare Workers instead of a server you host. The Worker lives in
[`worker/`](../worker/) and is a TypeScript + Hono port of the same HTTP API, with a **Cron
Trigger** for expired-record cleanup. It runs on the Workers runtime (workerd), not Node.

The frontend in `web/static` and the CLI are shared unchanged; a shared HTTP contract
([api-contract.md](api-contract.md)) is verified against both backends by `test/contract/`.
The CLI needs no changes — just point it at the Worker:

```bash
export AGENTGATE_SERVER=https://<name>.workers.dev
```

## Storage: R2 is optional

Configured with the **`USE_R2`** variable:

| `USE_R2` | Storage | When |
|----------|---------|------|
| `false` (default) | **D1-only** — metadata *and* encrypted blobs in D1 | Works on the free tier, no R2 needed |
| `true` | **D1 + R2 hybrid** — metadata in D1, blobs in R2 | Best for very large webapp/plan bundles |

Everything works out of the box in D1-only mode. Enable R2 later without code changes;
existing D1-stored records keep working.

> **Why no one-click deploy button?** The frontend in `web/static` is shared with the
> self-host server, so the Worker is intentionally *not* self-contained in `worker/` — its
> build step reads `../web/static`. Cloudflare's one-click "Deploy to Cloudflare" button
> isolates the chosen subdirectory and would miss those files. Connect the **full repo** via
> Workers Builds (below) so the shared assets are present at build time.

## 1. Provision resources

D1-only (default) needs just a database:

```bash
cd worker
npm install
npx wrangler d1 create agentgate     # copy the printed database_id into wrangler.jsonc
```

To use R2 (optional): uncomment the `r2_buckets` block in `wrangler.jsonc`, set `USE_R2` to
`"true"` there, then:

```bash
npx wrangler r2 bucket create agentgate-blobs
```

## 2. Deploy via Git (Workers Builds)

In the Cloudflare dashboard: **Workers & Pages → Create → Workers → Import a repository**,
select your fork, and set:

- **Root directory**: `worker`
- **Build command**: `npm run build` (runs `sync-assets`)
- **Deploy command**: `npx wrangler deploy`

Cloudflare clones the **full repo** (so `../web/static` is available) and reads
`worker/wrangler.jsonc` to bind the D1 database and R2 bucket. Each push rebuilds.

Or deploy manually from a full checkout:

```bash
cd worker
npm run deploy      # sync-assets, then wrangler deploy
```

## 3. Apply migrations and set the public URL

```bash
npx wrangler d1 migrations apply agentgate --remote
```

Then set the `BASE_URL` variable (Worker → Settings → Variables) to your public URL
(`https://<name>.workers.dev` or a custom domain) so returned Preview/Manage links are
correct.

To enable the owner dashboard, set the `SESSION_SECRET` and `OWNER_KEY` **secrets**
(`wrangler secret put`) and the `CF_ACCESS_*` vars — see [admin.md](admin.md).

## Local development

```bash
cd worker
npx wrangler d1 migrations apply agentgate --local   # once
npm run dev                                          # sync-assets, then wrangler dev
node ../test/contract/run.mjs http://localhost:8787  # verify against the shared contract
```

Put `SESSION_SECRET` / `OWNER_KEY` in `worker/.dev.vars` (gitignored) if you need the admin
dashboard locally.

## Configuration notes

`wrangler.jsonc` sets `assets.html_handling: "none"`. This is required, not cosmetic: the
default `307`-redirects any `.html` path, and the viewer fetches
`/static/renderers/<name>/frame.html` to build the render sandbox. Without it every
document and plan share pays an extra redirect round trip and the two backends behave
differently. See [api-contract.md](api-contract.md#renderer-assets).
