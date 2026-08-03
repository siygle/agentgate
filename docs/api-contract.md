# AgentGate HTTP API contract

This contract is the **single source of truth** shared by both backends:

- **Self-host** — Go server (`cmd/server`, `internal/server`).
- **Cloudflare** — TypeScript Worker (`worker/`).

The Go CLI (`cmd/agentgate`) and the browser frontend (`web/static`) talk to whichever
backend `AGENTGATE_SERVER` points at. Both backends MUST implement this contract
identically; `test/contract/` verifies both against it.

All content is end-to-end encrypted client-side. The server only ever stores/returns
ciphertext blobs and metadata — it never sees plaintext.

## Response envelope

Every JSON endpoint responds with:

```jsonc
{ "success": true,  "data": { /* ... */ } }   // 2xx
{ "success": false, "error": "message" }       // 4xx/5xx
```

## Endpoints

### `POST /api/diff` · `POST /api/files`

Create an encrypted share. Body:

```jsonc
{
  "encrypted_data": { "ciphertext": "b64", "iv": "b64", "salt": "b64" }, // all required, non-empty
  "expires_in_seconds": 604800,   // optional; default 7d; ignored when never_expires
  "never_expires": false          // optional
}
```

- `201 Created`:

```jsonc
{ "success": true, "data": {
  "preview_url": "<base>/p/ABC123" | "<base>/f/ABC123",
  "manage_url":  "<preview_url>#owner=<owner_token>",
  "id": "ABC123",
  "owner_token": "<returned once; server stores only its SHA-256 hex hash>"
}}
```

- `400` if `ciphertext`/`iv`/`salt` missing or empty.

`encrypted_data` is stored **verbatim** as an opaque object: the server validates only
that `ciphertext`/`iv`/`salt` are present and non-empty, then persists (and later
returns) whatever JSON object was sent, unchanged. This lets clients add extra keys —
e.g. the v2 envelope's `v`, `iv_p`, `wrap_pass`, `wrap_recov` — without any server-side
schema change; a later `GET` returns them exactly as uploaded.

### `GET /api/diff/{id}` · `GET /api/files/{id}`

Fetch a share's ciphertext + expiry metadata (used by the frontend, Plan B).

- `200 OK`:

```jsonc
{ "success": true, "data": {
  "encrypted_data": { "ciphertext": "b64", "iv": "b64", "salt": "b64" },
  "expires_at": "2026-07-13T10:00:00Z",  // RFC3339; omitted/empty when never_expires
  "never_expires": false,
  "id": "ABC123",
  "kind": "diff" | "files"
}}
```

- `404` when the id does not exist **or** the share is expired (`!never_expires && expired_at <= now`).
  Body: `{ "success": false, "error": "not found" }`.

### `PATCH /api/diff/{id}` · `PATCH /api/files/{id}`

Toggle indefinite retention. Requires `Authorization: Bearer <owner_token>`.

Body: `{ "never_expires": true | false }` (required).

- `200 OK`: `{ "success": true, "data": { "id", "never_expires", "expires_at?": "RFC3339" } }`
  - When turning expiry back **on** and the stored deadline is already in the past,
    the server resets `expired_at` to `now + 7d` and returns the new `expires_at`.
- `400` missing/invalid body, `401` missing/invalid bearer token, `404` not found.

`kind` mapping: diff shares live under `/p/{id}` and `/api/diff/{id}`; everything else
(files, webapp, plan, docs) lives under `/f|/app|/plan|/d/{id}` and `/api/files/{id}`.

## Owner dashboard (instance-admin) endpoints

The `/admin` dashboard lets the **instance operator** see and manage *every* share
in the deployment. These endpoints are authenticated by an **admin session**
(distinct from per-share owner tokens) and are **same-origin only** — they never
carry `Access-Control-Allow-Origin: *`. The whole subsystem is disabled (fail
closed) unless a session secret is configured (`AGENTGATE_SESSION_SECRET` /
`SESSION_SECRET`); when disabled, protected routes return `503`.

Auth is established two ways:

- **Owner key** — `POST /api/admin/login/owner-key` with `{ "key": "<secret>" }`.
  Compared (SHA-256 hex, constant time) against the configured owner key, rate-limited
  per client IP. On success sets an `HttpOnly; SameSite=Strict` session cookie
  (`agentgate_admin`, HMAC-signed, default 12h; `Secure` on https deployments).
  Disabled (`404`) when no owner key is configured.
- **Cloudflare Access** — a valid `Cf-Access-Jwt-Assertion` header authenticates the
  request with no cookie. The JWT is fully verified: RS256 signature against the team
  JWKS, exact `aud`, issuer (team domain), and expiry, plus an optional email allowlist.
  On Go self-host this is gated by `AGENTGATE_CF_ACCESS_ENABLED` and should only be
  enabled behind Cloudflare (see deployment docs).

State-changing admin POSTs additionally verify the `Origin` header against the base
URL (CSRF defense-in-depth); a mismatched Origin returns `403`.

### `GET /api/admin/session` (public status probe)

`200 OK`: `{ "success": true, "data": {
  "authenticated": bool, "method?": "owner-key|passkey|cf-access",
  "exp?": <unix>, "enabled": bool, "methods": ["owner-key", "cf-access", ...] }}`.
The dashboard uses this to render the login card vs the table.

