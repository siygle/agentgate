(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatAbsolute(expiresAt) {
    try {
      var d = new Date(expiresAt);
      if (isNaN(d.getTime())) return "";
      var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
      return (
        d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
      );
    } catch (e) {
      return "";
    }
  }

  function formatRelative(expiresAt) {
    if (!expiresAt) return { text: "", isWarning: false };
    try {
      var now = Date.now();
      var exp = new Date(expiresAt).getTime();
      var diff = exp - now;
      if (diff <= 0) return { text: "Expired", isWarning: true };
      var minutes = Math.floor(diff / 60000);
      var hours = Math.floor(minutes / 60);
      var remainMinutes = minutes % 60;
      var text = hours > 0
        ? hours + "h " + remainMinutes + "m remaining"
        : minutes + "m remaining";
      return { text: text, isWarning: minutes < 60 };
    } catch (e) {
      return { text: expiresAt, isWarning: false };
    }
  }

  // renderBadge writes the badge contents based on current state.
  function renderBadge(badge, state) {
    var classes = ["expiry-badge"];
    var html;
    if (state.neverExpires) {
      classes.push("expiry-badge--preserved");
      html = '<span class="expiry-dot"></span>永久保留 <span aria-hidden="true">🔒</span>';
      badge.removeAttribute("title");
    } else {
      var info = formatRelative(state.expiresAt);
      if (info.isWarning) classes.push("expiry-badge--warning");
      html = '<span class="expiry-dot"></span>' + escapeHtml(info.text);
      var abs = formatAbsolute(state.expiresAt);
      if (abs) badge.setAttribute("title", "Expires at " + abs);
    }
    badge.className = classes.join(" ");
    badge.innerHTML = html;
  }

  // createExpiryBadge returns an object with the DOM node and an update fn
  // so callers can flip the badge after a server-side change.
  function createExpiryBadge(expiresAt, neverExpires) {
    var state = { expiresAt: expiresAt, neverExpires: !!neverExpires };
    var badge = document.createElement("span");
    renderBadge(badge, state);

    setInterval(function () {
      if (!state.neverExpires) renderBadge(badge, state);
    }, 60000);

    return {
      node: badge,
      setNeverExpires: function (v, newExpiresAt) {
        state.neverExpires = !!v;
        if (newExpiresAt) state.expiresAt = newExpiresAt;
        renderBadge(badge, state);
      },
    };
  }

  function getShareMeta() {
    return window.AgentGateShare ? window.AgentGateShare.getShareMeta() : null;
  }

  function getOwnerTokenFromFragment() {
    var hash = window.location.hash || "";
    if (!hash) return null;
    // Strip leading "#" so parsing works whether the fragment uses
    // "owner=..." alone or "&owner=..." after another key.
    var trimmed = hash.charAt(0) === "#" ? hash.substring(1) : hash;
    var parts = trimmed.split("&");
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv[0] === "owner" && kv[1]) {
        try { return decodeURIComponent(kv[1]); } catch (e) { return kv[1]; }
      }
    }
    return null;
  }

  // createOwnerToggle renders a "永久保留" checkbox bound to the share's
  // never_expires flag. Returns null when no owner token is present in the
  // URL fragment (i.e. the viewer is not the share's owner).
  function createOwnerToggle(meta, badgeHandle) {
    var token = getOwnerTokenFromFragment();
    if (!token || !meta) return null;

    var wrapper = document.createElement("label");
    wrapper.className = "owner-toggle";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!meta.neverExpires;

    var text = document.createElement("span");
    text.textContent = "永久保留";

    var status = document.createElement("span");
    status.className = "owner-toggle-status";

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    wrapper.appendChild(status);

    checkbox.addEventListener("change", function () {
      var desired = checkbox.checked;
      checkbox.disabled = true;
      status.textContent = "更新中…";
      status.className = "owner-toggle-status";

      var endpoint = "/api/" + meta.kind + "/" + encodeURIComponent(meta.id);
      fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        body: JSON.stringify({ never_expires: desired }),
      })
        .then(function (resp) { return resp.json().then(function (b) { return { ok: resp.ok, body: b }; }); })
        .then(function (r) {
          if (!r.ok || !r.body || !r.body.success) {
            throw new Error((r.body && r.body.error) || "更新失敗");
          }
          var data = r.body.data || {};
          meta.neverExpires = !!data.never_expires;
          checkbox.checked = meta.neverExpires;
          badgeHandle.setNeverExpires(meta.neverExpires, data.expires_at);
          status.textContent = "已儲存";
          status.className = "owner-toggle-status owner-toggle-status--ok";
          setTimeout(function () { status.textContent = ""; }, 2000);
        })
        .catch(function (err) {
          checkbox.checked = meta.neverExpires; // revert
          status.textContent = err && err.message ? err.message : "更新失敗";
          status.className = "owner-toggle-status owner-toggle-status--err";
        })
        .then(function () {
          checkbox.disabled = false;
        });
    });

    return wrapper;
  }

  window.AgentGateExpiry = {
    createExpiryBadge: createExpiryBadge,
    getShareMeta: getShareMeta,
    createOwnerToggle: createOwnerToggle,
  };
})();
