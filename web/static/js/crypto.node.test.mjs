// web/static/js/crypto.node.test.mjs
// Run: node web/static/js/crypto.node.test.mjs
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import assert from "node:assert";

// Shim the browser globals crypto.js expects, then load the IIFE.
// Node 19+ already defines a getter-only `globalThis.crypto`, so a plain
// assignment throws; redefine the property instead (harness-only, does not
// change any test assertion or crypto.js behavior).
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true, writable: true });
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
