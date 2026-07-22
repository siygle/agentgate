(function () {
  "use strict";

  var PBKDF2_ITERATIONS = 600000;

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function fromBase64(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function deriveKey(passphrase, salt, usages) {
    var encoder = new TextEncoder();
    return crypto.subtle
      .importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
        "deriveKey",
      ])
      .then(function (keyMaterial) {
        return crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256",
          },
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
        .then(function (decrypted) {
          return new TextDecoder().decode(decrypted);
        });
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
})();
