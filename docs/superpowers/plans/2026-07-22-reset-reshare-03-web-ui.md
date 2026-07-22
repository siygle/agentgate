# Reset & Re-share — Plan 3: Web viewer v2 decrypt + admin reset UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the browser decrypt v2 envelope shares transparently, and add a `/admin` "Reset & re-share" flow that recovers the DEK with an offline recovery private key, re-wraps it under a fresh passphrase, and mints a new link — all client-side.

**Architecture:** The recovery private key is imported into WebCrypto and used for ECDH-P256 → HKDF-SHA256 → AES-GCM to unwrap the DEK; a new random passphrase re-wraps the DEK (PBKDF2); the server (Plan 2) copies the content and revokes the source. To make the recovery key importable by WebCrypto, the Go keygen (Plan 1) is retrofitted to emit the private key as PKCS8.

**Tech Stack:** Browser WebCrypto (`crypto.subtle`), vanilla ES5 IIFEs (`web/static/js`), Go `crypto/x509`+`crypto/ecdsa`+`crypto/ecdh` for the keygen retrofit, Node 18+ WebCrypto for unit tests, and an end-to-end browser check against the Go server.

## Global Constraints

- **ECIES parameters MUST match the Go producer exactly** (Plan 1 `internal/crypto/envelope.go`): ephemeral ECDH-P256, then HKDF-SHA256 with **salt = 32 zero bytes** (Go passes `nil`, which its HKDF expands to `HashLen` zero bytes) and **info = `agentgate/recovery-wrap/v2`**, then AES-256-GCM. The browser HKDF call MUST use `salt: new Uint8Array(32)` (32 zeros), NOT an empty salt — an empty salt derives a different key and decryption fails.
- PBKDF2 params match v1/Go: SHA-256, 600000 iterations, 32-byte AES-256 key, 16-byte salt, 12-byte GCM nonce. All wire values are standard base64.
- v1 shares (`{ciphertext,iv,salt}`, no `v`/`wrap_pass`) must still decrypt via the existing path — no viewer regression.
- The recovery **private key never leaves the browser** and is never sent to the server. Only `{salt,iv_p,wrap_pass}` (a fresh passphrase wrap of the DEK) is POSTed to `reset-reshare`.
- The admin list endpoint does not report reset-capability; the "Reset & re-share" action attempts `recovery-dek` and surfaces the server's `409` as a friendly "no recovery key" message.
- After the Plan-1 keygen retrofit, `GenerateRecoveryKey` returns `privB64` = base64(PKCS8 DER) and `pubB64` = base64(raw uncompressed P-256 point, unchanged). All existing Go crypto tests must still pass.

---

### Task 1: Go — emit the recovery private key as PKCS8 (WebCrypto interop)

**Files:**
- Modify: `internal/crypto/envelope.go` (`GenerateRecoveryKey`, `RecoverDEK`)
- Modify: `internal/crypto/envelope_test.go` (round-trip still passes; add a PKCS8-shape assertion)

**Interfaces:**
- `GenerateRecoveryKey() (privB64, pubB64 string, err error)` unchanged signature; `privB64` now base64(PKCS8 DER), `pubB64` still base64(raw uncompressed point). `eciesWrap` is UNCHANGED (it consumes the raw-point public key). `RecoverDEK(w RecovWrap, privB64 string)` now parses PKCS8.

- [ ] **Step 1: Update the failing test to assert the new private-key shape**

