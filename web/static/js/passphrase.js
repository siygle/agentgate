(function () {
  "use strict";

  var STORAGE_KEY = "agentgate-passphrase";

  function getStoredPassphrase() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storePassphrase(passphrase) {
    try {
      localStorage.setItem(STORAGE_KEY, passphrase);
    } catch (e) {
      // silently fail
    }
  }

  function clearStoredPassphrase() {
    try {
      localStorage.removeItem(STORAGE_KEY);
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
