# Design: Owner reset & re-share (envelope encryption with offline recovery key)

Date: 2026-07-22
Status: Draft — awaiting review

## 1. Goal

Give the instance operator ("owner") the ability to **reset & re-share** a
resource: invalidate the currently-shared passphrase/link and issue a fresh link
protected by a **new passphrase**, without ever exposing plaintext to the server.

Primary scenario (agreed): the shared passphrase has **leaked**. The owner wants
holders of the old passphrase locked out, and a brand-new link + passphrase for
trusted recipients.

## 2. Why an architecture change is required

Today the AES key is derived directly from the passphrase
(`web/static/js/crypto.js:24` — PBKDF2(passphrase) → AES-GCM key). With no
passphrase there is no key and no way to re-key: mathematically closed. To let
the owner re-key **without** the old passphrase we must decouple the content key
from the passphrase (envelope encryption) and add a second, owner-held recovery
path.

## 3. Threat model & security properties

**Hard requirement (agreed):** a full server/database compromise must NOT reveal
any plaintext.

Design consequence: the recovery path is **asymmetric**. Uploads wrap the content
key to a recovery **public** key; the matching **private** key never touches the
server and is held offline by the operator.

Resulting properties:

- Server breach → attacker gets ciphertext + both wrapped keys, but neither the
  passphrase nor the recovery private key → cannot decrypt. **Zero-knowledge
  preserved.**
- The recovery private key becomes the "crown jewel": whoever holds it can
  recover any v2 share's content key. This is an accepted, standard trade-off
  (analogous to a break-glass escrow / account recovery key). Mitigations:
  private key stays offline and SHOULD be encrypted at rest under its own
  passphrase.
- **Inherent limit (documented, not solvable):** reset only blocks *future*
  access. Content already exfiltrated by someone who had the old passphrase
  cannot be recalled.

## 4. Cryptographic design

### 4.1 Envelope (format v2)

Per resource, the client (CLI at upload) produces:

```
DEK            = random 256-bit key                       # content key
content_ct     = AES-256-GCM(DEK, iv_c, plaintext)        # the content
wrap_pass      = AES-256-GCM(KDF(passphrase, salt), iv_p, DEK)   # passphrase path
wrap_recov     = ECIES(recovery_pubkey, DEK)              # owner recovery path
```

- `KDF` = PBKDF2-HMAC-SHA256, 600 000 iterations (unchanged from v1).
- `ECIES` (agreed: **ECDH P-256**): generate an ephemeral P-256 keypair, do
  ECDH against `recovery_pubkey`, run the shared secret through HKDF-SHA256 to a
  256-bit key, then AES-256-GCM-wrap the DEK. Stored as
  `{ epk, iv, ct }` (ephemeral public key, IV, wrapped-DEK ciphertext), all b64.

### 4.2 Stored `encrypted_data` JSON

No new DB columns. The `encrypted_data` object carries the version + envelope:

**v1 (existing, unchanged):**
```jsonc
{ "ciphertext": "b64", "iv": "b64", "salt": "b64" }   // AES key = KDF(passphrase, salt)
```

**v2 (new):**
```jsonc
{
  "v": 2,
  "ciphertext": "b64",          // content_ct (AES-GCM under DEK)
  "iv": "b64",                  // iv_c (content IV)
  "salt": "b64",                // salt for the passphrase KDF (passphrase-wrap)
  "iv_p": "b64",                // IV for wrap_pass
  "wrap_pass": "b64",           // DEK wrapped under KDF(passphrase, salt)
  "wrap_recov": { "epk": "b64", "iv": "b64", "ct": "b64" }   // DEK wrapped to recovery pubkey
}
```

`ciphertext`/`iv`/`salt` remain present and non-empty, so existing create-time
validation is satisfied unchanged. The **presence of `wrap_recov`** marks a share
as reset-capable.

### 4.3 Decryption (web viewer)

- **v1** (no `v`/`wrap_pass`): current path — `AES-GCM(KDF(passphrase, salt))`
  over `ciphertext`. Untouched.
- **v2**: `KDF(passphrase, salt)` → decrypt `wrap_pass`(`iv_p`) → **DEK** →
  `AES-GCM(DEK, iv)` over `ciphertext` → plaintext.

## 5. Recovery keypair lifecycle

- **Generation:** new CLI command `agentgate recovery-keygen` outputs:
  - a **public key** (b64, for config), and
  - a **private key** file, which the operator stores offline. The command
    SHOULD offer to encrypt the private key under an operator-supplied passphrase
    (PBKDF2 + AES-GCM) so a stolen file is still useless.
- **Configuration:** `AGENTGATE_RECOVERY_PUBKEY` (public key, b64) on the CLI /
  upload side. When set, uploads add `wrap_recov`; when unset, uploads produce
  v2 **without** `wrap_recov` (or plain v1) → those shares are **not**
  reset-capable (graceful degradation).
- The recovery **private key never reaches any server**. It is loaded only into
  the operator's browser during a reset (§7).

## 6. Data model

**No migration.** Both backends already treat `encrypted_data` as one opaque
value:

- Go `handlers_api.go` currently marshals a typed `{Ciphertext,IV,Salt}` struct
  (drops extra keys). Change: parse into `json.RawMessage`, validate that
  `ciphertext`/`iv`/`salt` are present & non-empty, then **store the raw object
  verbatim** (preserving `v`, `wrap_pass`, `iv_p`, `wrap_recov`).
