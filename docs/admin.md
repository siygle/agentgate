# Owner dashboard and recovery

## Owner dashboard (`/admin`)

Set `AGENTGATE_SESSION_SECRET` (a long random string) to enable the dashboard, then add at
least one login method — `AGENTGATE_OWNER_KEY` and/or Cloudflare Access. With no session
secret the whole subsystem is disabled and its routes return `503` (fail closed).

The dashboard lists every share in the deployment with actions to keep forever, revoke,
re-share (issue a new link for the same content, passphrase unchanged), reset (see below),
and delete. It never shows ciphertext.

On the Cloudflare Worker the same dashboard is enabled by setting the
`SESSION_SECRET`/`OWNER_KEY` secrets (`wrangler secret put`) and the `CF_ACCESS_*` vars.

Sessions are `HttpOnly; SameSite=Strict` HMAC-signed cookies (12h by default, `Secure` on
https). State-changing admin requests also verify the `Origin` header as CSRF defence in
depth. The admin surface is same-origin only and is deliberately excluded from the
permissive CORS the public share API uses.

> **Cloudflare Access on self-host — lock the origin.** The JWT is fully verified
> (signature + `aud` + issuer + expiry), so a forged `Cf-Access-Jwt-Assertion` header is
> rejected. But only enable `AGENTGATE_CF_ACCESS_ENABLED` when your origin is reachable
> **solely through Cloudflare** — otherwise someone can hit the origin directly and bypass
> Access entirely. Enabling the orange-cloud proxy + SSL is **not** sufficient; you must
> also lock the origin, via any one of: (1) a `cloudflared` tunnel (origin opens no public
> port), (2) a firewall allowing only Cloudflare IP ranges, or (3) Authenticated Origin
> Pulls (mTLS). The Worker backend has no such concern — it runs on Cloudflare.

## Owner reset & re-share (recovery key)

For shares uploaded with a recovery key configured, an owner who has lost the original
passphrase can recover the content and mint a fresh link without ever sending the private
key to the server.

This is the v2 envelope scheme: the share's content key (DEK) is wrapped both under the
passphrase and, optionally, under an offline recovery public key (ECDH-P256 → HKDF-SHA256 →
AES-256-GCM). The private half of that keypair never touches the server or the database —
it is only ever pasted into the browser tab performing the reset.

### 1. Generate a recovery keypair (offline, once per deployment)

```bash
agentgate recovery-keygen -o /path/to/recovery.key
# optionally encrypt the key file at rest:
agentgate recovery-keygen -o /path/to/recovery.key -p <a-strong-passphrase>
```

This prints the recovery **public** key to stdout and writes the **private** key to `-o`
(mode `0600`). Store the private key **OFFLINE** — a password manager, an air-gapped drive,
or a hardware token. Anyone holding it can recover every v2 share ever uploaded with the
matching public key, so treat it like a master key.

Shares uploaded **without** a recovery key configured have no recovery path at all: they
can only be revoked or deleted, never reset.

### 2. Enable it on the uploader — but only after the server is ready

```bash
export AGENTGATE_RECOVERY_PUBKEY="<the public key printed above>"
```

> ⚠️ **Rollout ordering matters.** Only set `AGENTGATE_RECOVERY_PUBKEY` on the uploader
> **after** you have deployed a v2-capable server *and* the matching v2-capable web viewer.
> If the uploader is configured with a recovery pubkey before the server/viewer understand
> v2 envelopes, the recovery wrap is silently dropped and the affected shares can **never**
> be decrypted or recovered again — this is silent, unrecoverable data loss, not a visible
> error. When in doubt: deploy the server/viewer first, confirm a v2 upload round-trips
> (`go run ./cmd/crossvector` is the Go↔JS interop check), and only then flip on
> `AGENTGATE_RECOVERY_PUBKEY` for uploaders.

### 3. Reset a share from `/admin`

A share uploaded with a recovery key shows a **Reset** action. It prompts for the offline
recovery private key — pasted locally into the browser, never sent to the server — and then:

1. Unwraps the share's DEK in-browser using that key (`wrap_recov`, ECDH + HKDF + AES-GCM).
2. Generates a fresh random passphrase and re-wraps the same DEK under it (new salt/iv; the
   underlying content ciphertext is untouched).
3. Uploads the new wrap, and the server mints a new share id/link while revoking the old one
   in the same operation.

The dashboard then displays the new link and the new randomly generated passphrase — copy
both to whoever needs access. The **old** link stops resolving (404) and the **old**
passphrase can no longer decrypt anything, because the source record has been revoked.

Shares with no `wrap_recov` cannot be reset this way; the dashboard offers Revoke or Delete
for those instead.

## Rotating a passphrase you still have

If you know the current passphrase, the CLI can re-encrypt in place without involving the
dashboard — the link and owner token stay the same:

```bash
agentgate rekey <id-or-url>
```

The admin endpoints backing all of the above are specified in
[api-contract.md](api-contract.md#owner-dashboard-instance-admin-endpoints).
