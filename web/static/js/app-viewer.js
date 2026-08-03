(function () {
  "use strict";

  // The webapp view: decrypt a bundle that carries its own index.html, then hand it to
  // AgentGateSandbox to run in an opaque-origin iframe. All of the assembly, builtin
  // inlining, CSP, and message bridging now lives in sandbox.js, which every share type
  // shares — this file is only the /app chrome around it.

  function renderAppViewer(data, expiresAt) {
    var app = document.getElementById("app");
    if (!app) return;

    var Sandbox = window.AgentGateSandbox;
    var files = data.files || [];

    var viewer = document.createElement("div");
    viewer.className = "app-viewer";

    var headerEl = document.createElement("header");
    headerEl.className = "file-viewer-header";

    var headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.style.gap = "0.75rem";

    var label = document.createElement("span");
    label.textContent = "webapp — " + files.length + " file" + (files.length !== 1 ? "s" : "");
    headerLeft.appendChild(label);

    var meta = window.AgentGateExpiry ? window.AgentGateExpiry.getShareMeta() : null;
    var badgeHandle = window.AgentGateExpiry
      ? window.AgentGateExpiry.createExpiryBadge(expiresAt, meta && meta.neverExpires)
      : null;
    if (badgeHandle) headerLeft.appendChild(badgeHandle.node);

    var headerRight = document.createElement("div");
    headerRight.style.flexShrink = "0";
    headerRight.style.display = "flex";
    headerRight.style.alignItems = "center";
    headerRight.style.gap = "0.75rem";

    if (badgeHandle && meta && window.AgentGateExpiry) {
      var toggle = window.AgentGateExpiry.createOwnerToggle(meta, badgeHandle);
      if (toggle) headerRight.appendChild(toggle);
    }
    if (window.AgentGateSettings) {
      window.AgentGateSettings.renderSettingsPanel(headerRight);
    }

    headerEl.appendChild(headerLeft);
    headerEl.appendChild(headerRight);
    viewer.appendChild(headerEl);

    var loading = document.createElement("div");
    loading.className = "app-error";
    loading.textContent = "Preparing webapp...";
    viewer.appendChild(loading);

    app.innerHTML = "";
    app.appendChild(viewer);

    if (!Sandbox) {
      loading.textContent = "Sandbox unavailable — sandbox.js failed to load.";
      return;
    }

    Sandbox.assembleWebapp(files)
      .then(function (result) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        var handle = null;

        if (result.error) {
          var err = document.createElement("div");
          err.className = "app-error";
          err.textContent = result.error;
          viewer.appendChild(err);
        } else {
          // autoHeight is deliberately off here. Uploaded webapps were authored against
          // a fixed-size viewport and may use vh units or their own internal scrolling;
          // growing the frame to content height could change how existing shares look.
          // Built-in renderers, which AgentGate controls, do opt in.
          handle = Sandbox.mount(viewer, result.html, { autoHeight: false });
        }

        if (window.AgentGateExport) {
          window.AgentGateExport.renderExportControl(headerRight, {
            kind: "app",
            title: data.title || "webapp",
            multi: false,
            sources: files.map(function (f) {
              return { name: f.title, content: f.content, encoding: f.encoding };
            }),
            // Expand the frame to full height, then print, so the PDF paginates instead
            // of clipping to one page. With nothing mounted, fall back to a plain print.
            pdfCustom: handle
              ? function () {
                  Sandbox.printFullHeight(handle);
                }
              : null,
            pdfLive: !handle,
          });
        }
      })
      .catch(function (err) {
        console.error("Failed to prepare webapp:", err);
        loading.textContent = "Failed to prepare webapp: " + (err && err.message ? err.message : err);
      });
  }

  function attemptDecrypt(passphrase, remember) {
    var S = window.AgentGateShare;
    var encrypted = S ? S.getEncryptedData() : null;
    if (!encrypted) return;

    var P = window.AgentGatePassphrase;
    if (P) P.showDecryptingState();

    window.AgentGateCrypto
      .decryptShare(encrypted, passphrase)
      .then(function (plaintext) {
        var data = JSON.parse(plaintext);
        if (remember && P) P.storePassphrase(passphrase);
        if (P) P.hidePassphraseDialog();
        renderAppViewer(data, S.getExpiresAt());
      })
      .catch(function (err) {
        console.error("Decryption failed:", err);
        if (P) {
          P.updatePassphraseError("Decryption failed. Please check your passphrase.");
        }
      });
  }

  function init() {
    if (window.AgentGateSettings) {
      window.AgentGateSettings.init();
    }

    var S = window.AgentGateShare;
    var P = window.AgentGatePassphrase;
    if (!S || !P) return;

    S.load()
      .then(function (share) {
        if (!share || share.notFound || !share.encrypted) {
          S.renderNotFound();
          return;
        }
        var stored = P.getStoredPassphrase();
        if (stored) {
          P.showPassphraseDialog(attemptDecrypt, { isDecrypting: true });
          attemptDecrypt(stored, true);
        } else {
          P.showPassphraseDialog(attemptDecrypt);
        }
      })
      .catch(function (err) {
        console.error("Failed to load share:", err);
        S.renderNotFound();
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