Add to `internal/crypto/envelope_test.go`:
```go
func TestRecoveryKeyPrivateIsPKCS8(t *testing.T) {
	priv, _, err := GenerateRecoveryKey()
	if err != nil {
		t.Fatalf("GenerateRecoveryKey: %v", err)
	}
	der, err := base64.StdEncoding.DecodeString(priv)
	if err != nil {
		t.Fatalf("priv not base64: %v", err)
	}
	if _, err := x509.ParsePKCS8PrivateKey(der); err != nil {
		t.Fatalf("private key is not valid PKCS8: %v", err)
	}
}
```
Add `"crypto/x509"` to the test imports. The existing `TestEnvelopeRecoveryRoundTrip` and `TestRecoverDEKWrongKeyFails` (and `cmd/agentgate` keygen tests) MUST still pass unchanged — they only rely on `GenerateRecoveryKey`→`RecoverDEK` being consistent.

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/crypto/ -run TestRecoveryKeyPrivateIsPKCS8 -v`
Expected: FAIL — the private key is currently a raw 32-byte scalar, not PKCS8, so `ParsePKCS8PrivateKey` errors.

- [ ] **Step 3: Implement**

In `internal/crypto/envelope.go`, add imports `crypto/ecdsa`, `crypto/elliptic`, `crypto/x509`. Replace `GenerateRecoveryKey` and `RecoverDEK`:

```go
// GenerateRecoveryKey returns a new P-256 recovery keypair as standard-base64:
// privB64 = PKCS8 DER (WebCrypto-importable), pubB64 = uncompressed point (65 bytes).
func GenerateRecoveryKey() (privB64, pubB64 string, err error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate recovery key: %w", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", "", fmt.Errorf("marshal recovery key: %w", err)
	}
	ecdhPub, err := priv.PublicKey.ECDH()
	if err != nil {
		return "", "", fmt.Errorf("convert recovery pubkey: %w", err)
	}
	return base64.StdEncoding.EncodeToString(der),
		base64.StdEncoding.EncodeToString(ecdhPub.Bytes()), nil
}

// RecoverDEK unwraps the DEK from a RecovWrap using the recovery private key
// (PKCS8 DER, base64).
func RecoverDEK(w RecovWrap, privB64 string) ([]byte, error) {
	der, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil {
		return nil, fmt.Errorf("decode recovery privkey: %w", err)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("parse recovery privkey: %w", err)
	}
	ecdsaPriv, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("recovery key is not an ECDSA/EC key")
	}
	priv, err := ecdsaPriv.ECDH()
	if err != nil {
		return nil, fmt.Errorf("convert recovery privkey: %w", err)
	}
	epkBytes, err := base64.StdEncoding.DecodeString(w.EPK)
	if err != nil {
		return nil, fmt.Errorf("decode epk: %w", err)
	}
	epk, err := ecdh.P256().NewPublicKey(epkBytes)
	if err != nil {
		return nil, fmt.Errorf("parse epk: %w", err)
	}
	ss, err := priv.ECDH(epk)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}
	wk, err := hkdfKey(ss)
	if err != nil {
		return nil, fmt.Errorf("hkdf: %w", err)
	}
	iv, err := base64.StdEncoding.DecodeString(w.IV)
	if err != nil {
		return nil, fmt.Errorf("decode iv: %w", err)
	}
	ct, err := base64.StdEncoding.DecodeString(w.CT)
	if err != nil {
		return nil, fmt.Errorf("decode ct: %w", err)
	}
	dek, err := aesGCMOpen(wk, iv, ct)
	if err != nil {
		return nil, fmt.Errorf("unwrap dek: %w", err)
	}
	return dek, nil
}
```
Leave `eciesWrap`, `hkdfKey`, `EncryptEnvelope`, `DecryptEnvelope`, `WrapDEKPassphrase` unchanged. If `ecdh` becomes an otherwise-unused import after this edit, keep it — `eciesWrap`/`ecdh.P256().NewPublicKey` still use it.

- [ ] **Step 4: Run tests**

Run: `go test ./internal/crypto/ ./cmd/agentgate/ -count=1`
Expected: all PASS (new PKCS8 assertion, existing recovery round-trip, keygen tests).

- [ ] **Step 5: Commit**

```bash
git add internal/crypto/envelope.go internal/crypto/envelope_test.go
git commit -m "feat(crypto): emit recovery private key as PKCS8 for WebCrypto interop"
```

---

### Task 2: `crypto.js` — v2 decrypt + recovery unwrap + passphrase re-wrap

**Files:**
- Modify: `web/static/js/crypto.js`
- Test: `web/static/js/crypto.node.test.mjs` (Node 18+ WebCrypto)

**Interfaces (added to `window.AgentGateCrypto`):**
- `decryptShare(encrypted, passphrase) -> Promise<string>` — handles v1 and v2.
- `recoverDek(privB64, wrapRecov) -> Promise<Uint8Array>` — ECIES unwrap (PKCS8 priv + raw epk).
- `rewrapUnderPassphrase(dekBytes, passphrase) -> Promise<{salt, iv_p, wrap_pass}>`.
- `randomPassphrase() -> string`.
- existing `decrypt(ciphertext, iv, salt, passphrase)` retained (used for v1 and for decrypting a passphrase-protected recovery-key file).

- [ ] **Step 1: Write the failing test**

```js
// web/static/js/crypto.node.test.mjs
// Run: node web/static/js/crypto.node.test.mjs
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert";

