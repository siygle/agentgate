// Thin fetch wrapper for the owner-dashboard admin API. Every call rides the
// same-origin session cookie and parses the {success,data}/{success,error}
// envelope, rejecting with an Error (carrying .status) on failure. Mirrors the
// pattern in expiry-controls.js.
(function () {
  "use strict";

  function req(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (resp) {
      return resp
        .json()
        .catch(function () { return {}; })
        .then(function (b) {
          if (!resp.ok || !b || !b.success) {
            var msg = (b && b.error) || "request failed (" + resp.status + ")";
            var err = new Error(msg);
            err.status = resp.status;
            throw err;
          }
          return b.data;
        });
    });
  }

  function query(params) {
    var qs = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === "" || v === null || v === undefined) continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
    return qs.length ? "?" + qs.join("&") : "";
  }

  window.AgentGateAdminApi = {
    status: function () {
      return req("GET", "/api/admin/session");
    },
    loginOwnerKey: function (key) {
      return req("POST", "/api/admin/login/owner-key", { key: key });
    },
    logout: function () {
      return req("POST", "/api/admin/logout");
    },
    list: function (params) {
      return req("GET", "/api/admin/shares" + query(params));
    },
    keepForever: function (kind, id, v) {
      return req("PATCH", "/api/admin/" + kind + "/" + encodeURIComponent(id), { never_expires: v });
    },
    revoke: function (kind, id) {
      return req("POST", "/api/admin/" + kind + "/" + encodeURIComponent(id) + "/revoke");
    },
    reshare: function (kind, id, opts) {
      return req("POST", "/api/admin/" + kind + "/" + encodeURIComponent(id) + "/reshare", opts || {});
    },
    remove: function (kind, id) {
      return req("DELETE", "/api/admin/" + kind + "/" + encodeURIComponent(id));
    }
  };
})();
