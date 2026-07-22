// web/static/js/crypto.crossvector.test.mjs
//
// Proves Go<->JS interop for the v2 envelope + recovery-key scheme: a vector
// produced by the REAL internal/crypto Go package (via cmd/crossvector) is
// decrypted and recovered by the REAL browser crypto.js.
//
// Run:
//   go run ./cmd/crossvector > /tmp/ag-crossvector.json
//   node web/static/js/crypto.crossvector.test.mjs /tmp/ag-crossvector.json
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert";

// Shim the browser globals crypto.js expects, then load the IIFE. Same
// harness as crypto.node.test.mjs. Node v24 defines a getter-only
// globalThis.crypto, so a plain assignment throws; redefine the property
// instead (harness-only, does not change any test assertion or crypto.js
// behavior).
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
globalThis.window = {};
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob = (b) => Buffer.from(b, "base64").toString("binary");
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
const src = readFileSync(new URL("./crypto.js", import.meta.url), "utf8");
new Function(src)(); // executes the IIFE, populates window.AgentGateCrypto
const C = globalThis.window.AgentGateCrypto;

const vectorPath = process.argv[2];
if (!vectorPath) {
  console.error("usage: node crypto.crossvector.test.mjs <path-to-vector.json>");
  process.exit(1);
}
const vector = JSON.parse(readFileSync(vectorPath, "utf8"));

async function main() {
  // 1. Go-encrypted v2 envelope decrypts under the original passphrase in JS.
  const decrypted = await C.decryptShare(vector.envelope, vector.passphrase);
  assert.equal(decrypted, vector.plaintext, "Go-encrypt -> JS v2 decryptShare mismatch");

  // 2. Go recovery keypair + Go ECIES wrap unwraps to a 32-byte DEK in JS.
  const dek = await C.recoverDek(vector.priv, vector.envelope.wrap_recov);
  assert.ok(dek instanceof Uint8Array, "recoverDek did not return a Uint8Array");
  assert.equal(dek.length, 32, "recovered DEK is not 32 bytes");

  // 3. Rewrap the recovered DEK under a new passphrase (JS side), build a
  // rekeyed envelope (same ciphertext/iv/wrap_recov, new salt/iv_p/wrap_pass),
  // and confirm the new passphrase decrypts while the old one is rejected.
  const wrap = await C.rewrapUnderPassphrase(dek, "newpass");
  const rekeyed = {
    v: 2,
    ciphertext: vector.envelope.ciphertext,
    iv: vector.envelope.iv,
    wrap_recov: vector.envelope.wrap_recov,
    salt: wrap.salt,
    iv_p: wrap.iv_p,
    wrap_pass: wrap.wrap_pass,
  };
  const rekeyedPlaintext = await C.decryptShare(rekeyed, "newpass");
  assert.equal(rekeyedPlaintext, vector.plaintext, "rekeyed envelope did not decrypt under newpass");
  await assert.rejects(() => C.decryptShare(rekeyed, vector.passphrase), "old passphrase should be rejected after rewrap");

  console.log("crossvector: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
