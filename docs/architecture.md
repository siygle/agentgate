# Architecture

Two interchangeable backends behind one shared HTTP API and one shared frontend:

- **Self-host server** — Go, Chi router, SQLite (pure Go, no CGO), embedded static assets.
  Single binary; this is what the Dockerfile ships.
- **Cloudflare Worker** — TypeScript, Hono, D1 (optional R2 for blobs via `USE_R2`), Cron
  Trigger cleanup. Runs on the Workers runtime (workerd), **not** Node.
- **CLI** — Go, cross-compiled to single binaries, unchanged across both backends.
- **Frontend** — vanilla JS in `web/static`, shared verbatim by both backends. Pages fetch
  ciphertext via the JSON API and decrypt in the browser.

Node.js appears only as build and test tooling — wrangler/vitest for the Worker, the
contract-test runner, the frontend unit tests, `tools/mdx-bundle` (esbuild), and
`worker/scripts/sync-assets.mjs`. It is never a runtime.

[api-contract.md](api-contract.md) is the single source of truth both backends implement;
`test/contract/` verifies each against it.

## How share content is rendered

Every share — diff, files, documents, visual plan, uploaded webapp — is viewed at `/s/{id}`
and rendered the same way.

The page you open holds the decryption key, your remembered passphrase, and, if you are the
operator, an admin session cookie. So **it does not interpret share content at all**. It
decrypts, then hands the result to `web/static/js/sandbox.js`, which assembles a
self-contained document and runs it in an **opaque-origin `<iframe srcdoc>`** under
`default-src 'none'; connect-src 'none'`. Framed content cannot reach the host page's DOM or
storage, and cannot make a network request of any kind.

Two things run in that frame:

- **Built-in renderers** in `web/static/renderers/`: `diff`, `files`, and `doc` (documents
  and visual plans — markdown, MDX, mermaid, wireframes), sharing the host bridge and
  in-frame find bar in `common/`. Their scripts resolve from the *server*, never from the
  payload, so a share cannot substitute its own `renderer.js`.
- **Uploaded webapps** (`agentgate webapp`), which supply their own `index.html`.

`web/static/js/share-kind.js` picks between them from the decrypted payload, so the URL does
not decide how something renders. That is what lets the older `/p/ /f/ /app/ /plan/ /d/`
links stay permanent aliases: a `--no-expiry` share must keep resolving forever, and it
opens through the same shell.

Everything outside the frame — header, expiry badge, owner toggle, display settings, export,
review notes, the address bar — is host chrome in `web/static/js/shell.js`. The two sides
talk over a small `postMessage` bridge: the frame reports its content height (so the host
grows the iframe and the page keeps a single scrollbar), its current file, and its scroll
anchor; the host sends display settings, deep links, print scope. Values coming *from* the
frame are treated as untrusted and sanitised before use.

### Two consequences worth knowing

**The host CSP is deliberately not uniform.** A `srcdoc` iframe *inherits* its parent's CSP
and the effective policy is the intersection of the two. The sandbox is assembled entirely
from inline scripts (every library is inlined, because the frame has no network) and MDX
compilation additionally needs `'unsafe-eval'`. So a page embedding the sandbox cannot be
stricter than the sandbox needs. The strict `script-src 'self'` therefore applies to the
landing page and the admin dashboard, and only the share shell relaxes it; both keep
`connect-src 'self'` and `frame-ancestors 'none'`, and neither permits a third-party script
origin. `web/static/js/landing.js` and `share-boot.js` exist so that no page needs an inline
script of its own.

**Libraries are vendored, and inlined only when used.** A CDN script on the origin holding
the decryption key could read it, and the frame has no network anyway — so rendering
libraries live in `web/static/vendor/` and are inlined into the frame via `agentgate:`
references. `share-kind.js`'s `detectFeatures` inspects the payload so only what the content
actually needs gets inlined: a prose document is ~101 KB of srcdoc, one with a mermaid
diagram ~3.4 MB. See [`web/static/vendor/VERSIONS.md`](../web/static/vendor/VERSIONS.md) for
the pins and the reasoning.

## Project structure

```
cmd/server/        Self-host server entry point
cmd/agentgate/     CLI entry point (shared by both backends)
cmd/crossvector/   Go<->JS v2-envelope interop test vector (regression check)
internal/server/   HTTP handlers, router, middleware, admin subsystem
internal/db/       SQLite layer
internal/crypto/   AES-256-GCM + v2 envelope (CLI side)
internal/blobstore/ Filesystem blob storage (AGENTGATE_BLOB_DIR)
internal/cleanup/  Expired content cleanup (goroutine)
internal/id/       Share ID generation

web/static/        Shared frontend — single source of truth for both backends
  css/tokens.css     Design tokens + reset — used by host chrome AND the sandbox
  css/style.css      Host chrome only (never styles share content)
  css/renderer.css   Share-content styles, inlined into the sandbox
  js/sandbox.js      Assembles + runs share content in the opaque-origin iframe
  js/shell.js        Host chrome around a sandboxed renderer
  js/share-kind.js   Picks a renderer, and which libraries to inline, from the payload
  renderers/common/  Host bridge + find bar shared by the renderers
  renderers/{diff,files,doc}/   Built-in renderers
  vendor/            Pinned third-party libs (see vendor/VERSIONS.md)
  views/             share.html (all share routes) + admin.html
  *.node.test.mjs    Frontend unit tests (run with plain node)

worker/            Cloudflare Worker (TypeScript + Hono, D1 + optional R2)
tools/mdx-bundle/  Builds vendor/mdx-runtime.bundle.js (only on version bumps)
test/contract/     HTTP contract test, run against both backends
docs/              This documentation
```

## Encryption

- **AES-256-GCM** for content, **PBKDF2-SHA256** with 600,000 iterations for key derivation.
- Encryption is client-side only; the server stores and returns ciphertext verbatim and
  never sees plaintext or the passphrase.
- The v2 envelope wraps a random content key (DEK) under the passphrase and, optionally,
  under an offline recovery public key — see [admin.md](admin.md).
- Owner tokens are returned once and stored only as SHA-256 hashes. They travel in the URL
  *fragment*, so they are not sent to the server on a normal page load.
- `cmd/crossvector` plus `web/static/js/crypto.*.test.mjs` pin Go↔JS interop, so a change on
  either side that would break decryption of existing shares fails the build.
