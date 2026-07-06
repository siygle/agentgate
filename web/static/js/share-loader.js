(function () {
  "use strict";

  // Plan B: the page is a static shell. It derives kind+id from the URL path and
  // fetches the ciphertext + expiry metadata from GET /api/{kind}/{id}, replacing
  // the old server-injected hidden <div> elements. All viewers read share state
  // through window.AgentGateShare instead of the DOM.

  // Route prefix -> API kind. Diff shares are /p/ (kind "diff"); everything else
  // (files, webapp, plan, docs) is stored as a file bundle (kind "files").
  var ROUTE_KIND = { p: "diff", f: "files", app: "files", plan: "files", d: "files" };

  function parseRoute() {
    var m = (location.pathname || "").match(/^\/(p|f|app|plan|d)\/([^\/?#]+)/);
    if (!m) return null;
    return { view: m[1], id: decodeURIComponent(m[2]), kind: ROUTE_KIND[m[1]] };
  }

  var route = parseRoute();
  var state = null; // { encrypted, expiresAt, neverExpires, id, kind } | { notFound: true }
  var promise = null;

  function load() {
    if (promise) return promise;
    if (!route) {
      state = { notFound: true };
      promise = Promise.resolve(state);
      return promise;
    }
    var url = "/api/" + route.kind + "/" + encodeURIComponent(route.id);
    promise = fetch(url, { headers: { Accept: "application/json" } })
      .then(function (resp) {
        if (resp.status === 404) {
          state = { notFound: true };
          return null;
        }
        if (!resp.ok) throw new Error("Failed to load share (" + resp.status + ")");
        return resp.json();
      })
      .then(function (body) {
        if (state && state.notFound) return state;
        var d = (body && body.data) || body || {};
        state = {
          encrypted: d.encrypted_data || null,
          expiresAt: d.expires_at || "",
          neverExpires: !!d.never_expires,
          id: d.id || route.id,
          kind: d.kind || route.kind,
        };
        return state;
      });
    return promise;
  }

  function renderNotFound() {
    var app = document.getElementById("app");
    if (!app) return;
    app.innerHTML =
      '<div class="not-found">' +
      "<h1>404</h1>" +
      "<p>Not found or expired</p>" +
      '<a href="/" class="btn" style="margin-top:1.5rem;">Back to home</a>' +
      "</div>";
  }

  window.AgentGateShare = {
    route: route,
    load: load,
    getEncryptedData: function () {
      return state && !state.notFound ? state.encrypted : null;
    },
    getExpiresAt: function () {
      return state && !state.notFound ? state.expiresAt || "" : "";
    },
    getShareMeta: function () {
      if (!state || state.notFound) return null;
      return { id: state.id, kind: state.kind, neverExpires: state.neverExpires };
    },
    getShareId: function () {
      return state && !state.notFound ? state.id : "unknown";
    },
    renderNotFound: renderNotFound,
  };
})();
