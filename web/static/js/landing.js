(function () {
  "use strict";

  // Landing-page behaviour. Lives in a file rather than inline so the host pages can send
  // `script-src 'self'` with no inline allowance -- see pageCSP in handlers_pages.go.
  //
  // For the same reason, event handlers are wired here with addEventListener instead of
  // inline `onclick=` attributes: an inline handler is itself inline script and is blocked
  // by that strict policy, so the buttons would silently do nothing.

  function getSetupText() {
    var origin = window.location.origin;
    return [
      "# AgentGate CLI Setup",
      "#",
      "# AgentGate is an encrypted diff & file sharing tool.",
      "# CLI encrypts content client-side and uploads to the server.",
      "",
      "# 1. Install CLI",
      "go install github.com/siygle/agentgate/cmd/agentgate@latest",
      "",
      "# 2. Configure server URL (required)",
      "# Add to your shell profile (~/.zshrc or ~/.bashrc):",
      "export AGENTGATE_SERVER=" + origin,
      "",
      "# 3. Generate encryption passphrase",
      "agentgate key-gen",
      "source ~/.zshrc  # or ~/.bashrc",
      "",
      "# 4. Usage",
      "agentgate git-latest              # Share latest commit diff",
      "agentgate git-staged              # Share staged changes",
      "agentgate files path/to/file.ts   # Share files",
      "",
      "# Environment variables:",
      "# AGENTGATE_SERVER     - Server URL (required, no default)",
      "# AGENTGATE_PASSPHRASE - Encryption passphrase",
      "",
      "# Flags: -s <server> -p <passphrase> override env vars",
    ].join("\n");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function openSetupModal() {
    byId("setup-content").textContent = getSetupText();
    byId("setup-modal").style.display = "flex";
    var copyBtn = byId("setup-copy-btn");
    copyBtn.textContent = "Copy";
    // Move focus into the dialog so keyboard and screen-reader users land there.
    copyBtn.focus();
  }

  function closeSetupModal() {
    byId("setup-modal").style.display = "none";
  }

  function copySetup() {
    var text = getSetupText();
    var btn = byId("setup-copy-btn");
    if (!navigator.clipboard) {
      btn.textContent = "Copy failed";
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () {
        btn.textContent = "Copied";
        setTimeout(function () {
          btn.textContent = "Copy";
        }, 2000);
      },
      function () {
        btn.textContent = "Copy failed";
      }
    );
  }

  function wire() {
    var openButtons = document.querySelectorAll("[data-setup-open]");
    for (var i = 0; i < openButtons.length; i++) {
      openButtons[i].addEventListener("click", openSetupModal);
    }

    var closeBtn = byId("setup-close-btn");
    var copyBtn = byId("setup-copy-btn");
    var backdrop = byId("setup-modal");

    if (closeBtn) closeBtn.addEventListener("click", closeSetupModal);
    if (copyBtn) copyBtn.addEventListener("click", copySetup);
    if (backdrop) {
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) closeSetupModal();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSetupModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