- Worker `index.ts` currently rebuilds `{ciphertext,iv,salt}` (drops extra keys).
  Change: validate the three fields, then store the **whole** `encrypted_data`
  object.
- GET stays as-is on both (already opaque passthrough).

## 7. Reset & re-share flow (keep-DEK; plaintext never touched)

1. Operator opens the resource in `/admin`, clicks **Reset & re-share**, and
   loads the **offline recovery private key** (paste/file; decrypted locally if
   passphrase-protected). Never sent to the server.
2. Browser calls `GET /api/admin/{kind}/{id}/recovery-dek` → server returns the
   stored `wrap_recov` (small; safe to expose to an authenticated admin — useless
   without the private key). Works regardless of expiry/revocation.
3. Browser ECDH-unwraps `wrap_recov` → **DEK** (only 32 bytes handled; content is
   never fetched or decrypted).
4. Browser generates a **new passphrase**, derives `KDF(new_pass, new_salt)`, and
   produces a new `wrap_pass'` (`iv_p'`) over the same DEK.
5. Browser calls `POST /api/admin/{kind}/{id}/reset-reshare` with
   `{ salt, iv_p, wrap_pass, expires_in_seconds?, never_expires? }`.
6. Server builds the new record's `encrypted_data` =
   `{ v:2, ciphertext, iv, wrap_recov }` **copied from the source** +
   `{ salt, iv_p, wrap_pass }` **from the request**; copies the content blob if
   blob/R2-stored (content_ct is unchanged); writes a new id with a new owner
   token; then **revokes** the source record (same as `revoke`). Atomic where the
   store allows.
7. Server returns the same shape as create (`preview_url`, `manage_url`, `id`,
   `owner_token`). The browser shows the operator the **new passphrase** it
   generated (server never sees it) + the new link.

Result: old passphrase now maps only to the revoked source record → dead. New
link uses the new passphrase. The DEK (never exposed in plaintext form outside
this one in-browser step) and `content_ct` are reused, so no content
re-encryption and no plaintext exposure.

## 8. API contract changes (both backends, kept identical)

Add to `docs/api-contract.md`:

- **`encrypted_data` v2 shape** (§4.2) as an accepted, opaque-passthrough format.
- **`GET /api/admin/{kind}/{id}/recovery-dek`** (requires admin session):
  `200 { success, data: { v: 2, wrap_recov: {epk,iv,ct} } }`; `409` if the share
  is not reset-capable (no `wrap_recov`, e.g. v1 or uploaded without a recovery
  pubkey); `404` unknown id.
- **`POST /api/admin/{kind}/{id}/reset-reshare`** (requires admin session,
  Origin-checked): body `{ salt, iv_p, wrap_pass, expires_in_seconds?,
  never_expires? }`; on success copies content + swaps the passphrase-wrap +
  revokes source; returns the create shape. `409` if source not reset-capable;
  `400` invalid body; `404` unknown id.

The existing `reshare` (same-passphrase copy) stays for its current use.

## 9. Backward compatibility (agreed)

- Existing v1 shares, and any v2 share uploaded without a recovery pubkey
  configured, have **no `wrap_recov`** → they are **not** reset-capable. The admin
  UI shows Reset & re-share disabled for them (with a tooltip: "re-upload with a
  recovery key to enable"). `revoke`/`delete` remain available.
- No forced migration of old rows.

## 10. Component work summary

- **CLI (`cmd/agentgate`):** envelope encryption on upload (v2 producer);
  `AGENTGATE_RECOVERY_PUBKEY` handling; `recovery-keygen` command; ECDH P-256 via
  Go `crypto/ecdh` + HKDF (`golang.org/x/crypto/hkdf` or std).
- **Go server (`internal/server`):** opaque `encrypted_data` passthrough on
  create; `recovery-dek` + `reset-reshare` handlers + routes; reuse
  blob-copy/revoke logic from existing `reshare`/`revoke`.
- **Worker (`worker/src`):** mirror the create passthrough + both new endpoints
  (D1 + R2 paths).
- **Web (`web/static/js`):** `crypto.js` v2 decrypt (unwrap→decrypt), plus
  `encrypt`, `wrapDEKPassphrase`, and ECIES `unwrapDEKRecovery` helpers;
  admin dashboard UI (`admin-dashboard.js` / `admin-api.js`) for the reset flow +
  private-key loading; result display of new passphrase/link.
- **Docs:** `docs/api-contract.md` (§8), plus operator docs for
  `recovery-keygen` and key custody.
- **Tests:** `test/contract/` cases for both new endpoints against both backends;
  crypto round-trip unit tests (encrypt→wrap→unwrap-by-passphrase and
  unwrap-by-recovery-key→decrypt); v1/v2 decrypt compatibility; reset e2e
  (old passphrase fails on new link, new passphrase succeeds; source revoked).

## 11. Non-goals / YAGNI

- No new-DEK rotation (agreed: keep-DEK). A "rotate DEK too" mode can be added
  later only if DEK compromise (not passphrase leak) becomes a concern.
- No server-side or KMS-held recovery key (rejected: weakens breach resistance).
- No migration/backfill of v1 shares to v2.
- No multi-recipient / per-recipient keys beyond the single recovery keypair.

## 12. Open questions

- Recovery key encoding: raw b64 vs PEM/JWK for the pubkey config and private-key
  file. (Proposed: b64-encoded raw SEC1/PKCS8 for compactness; revisit in plan.)
- Should `reset-reshare` **delete** the source instead of **revoke**? (Proposed:
  revoke, matching existing semantics + sweeper cleanup; delete is already a
  separate admin action.)