// Shim the browser globals crypto.js expects, then load the IIFE.
globalThis.crypto = webcrypto;
globalThis.window = {};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob = (b) => Buffer.from(b, "base64").toString("binary");
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
const src = readFileSync(new URL("./crypto.js", import.meta.url), "utf8");
new Function(src)(); // executes the IIFE, populates window.AgentGateCrypto
const C = globalThis.window.AgentGateCrypto;

const te = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString("base64");
const RECOVERY_INFO = "agentgate/recovery-wrap/v2";

// Build a v2 envelope the SAME way Go does, using WebCrypto as the reference
// producer, so decryptShare + recoverDek are validated against a spec-conformant
// wrap (Go↔JS is additionally proven by the Plan-3 end-to-end browser test).
async function makeEnvelope(plaintext, passphrase, recoveryPubRawB64) {
  const dek = webcrypto.getRandomValues(new Uint8Array(32));
  const dekKey = await webcrypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ivC = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: ivC }, dekKey, te.encode(plaintext)));
  // passphrase wrap
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const km = await webcrypto.subtle.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const kek = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ivP = webcrypto.getRandomValues(new Uint8Array(12));
  const wrapPass = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: ivP }, kek, dek));
  const env = { v: 2, ciphertext: b64(ct), iv: b64(ivC), salt: b64(salt), iv_p: b64(ivP), wrap_pass: b64(wrapPass) };
  // recovery wrap (ECIES) to the given raw public key
  const pub = await webcrypto.subtle.importKey("raw", Buffer.from(recoveryPubRawB64, "base64"), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ss = await webcrypto.subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const hk = await webcrypto.subtle.importKey("raw", ss, "HKDF", false, ["deriveBits"]);
  const wkBits = await webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: te.encode(RECOVERY_INFO) }, hk, 256);
  const wk = await webcrypto.subtle.importKey("raw", wkBits, { name: "AES-GCM" }, false, ["encrypt"]);
  const ivR = webcrypto.getRandomValues(new Uint8Array(12));
  const wrapCt = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: ivR }, wk, dek));
  const epkRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", eph.publicKey));
  env.wrap_recov = { epk: b64(epkRaw), iv: b64(ivR), ct: b64(wrapCt) };
  return { env, dek };
}

