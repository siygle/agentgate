(function () {
  "use strict";

  // Remembered passphrases are scoped per share. The previous single global key meant
  // every share on this origin shared one stored secret, so anything able to read
  // localStorage from this page — e.g. markup or an MDX expression inside *another*
  // share — could lift a passphrase that unlocks unrelated content. Scoping keeps the
  // blast radius to the one share the visitor already has the passphrase for.
  var LEGACY_STORAGE_KEY = "agentgate-passphrase";
  var STORAGE_PREFIX = "agentgate-passphrase:";

  // shareKey returns this share's storage key, or "" when the id is unknown (e.g. the
  // landing page). An unknown id must NOT fall back to a shared key — that is the
  // behaviour being removed — so callers treat "" as "storage unavailable".
  function shareKey() {
    var S = window.AgentGateShare;
    var id = (S && S.route && S.route.id) || (S && S.getShareId && S.getShareId());
    if (!id || id === "unknown") return "";
    return STORAGE_PREFIX + id;
  }

  function readLegacy() {
    try {
      return localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function getStoredPassphrase() {
    var key = shareKey();
    if (!key) return null;
    try {
      var scoped = localStorage.getItem(key);
      if (scoped !== null) return scoped;
    } catch (e) {
      return null;
    }
    // Migration read-only fallback: a passphrase remembered under the old global key
    // is still offered, so upgrading does not force everyone to re-enter it. It is
    // adopted into the scoped key (and the global one dropped) by storePassphrase
    // once it has actually decrypted this share.
    return readLegacy();
  }

  function storePassphrase(passphrase) {
    var key = shareKey();
    if (!key) return;
    try {
      localStorage.setItem(key, passphrase);
      // Only retire the global key once a share has adopted the exact same value —
      // proof it was valid here. A different value means the global key still belongs
      // to some other share, so leave it for that share to migrate.
      if (readLegacy() === passphrase) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (e) {
      // silently fail
    }
  }

  function clearStoredPassphrase() {
    var key = shareKey();
    try {
      if (key) localStorage.removeItem(key);
      // An explicit clear also drops the pre-scoping key, so "forget my passphrase"
      // cannot leave a copy behind.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      // silently fail
    }
  }

  function showPassphraseDialog(onSubmit, options) {
    options = options || {};
    var errorMsg = options.error || null;
    var isDecrypting = options.isDecrypting || false;

    // Remove existing dialog if any
    hidePassphraseDialog();

    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "passphrase-backdrop";

    var modal = document.createElement("div");
    modal.className = "modal";

    var lockSvg =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:0.5rem">' +
      '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>' +
      '<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>' +
      "</svg>";

    modal.innerHTML =
      '<form id="passphrase-form">' +
      "<h2 style=\"font-size:1.25rem;font-weight:600;margin-bottom:0.5rem\">" +
      lockSvg +
      "Enter passphrase</h2>" +
      '<p class="text-sm text-muted" style="margin-bottom:1rem">This content is encrypted. Enter the passphrase to view it.</p>' +
      '<div style="margin-bottom:1rem">' +
      '<input type="password" id="passphrase-input" placeholder="Passphrase" autocomplete="off" ' +
      'class="form-input" style="width:100%;box-sizing:border-box" />' +
      "</div>" +
      '<div style="margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem">' +
      '<input type="checkbox" id="passphrase-remember" checked />' +
      '<label for="passphrase-remember" class="text-sm">Remember in this browser</label>' +
      "</div>" +
      '<div id="passphrase-error" class="text-sm" style="color:var(--danger,#ef4444);margin-bottom:0.75rem;display:' +
      (errorMsg ? "block" : "none") +
      '">' +
      (errorMsg || "") +
      "</div>" +
      '<button type="submit" id="passphrase-submit" class="btn btn-primary" ' +
      'style="width:100%"' +
      (isDecrypting ? " disabled" : "") +
      ">" +
      (isDecrypting ? "Decrypting..." : "Decrypt") +
      "</button>" +
      "</form>";

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    var input = document.getElementById("passphrase-input");
    if (input) input.focus();

    var form = document.getElementById("passphrase-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var passphrase = document.getElementById("passphrase-input").value;
      var remember = document.getElementById("passphrase-remember").checked;
      if (!passphrase) return;
      onSubmit(passphrase, remember);
    });
  }

  function hidePassphraseDialog() {
    var existing = document.getElementById("passphrase-backdrop");
    if (existing) existing.remove();
  }

  function updatePassphraseError(msg) {
    var errorEl = document.getElementById("passphrase-error");
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = "block";
    }
    var btn = document.getElementById("passphrase-submit");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Decrypt";
    }
    var input = document.getElementById("passphrase-input");
    if (input) {
      input.disabled = false;
      input.focus();
    }
  }

  function showDecryptingState() {
    var btn = document.getElementById("passphrase-submit");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Decrypting...";
    }
    var input = document.getElementById("passphrase-input");
    if (input) input.disabled = true;
  }

  window.AgentGatePassphrase = {
    getStoredPassphrase: getStoredPassphrase,
    storePassphrase: storePassphrase,
    clearStoredPassphrase: clearStoredPassphrase,
    showPassphraseDialog: showPassphraseDialog,
    hidePassphraseDialog: hidePassphraseDialog,
    updatePassphraseError: updatePassphraseError,
    showDecryptingState: showDecryptingState,
  };
})();
