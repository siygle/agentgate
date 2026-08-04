(function () {
  "use strict";

  // Boots the share shell. A one-liner in its own file rather than an inline <script>,
  // so the host pages can send `script-src 'self'` with no inline allowance at all —
  // see pageCSP in internal/server/handlers_pages.go.
  window.AgentGateShell.start(window.AgentGateShareKind.plan);
})();