async function main() {
  // v1 still decrypts.
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const km = await webcrypto.subtle.importKey("raw", te.encode("pw"), "PBKDF2", false, ["deriveKey"]);
  const k = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, k, te.encode("v1 content")));
  const v1 = { ciphertext: b64(ct), iv: b64(iv), salt: b64(salt) };
  assert.equal(await C.decryptShare(v1, "pw"), "v1 content");

  // Generate a WebCrypto recovery keypair; export priv as pkcs8, pub as raw.
  const kp = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privB64 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const pubB64 = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey)).toString("base64");

  const { env, dek } = await makeEnvelope("secret v2", "pw", pubB64);

  // v2 passphrase decrypt.
  assert.equal(await C.decryptShare(env, "pw"), "secret v2");
  // wrong passphrase fails.
  await assert.rejects(() => C.decryptShare(env, "nope"));

  // recovery unwrap yields the same DEK.
  const recovered = await C.recoverDek(privB64, env.wrap_recov);
  assert.deepEqual(Buffer.from(recovered), Buffer.from(dek));

  // rewrap under a new passphrase, then decryptShare with the new passphrase.
  const wrap = await C.rewrapUnderPassphrase(recovered, "newpw");
  const rekeyed = { v: 2, ciphertext: env.ciphertext, iv: env.iv, wrap_recov: env.wrap_recov, salt: wrap.salt, iv_p: wrap.iv_p, wrap_pass: wrap.wrap_pass };
  assert.equal(await C.decryptShare(rekeyed, "newpw"), "secret v2");
  await assert.rejects(() => C.decryptShare(rekeyed, "pw")); // old passphrase dead

  assert.equal(typeof C.randomPassphrase(), "string");
  assert.ok(C.randomPassphrase().length >= 16);
  console.log("crypto.node.test: OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node web/static/js/crypto.node.test.mjs`
Expected: FAIL — `C.decryptShare is not a function`.

- [ ] **Step 3: Implement**

Edit `web/static/js/crypto.js`. Keep `toBase64`/`fromBase64`. Generalize `deriveKey` to take usages, and add the new functions. The IIFE's export object gains the new methods:

```js
  function deriveKey(passphrase, salt, usages) {
    var encoder = new TextEncoder();
    return crypto.subtle
      .importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"])
      .then(function (keyMaterial) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
          keyMaterial,
          { name: "AES-GCM", length: 256 },
          false,
          usages
        );
      });
  }

  // decrypt (v1): AES-GCM under a passphrase-derived key. Retained for v1 shares
  // and for decrypting a passphrase-protected recovery-key file.
  function decrypt(ciphertext, iv, salt, passphrase) {
    return deriveKey(passphrase, fromBase64(salt), ["decrypt"]).then(function (key) {
      return crypto.subtle
        .decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(ciphertext))
        .then(function (buf) { return new TextDecoder().decode(buf); });
    });
  }

  function importAesKey(rawBytes, usages) {
    return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, false, usages);
  }

  // decryptShare handles both formats. v2 (has wrap_pass / v===2): unwrap the DEK
  // under the passphrase, then decrypt the content under the DEK. v1: decrypt
  // the content directly.
  function decryptShare(enc, passphrase) {
    if (!enc) return Promise.reject(new Error("no encrypted data"));
    var isV2 = enc.v === 2 || !!enc.wrap_pass;
    if (!isV2) return decrypt(enc.ciphertext, enc.iv, enc.salt, passphrase);
    return deriveKey(passphrase, fromBase64(enc.salt), ["decrypt"])
      .then(function (kek) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(enc.iv_p) }, kek, fromBase64(enc.wrap_pass));
      })
      .then(function (dekBuf) { return importAesKey(new Uint8Array(dekBuf), ["decrypt"]); })
      .then(function (dekKey) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(enc.iv) }, dekKey, fromBase64(enc.ciphertext));
      })
      .then(function (ptBuf) { return new TextDecoder().decode(ptBuf); });
  }

  var RECOVERY_INFO = "agentgate/recovery-wrap/v2";

  // recoverDek unwraps the DEK from wrap_recov using the recovery private key
  // (PKCS8 DER, base64). ECDH-P256 -> HKDF-SHA256 (32-zero salt) -> AES-256-GCM,
  // matching the Go producer.
  function recoverDek(privB64, wrapRecov) {
    return Promise.all([
      crypto.subtle.importKey("pkcs8", fromBase64(privB64), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      crypto.subtle.importKey("raw", fromBase64(wrapRecov.epk), { name: "ECDH", namedCurve: "P-256" }, false, [])
    ])
      .then(function (keys) {
        return crypto.subtle.deriveBits({ name: "ECDH", public: keys[1] }, keys[0], 256);
      })
      .then(function (ss) {
        return crypto.subtle.importKey("raw", ss, "HKDF", false, ["deriveBits"]);
      })
      .then(function (hk) {
        return crypto.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(RECOVERY_INFO) },
          hk, 256
        );
      })
      .then(function (wkBits) { return importAesKey(new Uint8Array(wkBits), ["decrypt"]); })
      .then(function (wk) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(wrapRecov.iv) }, wk, fromBase64(wrapRecov.ct));
      })
      .then(function (dekBuf) { return new Uint8Array(dekBuf); });
  }

  // rewrapUnderPassphrase wraps a raw DEK under a fresh passphrase (new salt+iv).
  function rewrapUnderPassphrase(dekBytes, passphrase) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(passphrase, salt, ["encrypt"])
      .then(function (kek) {
        return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, kek, dekBytes);
      })
      .then(function (ct) {
        return { salt: toBase64(salt), iv_p: toBase64(iv), wrap_pass: toBase64(new Uint8Array(ct)) };
      });
  }

  function randomPassphrase() {
    return toBase64(crypto.getRandomValues(new Uint8Array(18))); // 24 base64 chars
  }

  window.AgentGateCrypto = {
    decrypt: decrypt,
    decryptShare: decryptShare,
    recoverDek: recoverDek,
    rewrapUnderPassphrase: rewrapUnderPassphrase,
    randomPassphrase: randomPassphrase
  };
```

- [ ] **Step 4: Run tests**

Run: `node web/static/js/crypto.node.test.mjs`
Expected: prints `crypto.node.test: OK`.

- [ ] **Step 5: Commit**

```bash
git add web/static/js/crypto.js web/static/js/crypto.node.test.mjs
git commit -m "feat(web): crypto.js v2 decrypt, recovery unwrap, passphrase re-wrap"
```

---

### Task 3: Viewers — decrypt via `decryptShare`

**Files:**
- Modify: `web/static/js/app-viewer.js` (~398), `web/static/js/diff-viewer.js` (~570), `web/static/js/file-viewer.js` (~419), `web/static/js/plan-viewer.js` (~452)

- [ ] **Step 1: Switch each call site**

Each viewer currently does (formatting varies):
```js
window.AgentGateCrypto.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.salt, passphrase).then(...)
```
Replace the call with:
```js
window.AgentGateCrypto.decryptShare(encrypted, passphrase).then(...)
```
Keep the surrounding `.then(...)/.catch(...)` chains, error handling, and the `encrypted`/`passphrase` variables exactly as they are. Do this in all four viewers. Do not change anything else.

- [ ] **Step 2: Sanity build check**

There is no bundler; confirm no syntax errors by loading each file through Node's parser:
`for f in app-viewer diff-viewer file-viewer plan-viewer; do node --check web/static/js/$f.js && echo "$f ok"; done`
Expected: `... ok` for all four. (Full behavior is verified end-to-end in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add web/static/js/app-viewer.js web/static/js/diff-viewer.js web/static/js/file-viewer.js web/static/js/plan-viewer.js
git commit -m "feat(web): viewers decrypt via decryptShare (v1 + v2)"
```

---

### Task 4: Admin dashboard — "Reset & re-share" flow

**Files:**
- Modify: `web/static/js/admin-api.js` (add `recoveryDek`, `resetReshare`)
- Modify: `web/static/js/admin-dashboard.js` (row button + modal + flow + result)

- [ ] **Step 1: Add API methods**

In `web/static/js/admin-api.js`, add to the returned object (after `reshare`):
```js
    recoveryDek: function (kind, id) {
      return req("GET", "/api/admin/" + kind + "/" + encodeURIComponent(id) + "/recovery-dek");
    },
    resetReshare: function (kind, id, body) {
      return req("POST", "/api/admin/" + kind + "/" + encodeURIComponent(id) + "/reset-reshare", body || {});
    },
```

- [ ] **Step 2: Add the reset flow to the dashboard**

In `web/static/js/admin-dashboard.js`, add these helpers (near `showReshareResult`):

```js
  // resolvePrivateKey accepts either a raw base64 PKCS8 key, or the protected
  // JSON file { "enc": { ciphertext, iv, salt } } plus its passphrase.
  function resolvePrivateKey(text, keyPass) {
    text = (text || "").trim();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* not JSON: treat as raw */ }
    if (parsed && parsed.enc && parsed.enc.ciphertext) {
      if (!keyPass) return Promise.reject(new Error("此私鑰檔已加密，請輸入保護用 passphrase"));
      return window.AgentGateCrypto.decrypt(parsed.enc.ciphertext, parsed.enc.iv, parsed.enc.salt, keyPass);
    }
    return Promise.resolve(text);
  }

  function showResetResult(data, newPass) {
    var passCode = el("code", { text: newPass });
    var copyLink = el("button", { class: "btn", text: "複製連結" });
    copyLink.addEventListener("click", function () {
      try { navigator.clipboard.writeText(data.preview_url); copyLink.textContent = "已複製"; } catch (e) {}
    });
    var copyPass = el("button", { class: "btn", text: "複製 passphrase" });
    copyPass.addEventListener("click", function () {
      try { navigator.clipboard.writeText(newPass); copyPass.textContent = "已複製"; } catch (e) {}
    });
    modal({
      title: "已重設並重新分享",
      bodyNodes: [
        el("p", { text: "舊連結已作廢、舊 passphrase 失效。請把下列新連結與新 passphrase 分開、透過安全管道交給收件者。" }),
        el("div", { class: "admin-muted", text: "新連結" }),
        el("code", { text: data.preview_url }),
        el("div", { class: "admin-muted", style: "margin-top:0.5rem;", text: "新 passphrase（只顯示這一次）" }),
        passCode,
        el("div", { class: "row-actions", style: "margin-top:0.75rem;" }, [
          el("a", { class: "btn", href: data.preview_url, target: "_blank", rel: "noopener", text: "開啟" }),
          copyLink, copyPass
        ])
      ],
      actions: [{ label: "關閉", cls: "", onClick: function (close) { close(); } }]
    });
  }

  function openResetModal(it) {
    var keyInput = el("textarea", { class: "text", rows: "4", placeholder: "貼上復原私鑰（recovery-keygen 產生的私鑰；未加密為 base64，或加密後的 JSON 檔內容）", style: "width:100%;box-sizing:border-box;font-family:monospace;" });
    var passInput = el("input", { class: "text", type: "password", placeholder: "若私鑰有加密保護，輸入其 passphrase（否則留空）", style: "width:100%;box-sizing:border-box;margin-top:0.5rem;" });
    var errBox = el("div", { class: "msg-err" });
    var close = modal({
      title: "Reset & 重新分享（換 passphrase）",
      bodyNodes: [
        el("p", { class: "admin-muted", text: "用離線復原私鑰在本機還原內容金鑰，換上全新 passphrase 產生新連結，並作廢舊連結。私鑰只在瀏覽器使用，不會上傳。" }),
        keyInput, passInput, errBox
      ],
      actions: [
        { label: "取消", cls: "", onClick: function (c) { c(); } },
        { label: "Reset", cls: "btn-primary", onClick: function (c) {
          errBox.textContent = "";
          api.recoveryDek(it.kind, it.id)
            .then(function (data) {
              return resolvePrivateKey(keyInput.value, passInput.value)
                .then(function (privB64) { return window.AgentGateCrypto.recoverDek(privB64, data.wrap_recov); });
            })
            .then(function (dek) {
              var newPass = window.AgentGateCrypto.randomPassphrase();
              return window.AgentGateCrypto.rewrapUnderPassphrase(dek, newPass)
                .then(function (wrap) {
                  return api.resetReshare(it.kind, it.id, { salt: wrap.salt, iv_p: wrap.iv_p, wrap_pass: wrap.wrap_pass });
                })
                .then(function (res) { c(); showResetResult(res, newPass); loadTable(); });
            })
            .catch(function (e) {
              if (e && e.status === 409) {
                errBox.textContent = "此分享沒有復原金鑰（在啟用復原前上傳），無法 Reset。可改用 Revoke 或刪除。";
              } else {
                errBox.textContent = (e && e.message) || "Reset 失敗（私鑰是否正確？）";
              }
            });
        } }
      ]
    });
    return close;
  }
```

Then add the button in `renderRow`, alongside the existing action buttons:
```js
    var resetBtn = el("button", { class: "btn btn-sm", text: "Reset 換金鑰" });
    resetBtn.addEventListener("click", function () { openResetModal(it); });
```
and include `resetBtn` in the row-actions array (place it after `reshareBtn`):
```js
      el("td", {}, [el("div", { class: "row-actions" }, [keepBtn, reshareBtn, resetBtn, revokeBtn, delBtn])])
```

- [ ] **Step 3: Sanity check + optional CSS**

Run: `node --check web/static/js/admin-dashboard.js && node --check web/static/js/admin-api.js && echo ok`
Expected: `ok`. The modal reuses existing `.modal`/`.text`/`.btn` styles; a `<textarea class="text">` inherits the input styling. If the end-to-end check (Task 5) shows the textarea unstyled/too small, add a minimal `.modal textarea.text{...}` rule to `web/static/css/style.css` (or the scoped block in `web/static/views/admin.html`) — otherwise leave CSS unchanged.

- [ ] **Step 4: Sync assets if required**

The Worker serves assets from `worker/public`, populated from `web/static` by `npm run sync-assets` (see `worker/wrangler.jsonc`). If that sync is needed for the Worker to serve updated JS, run it (check `worker/package.json` / root scripts for `sync-assets`). For the Go self-host, `web/static` is embedded — a rebuild picks it up. Note in the report which sync you ran.

- [ ] **Step 5: Commit**

```bash
git add web/static/js/admin-api.js web/static/js/admin-dashboard.js
git commit -m "feat(web): admin Reset & re-share flow (offline recovery key)"
```

---

### Task 5: End-to-end verification + operator docs

**Files:**
- Modify: `README.md` (recovery-keygen + reset & re-share operator section)
- Verification only (no product code)

- [ ] **Step 1: End-to-end test against the Go server**

This is the decisive Go↔browser cross-language check. Use the webapp-testing (Playwright) skill or Claude-in-Chrome. Steps:

1. Build the CLI and server. Generate a recovery keypair:
   `go run ./cmd/agentgate recovery-keygen -o /tmp/ag-recovery.key` → capture the printed PUBLIC key and the private key file.
2. Start the server with admin + recovery:
   `AGENTGATE_SESSION_SECRET=testsecret AGENTGATE_OWNER_KEY=testkey go run ./cmd/server --port 18090 --db /tmp/ag-e2e-$$.db --base-url http://localhost:18090 &`
3. Upload a v2 diff with a known passphrase and the recovery pubkey set:
   `printf 'diff --git a/x b/x\n+hello-v2\n' > /tmp/x.diff`
   `AGENTGATE_RECOVERY_PUBKEY=<pub> go run ./cmd/agentgate diff -s http://localhost:18090 -p oldpass /tmp/x.diff` → capture the preview URL.
4. Browser: open the preview URL, enter `oldpass` → assert the diff content (`hello-v2`) renders. (Proves v2 `decryptShare`.)
5. Browser: open `http://localhost:18090/admin`, log in with `testkey`, locate the uploaded share, click **Reset 換金鑰**, paste the contents of `/tmp/ag-recovery.key`, submit → capture the new preview URL and the new passphrase shown.
6. Browser: open the NEW preview URL, enter the NEW passphrase → assert `hello-v2` renders. (Proves reset + recovery unwrap + re-wrap end-to-end, Go→JS→Go→JS.)
7. Browser: open the ORIGINAL preview URL → assert 404 / not-found (source revoked). Also confirm entering `oldpass` on the new link fails.
8. Stop the server; remove the temp DB and key file.

Capture a screenshot or a written pass/fail for each of steps 4, 6, 7. If the browser tooling cannot run in this environment, STOP and report BLOCKED (this task's whole value is the live cross-language check) — do not mark it done from code inspection alone.

- [ ] **Step 2: Also confirm a v1 share still decrypts (no regression)**

Upload a share WITHOUT `AGENTGATE_RECOVERY_PUBKEY` (`go run ./cmd/agentgate diff -s http://localhost:18090 -p v1pass /tmp/x.diff`), open it, enter `v1pass` → content renders. Confirms Task 3 didn't break v1.

- [ ] **Step 3: Operator docs**

Add a README section "Owner reset & re-share (recovery key)" covering: (a) `agentgate recovery-keygen [-o file] [-p passphrase]` — store the private key OFFLINE; (b) set `AGENTGATE_RECOVERY_PUBKEY` to the public key on the uploader **only after** deploying a v2-capable server + viewer (reference the Plan-1 rollout warning: setting it earlier causes silent data loss); (c) in `/admin`, "Reset 換金鑰" recovers the content with the offline private key, mints a new link + passphrase, and revokes the old one; the old passphrase can no longer decrypt the (revoked) source. Note that shares uploaded without a recovery key cannot be reset (only revoked/deleted).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): owner reset & re-share with offline recovery key"
```

---

## Self-Review

**Spec coverage:** §7 browser reset flow (recover DEK offline → new passphrase → reset-reshare) — Tasks 2, 4, verified Task 5. §4.3 v2 viewer decrypt — Tasks 2, 3. §5 private key must never reach server + PKCS8 for WebCrypto — Tasks 1, 2, 4 (private key handled only in-browser). §9 non-reset-capable → friendly 409 handling — Task 4. Operator docs + rollout ordering — Task 5.

**Placeholder scan:** All crypto/UI/API code is complete. Task-5 is verification with concrete commands; it explicitly must BLOCK rather than pass on inspection if the browser can't run.

**Type consistency:** `decryptShare(enc,passphrase)`, `recoverDek(privB64,wrapRecov)->Uint8Array`, `rewrapUnderPassphrase(dek,pass)->{salt,iv_p,wrap_pass}`, `randomPassphrase()`; admin-api `recoveryDek`/`resetReshare`; body `{salt,iv_p,wrap_pass}` — all consistent with the Plan-2 endpoints and the Go PKCS8/`wrap_recov{epk,iv,ct}` shapes. HKDF salt (32 zeros) + info string match Go exactly.
