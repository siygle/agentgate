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

## Page routes (Plan B: static HTML + fetch)

`/`, `/p/{id}`, `/f/{id}`, `/app/{id}`, `/plan/{id}`, `/d/{id}` (GET + HEAD) return a
**static HTML shell** (no server-side content injection). The shell's client JS derives
`kind`+`id` from the path, calls the matching `GET /api/…/{id}`, and renders after the
viewer decrypts. Missing/expired shares therefore return `200` for the shell and `404`
from the API (the page then renders a not-found state) — a deliberate change from the
old server-rendered `404` page.

## CORS

Permissive, self-hosted-tool defaults: `Access-Control-Allow-Origin: *`,
methods `GET, POST, PATCH, OPTIONS`, headers `Content-Type, Authorization`.
