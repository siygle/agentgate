# CLI reference

The CLI encrypts locally and uploads ciphertext. It is a single Go binary and behaves
identically against either backend — point it at a self-hosted server or a Cloudflare
Worker with `AGENTGATE_SERVER`.

## Commands

| Command | Description |
|---------|-------------|
| `agentgate key-gen [key]` | Generate or set the encryption passphrase |
| `agentgate key-get` | Print the current passphrase |
| `agentgate git-latest` | Encrypt & share the latest commit diff |
| `agentgate git-staged` | Encrypt & share staged changes |
| `agentgate files <paths...>` | Encrypt & share file contents |
| `agentgate docs <file\|dir>` | Encrypt & share Markdown/MDX documents |
| `agentgate plan <file\|dir>` | Encrypt & share a visual plan bundle |
| `agentgate webapp <dir>` | Encrypt & share a runnable static webapp |
| `agentgate list` | List shares this machine created |
| `agentgate rekey <id\|url>` | Re-encrypt a share under a new passphrase |
| `agentgate recovery-keygen` | Generate an offline recovery keypair (see [admin.md](admin.md)) |

## Flags and environment

| Env | Flag | Description |
|-----|------|-------------|
| `AGENTGATE_SERVER` | `-s, --server` | Server URL (required) |
| `AGENTGATE_PASSPHRASE` | `-p, --passphrase` | Encryption passphrase |
| — | `-t, --ttl` | Share lifetime, e.g. `30m`, `24h`, `7d`. Default `7d` |
| — | `--no-expiry` | Create the share with indefinite retention enabled |
| `AGENTGATE_MASTER_PASSPHRASE` | `-m, --master` | Unlocks passphrases stored in the local share registry |
| `AGENTGATE_RECOVERY_PUBKEY` | — | Adds a recovery wrap to uploads — read [admin.md](admin.md) first |

`--no-expiry` is mutually exclusive with `-t/--ttl`.

For unattended agents, set `AGENTGATE_PASSPHRASE` through your normal secrets mechanism
rather than relying on an interactive shell profile.

## Share URLs

Every share previews at `/s/{id}` regardless of kind — the viewer picks how to render it
from the decrypted payload, not from the URL. Uploads print a public Preview URL and a
private Manage URL:

```text
Preview URL: https://your-domain.com/s/ABC123
Manage URL:  https://your-domain.com/s/ABC123#owner=<owner-token>
```

Keep the Manage URL private: anyone holding it can toggle indefinite retention for that
share. The owner token lives in the URL *fragment*, so it is never sent to the server
during a normal page load.

The older kind-specific links (`/p/`, `/f/`, `/app/`, `/plan/`, `/d/`) still resolve and
always will, so any link already handed out keeps working. They are simply no longer
issued.

If the server returns a `localhost`/`127.0.0.1` link (because its `--base-url` was left at
the default) the CLI rewrites the scheme and host to match the `-s`/`AGENTGATE_SERVER`
address you uploaded to, so the printed links stay usable.

## Notes per share kind

### `docs` — documents

Encrypts a Markdown/MDX file or folder and renders it as written. AgentGate adds no
visual-plan labels, recap labels, or feedback UI in this mode. Use it for specs, reports,
notes, and design docs where the uploaded file structure should be preserved as-is.

### `plan` — visual plan

Encrypts a `plan.mdx`, `plan.md`, or plan folder and renders it as a reviewable visual
plan: `plan.mdx` is the entry document when present, with a sidebar listing the rest of
the bundle, plus a local-only review-notes panel.

Designed for Agent-Native-style `/visual-plan` output in local-files form. MDX components
(`Callout`, `DataModel`, `Endpoint`, `Mermaid`, `Diagram`, `FileTree`, `AnnotatedCode`,
`Diff`, `Checklist`, `QuestionForm`) are rendered by the doc renderer.

### `webapp` — runnable prototype

Encrypts a directory of static files and runs it as a self-contained page inside the
render sandbox. The directory must contain `index.html` at its root.

Referenced local stylesheets and scripts (`<link href>`, `<script src>`) are inlined;
local `<img>`/`<audio>`/`<video>`/SVG and CSS `url(...)`/`@font-face` references become
data URIs. Binary assets (PNG/JPG/GIF/WebP, fonts, MP3/MP4, WASM, …) are base64-embedded
into the encrypted bundle, so images, fonts, and media render with no external requests.

This is for sharing runnable prototypes, not hosting a site:

- **Must be self-contained.** The frame runs under `default-src 'none'; connect-src 'none'`
  so it **cannot make any network request** — no `fetch`, XHR, WebSocket, or external
  image/font/script. A webapp that calls an external API will not work. That restriction is
  what keeps decrypted content from being exfiltrated off the viewer page.
- **Bundle size.** Binary assets grow the encrypted payload. The CLI warns past a ~1 MB
  soft budget; the server enforces a hard limit (Cloudflare D1-only mode ~2 MB per share —
  raise it with R2, or `AGENTGATE_MAX_UPLOAD_BYTES` on self-host). Oversized uploads get
  HTTP 413.
- **Opaque origin.** The iframe runs without `allow-same-origin`, so `localStorage` and
  cookies are unavailable to the app by design.
- **Recognised by contents, not URL.** A bundle with `index.html` at the root runs as a
  webapp at any of its links; one without renders as a plain file bundle.

Rendering libraries (markdown, syntax highlighting, diagrams, charts) are available inside
the sandbox without bundling them — see [agents.md](agents.md#built-in-libraries).

## Managing expiry

AgentGate mints an owner token per share and stores only its SHA-256 hash. Opening the
Manage URL shows a keep-forever toggle. Turning it on makes the share never expire; turning
it off restores normal expiration, and if the previous deadline has already passed the
server resets it to the default 7 days.

The same operation is available over HTTP:

```bash
curl -X PATCH https://your-domain.com/api/files/ABC123 \
  -H "Authorization: Bearer <owner-token>" \
  -H "Content-Type: application/json" \
  -d '{"never_expires":true}'
```

Use `/api/diff/{id}` for diff shares and `/api/files/{id}` for everything else. See
[api-contract.md](api-contract.md) for the full API.

Operators can manage *every* share in a deployment from the `/admin` dashboard — see
[admin.md](admin.md).