### `POST /api/admin/logout`

Clears the session cookie. `200 OK`.

### `GET /api/admin/shares` (requires admin session)

Lists every diff + file bundle, metadata only — **never** ciphertext. Query params
(all optional, whitelisted): `limit` (default 50, max 200), `offset`, `sort`
(`created_at`|`expired_at`), `order` (`asc`|`desc`), `status` (`all`|`active`|`expired`),
`kind` (`all`|`diff`|`files`).

```jsonc
{ "success": true, "data": {
  "items": [{
    "id": "ABC123", "kind": "diff" | "files",
    "created_at": "2026-07-13T10:00:00Z",   // RFC3339 on both backends
    "expired_at": "2026-07-20T10:00:00Z",   // omitted when never_expires
    "never_expires": false,
    "storage": "inline" | "blob" | "r2",     // "blob" = Go filesystem, "r2" = Worker R2
    "byte_size": 4096,                        // int for inline records, null for blob/r2
    "status": "active" | "expired"
  }],
  "total": 128, "limit": 50, "offset": 0
}}
```

### `PATCH /api/admin/{kind}/{id}` (requires admin session)

Keep-forever toggle. Body `{ "never_expires": true|false }`. Same reset-when-past rule
as the public PATCH. `200 OK`: `{ "id", "never_expires", "expires_at?" }`. `404` unknown
kind or id.

### `POST /api/admin/{kind}/{id}/revoke` (requires admin session)

Makes the share immediately inaccessible by setting `never_expires=0, expired_at=now`.
The public `GET` then returns `404` immediately; the cleanup sweeper hard-deletes it (and
its blob) later. Until swept it still appears in the admin list as `status: "expired"`.
`200 OK`: `{ "id", "kind", "status": "expired" }`.

### `POST /api/admin/{kind}/{id}/reshare` (requires admin session)

Issues a **new access link** for the same content: copies the stored ciphertext/blob to a
fresh id with a new owner token. Zero-knowledge preserved — the passphrase is unchanged,
so recipients use the new URL with the same passphrase. The source record is untouched.
Optional body `{ "never_expires?", "expires_in_seconds?" }` sets the new record's expiry
(defaults to a fresh 7-day TTL). `200 OK`: same shape as create
(`preview_url`, `manage_url`, `id`, `owner_token`).

### `DELETE /api/admin/{kind}/{id}` (requires admin session)

Hard-deletes the record now and unlinks its filesystem/R2 blob. `200 OK`:
`{ "id", "kind", "deleted": true }`. `404` unknown kind or id.

### `GET /api/admin/{kind}/{id}/recovery-dek` (requires admin session)

Returns the recovery-wrapped DEK so the operator can unwrap it offline with the
recovery private key. `200 OK`: `{ "success": true, "data": { "v": 2,
"wrap_recov": { "epk", "iv", "ct" } } }`. `409` when the share has no recovery
wrap (v1, or uploaded without a recovery key). `404` unknown kind/id. Safe to
expose to an authenticated admin — useless without the offline private key.

### `POST /api/admin/{kind}/{id}/reset-reshare` (requires admin session)

Mints a new share for the same content under a NEW passphrase wrap and revokes
the source (old passphrase can no longer decrypt anything reachable). Body:
`{ "salt", "iv_p", "wrap_pass" }` (all required — the browser computes these
after recovering the DEK offline) plus optional `{ "never_expires",
"expires_in_seconds" }`. The server keeps `ciphertext`, `iv`, and `wrap_recov`
from the source unchanged. `200 OK`: create shape (`preview_url`, `manage_url`,
`id`, `owner_token`). `409` not reset-capable; `400` missing wrap fields; `404`
unknown kind/id. Origin-checked.

## Page routes (Plan B: static HTML + fetch)

`/`, `/p/{id}`, `/f/{id}`, `/app/{id}`, `/plan/{id}`, `/d/{id}` (GET + HEAD) return a
**static HTML shell** (no server-side content injection). The shell's client JS derives
`kind`+`id` from the path, calls the matching `GET /api/…/{id}`, and renders after the
viewer decrypts. Missing/expired shares therefore return `200` for the shell and `404`
from the API (the page then renders a not-found state) — a deliberate change from the
old server-rendered `404` page.

### Renderer assets

Share content is not rendered by the shell; it runs in a sandboxed iframe built from a
built-in renderer. Both backends must therefore serve `/static/renderers/**` as static
assets, and must serve a `.html` path **literally** rather than redirecting it:
`sandbox.js` fetches `/static/renderers/<name>/frame.html`.

- Go: covered by `//go:embed static` + the `/static/*` file server.
- Worker: `sync-assets` copies `renderers/` into `public/static/`, and
  `wrangler.jsonc` sets `assets.html_handling: "none"` — the default would
  `307` redirect `frame.html` to an extension-less URL.

## CORS

The **public share API** (`/api/diff*`, `/api/files*`) and pages use permissive,
self-hosted-tool defaults: `Access-Control-Allow-Origin: *`, methods
`GET, POST, PATCH, PUT, DELETE, OPTIONS`, headers `Content-Type, Authorization`.

The **admin surface** (`/admin`, `/api/admin/*`) is same-origin and cookie-authenticated:
it is deliberately excluded from the permissive CORS and carries no
`Access-Control-Allow-Origin` header.
