---
name: diff4
description: Share encrypted git diffs and files using the diff4 CLI. Use when the user wants to share code changes, send diffs for review files content securely via diff4
metadata:
  author: diff4
  version: "0.1.0"
---

# diff4 - Encrypted Diff & File Sharing

diff4 encrypts diffs and files client-side (AES-256-GCM) before uploading. The server never sees plaintext. Recipients need the passphrase to decrypt.

## Prerequisites

- `diff4` must be installed and available on PATH
- A passphrase must be configured (see setup below)

## Setup (first time)

```
diff4 key-gen
```

Generates a random key and writes `export DIFF4_PASSPHRASE="<key>"` to the user's shell config (~/.zshrc, ~/.bashrc, or ~/.profile). After running, tell the user to run `source ~/.zshrc` (or the appropriate rc file) to load the key.

To check the current key: `diff4 key-get`

To generate with a custom key: `diff4 key-gen mysecretkey`

## Commands

### Share the latest commit diff

```
diff4 git-latest
```

Runs `git diff HEAD~1`, encrypts the result, and uploads. Use when the user says "preview my last commit" or "send the latest diff."

### Share staged changes

```
diff4 git-staged
```

Runs `git diff --staged`, encrypts, and uploads. Use when the user says "preview my staged changes" or "send what's about to be committed."

### Share arbitrary files

```
diff4 files path/to/file1.ts path/to/file2.ts
```

Reads each file (UTF-8 text only), bundles them as JSON, encrypts, and uploads. Supports any number of paths (relative or absolute).

### Key management

- `diff4 key-gen [key]` - Generate or set the encryption passphrase
- `diff4 key-get` - Print the current passphrase

## Options

All upload commands (`git-latest`, `git-staged`, `files`) accept:

| Flag | Description |
|------|-------------|
| `-s, --server <url>` | Override the diff4 server URL. Default: `https://diff4.com` (or `DIFF4_SERVER` env var) |
| `-p, --passphrase <key>` | Override the passphrase for this command only. Default: `DIFF4_PASSPHRASE` env var |

## Gotchas

- **Empty diffs fail gracefully.** `git-latest` and `git-staged` will error if there is nothing to share.
- **Binary files are not supported.** `diff4 files` reads files as UTF-8 text.
- **Server is configurable.** Self-hosted instances can be set via `DIFF4_SERVER` env var or `-s` flag.
- **The passphrase must be shared out-of-band.** diff4 only encrypts — recipients need the same passphrase to decrypt.
- **key-gen updates existing keys.** If `DIFF4_PASSPHRASE` already exists in the shell config, key-gen replaces it in-place.

## Typical workflow

1. User asks to see a diff or files
2. Verify setup: run `diff4 key-get` (if it fails, run `diff4 key-gen` and tell user to source their rc file)
3. Run the appropriate command (`git-latest`, `git-staged`, or `files <paths>`)
4. Return the URL from the response to the user
5. Remind the user that recipients need the passphrase to decrypt
