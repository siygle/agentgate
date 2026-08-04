(function () {
  "use strict";

  // Landing-page behaviour. Lives in a file rather than inline so the host pages can send
  // `script-src 'self'` with no inline allowance — see pageCSP in handlers_pages.go.

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

  function openSetupModal() {
    document.getElementById("setup-content").textContent = getSetupText();
    document.getElementById("setup-modal").style.display = "flex";
    document.getElementById("setup-copy-btn").textContent = "Copy";
  }

  function closeSetupModal() {
    document.getElementById("setup-modal").style.display = "none";
  }

  function copySetup() {
    var text = getSetupText();
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById("setup-copy-btn");
      btn.textContent = "Copied!";
      setTimeout(function () {
        btn.textContent = "Copy";
      }, 2000);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSetupModal();
  });
})();
