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

  function deriveKey(passphrase, salt) {
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
          ["decrypt"]
        );
      });
  }

  function decrypt(ciphertext, iv, salt, passphrase) {
    var saltBytes = fromBase64(salt);
    var ivBytes = fromBase64(iv);
    return deriveKey(passphrase, saltBytes).then(function (key) {
      return crypto.subtle
        .decrypt({ name: "AES-GCM", iv: ivBytes }, key, fromBase64(ciphertext))
        .then(function (decrypted) {
          return new TextDecoder().decode(decrypted);
        });
    });
  }

  window.DiffminiCrypto = { decrypt: decrypt };
})();
