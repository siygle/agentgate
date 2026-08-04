# Self-hosting

The self-host server is a single Go binary with SQLite (pure Go, no CGO) and embedded
static assets. For the Cloudflare option see [cloudflare.md](cloudflare.md).

```bash
agentgate-server --port 8080 --base-url https://your-domain.com
```

## Server options

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `--port` | `PORT` | `8080` | HTTP port |
| `--db` | `DATABASE_PATH` | `./agentgate.db` | SQLite database path |
| `--base-url` | `BASE_URL` | `http://localhost:8080` | Public base URL for shared links |
| `--blob-dir` | `AGENTGATE_BLOB_DIR` | *(empty)* | Directory for external encrypted blob storage (empty = inline in SQLite) |
| — | `AGENTGATE_MAX_UPLOAD_BYTES` | `10485760` | Max encrypted payload per share; larger uploads get HTTP 413 |
| — | `AGENTGATE_SESSION_SECRET` | *(empty)* | HMAC secret for admin sessions. **Empty disables the owner dashboard.** |
| — | `AGENTGATE_OWNER_KEY` | *(empty)* | Owner-key login secret for the dashboard (empty = that method off) |
| — | `AGENTGATE_SESSION_TTL` | `43200` | Admin session lifetime, seconds (12h) |
| — | `AGENTGATE_CF_ACCESS_ENABLED` | `false` | `true` to accept Cloudflare Access JWTs — read the warning in [admin.md](admin.md) |
| — | `AGENTGATE_CF_ACCESS_TEAM_DOMAIN` | *(empty)* | `<team>.cloudflareaccess.com` |
| — | `AGENTGATE_CF_ACCESS_AUD` | *(empty)* | Expected Access application `aud` tag |
| — | `AGENTGATE_CF_ACCESS_EMAILS` | *(empty)* | Optional comma-separated email allowlist |

## Docker Compose

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
      AGENTGATE_BLOB_DIR: /data/blobs   # store blobs as files on the volume; omit to keep them inline in SQLite

volumes:
  data:
```

## systemd

```ini
[Unit]
Description=AgentGate server

[Service]
ExecStart=/usr/local/bin/agentgate-server --db /var/lib/agentgate/agentgate.db --base-url https://your-domain.com
Restart=always

[Install]
WantedBy=multi-user.target
```

## Blob storage

By default the encrypted blob is stored inline in the SQLite `encrypted_data` column —
simple, and SQLite has no small per-value cap. Set **`AGENTGATE_BLOB_DIR`** to instead
write each blob to a file under that directory (keyed `<kind>/<id>`), keeping metadata in
SQLite. This is the self-host analogue of the Worker's R2 mode: it keeps the database lean
and makes large bundles and backups easier.

Point it at a path on the same persistent volume as the DB. Switching modes is safe —
existing inline records keep reading from the DB, only new records use the directory.
Expired blobs are removed by the cleanup pass.

## Prebuilt binaries

Each tagged release publishes statically-linked binaries on the
[GitHub Releases](https://github.com/siygle/agentgate/releases) page (built by
`.github/workflows/release.yml` from the `make release` matrix). Assets are named
`agentgate-<os>-<arch>` (CLI) and `agentgate-server-<os>-<arch>` (server) for
`darwin`/`linux` × `arm64`/`amd64`, plus `checksums.txt`.

```bash
# Example: install the CLI on Linux amd64
curl -fsSL -o agentgate \
  https://github.com/siygle/agentgate/releases/latest/download/agentgate-linux-amd64
chmod +x agentgate && sudo mv agentgate /usr/local/bin/
```

Maintainers cut a release by pushing a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Building from source

```bash
make build     # both binaries into bin/
make release   # cross-compile darwin/linux × arm64/amd64
make docker    # build the Docker image
```

## Tests

```bash
go test ./...                                    # server, CLI, crypto, db
node test/contract/run.mjs http://localhost:8080 # HTTP contract, run against either backend
for t in sandbox share-kind passphrase crypto; do
  node web/static/js/$t.node.test.mjs            # frontend unit tests
done
go run ./cmd/crossvector                         # Go <-> JS envelope interop vector
```

The contract test is the important one when changing anything server-side: it is run
against *both* backends and is the single check that they stay interchangeable. Set
`ADMIN_OWNER_KEY` to include the admin-dashboard assertions.
