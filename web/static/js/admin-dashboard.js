// Owner (instance-admin) dashboard controller. Probes /api/admin/session, then
// renders either the login card (owner key + Cloudflare Access, driven by the
// server's enabled-methods flag) or the shares table with per-row actions.
// Vanilla ES5 IIFE, matching the other viewers; styling via style.css tokens
// and the scoped block in admin.html.
(function () {
  "use strict";

  var api = window.AgentGateAdminApi;
  var app = document.getElementById("app");

  function t(key, vars, fallback) {
    if (window.AgentGateI18n && window.AgentGateI18n.t) {
      return window.AgentGateI18n.t(key, vars);
    }
    return fallback != null ? fallback : key;
  }

  var state = {
    limit: 50,
    offset: 0,
    sort: "created_at",
    order: "desc",
    status: "all",
    kind: "all",
    total: 0,
    lastSession: null,
    lastItems: null
  };

  // Host element for the shares table, set by renderDashboard.
  var tableHost = null;

  // --- tiny DOM helper ---
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.substring(2), v);
        else if (v != null) node.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function langSwitcher() {
    return window.AgentGateI18n ? window.AgentGateI18n.createSwitcher() : null;
  }

  // --- formatting ---
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtSize(bytes) {
    if (bytes == null) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // --- modal ---
  function modal(opts) {
    // opts: { title, bodyNodes:[], actions:[{label,cls,onClick}] }
    var backdrop = el("div", { class: "modal-backdrop" });
    var box = el("div", { class: "modal" });
    box.appendChild(el("h2", { text: opts.title }));
    (opts.bodyNodes || []).forEach(function (n) { box.appendChild(n); });
    var actions = el("div", { class: "modal-actions" });
    function close() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
    (opts.actions || []).forEach(function (a) {
      actions.appendChild(el("button", {
        type: "button",
        class: "btn " + (a.cls || ""),
        text: a.label,
        onclick: function () { a.onClick(close); }
      }));
    });
    box.appendChild(actions);
    backdrop.appendChild(box);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
    document.body.appendChild(backdrop);
    return close;
  }

  function confirmModal(title, message, confirmLabel, cls, onConfirm) {
    modal({
      title: title,
      bodyNodes: [el("p", { text: message })],
      actions: [
        { label: t("common.cancel", null, "Cancel"), cls: "", onClick: function (close) { close(); } },
        { label: confirmLabel, cls: cls, onClick: function (close) { close(); onConfirm(); } }
      ]
    });
  }

  // --- login ---
  function renderLogin(info) {
    clear(app);
    var methods = info.methods || [];
    var card = el("div", { class: "login-card" });
    var headRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:0.75rem;" }, [
      el("h1", { text: t("admin.title", null, "Owner Dashboard") }),
      langSwitcher()
    ]);
    card.appendChild(headRow);
    card.appendChild(el("div", { class: "admin-muted", text: t("admin.loginSubtitle", null, "Sign in to manage all shared resources") }));

    if (!info.enabled) {
      card.appendChild(el("p", { class: "msg-err", text: t("admin.disabled", null, "Admin is not enabled (SESSION_SECRET is not configured).") }));
      app.appendChild(card);
      return;
    }

    var hasOwnerKey = methods.indexOf("owner-key") >= 0;
    var hasCF = methods.indexOf("cf-access") >= 0;

    var tabs = el("div", { class: "login-tabs" });
    var panels = el("div", {});
    var errBox = el("div", { class: "msg-err" });

    function addTab(key, label, panel) {
      var tab = el("button", { type: "button", class: "login-tab", "data-key": key, text: label });
      tab.addEventListener("click", function () {
        [].forEach.call(tabs.children, function (tEl) { tEl.setAttribute("aria-selected", tEl === tab ? "true" : "false"); });
        [].forEach.call(panels.children, function (pEl) { pEl.className = "login-panel" + (pEl === panel ? " active" : ""); });
      });
      tabs.appendChild(tab);
      panels.appendChild(panel);
      return tab;
    }

    var firstTab = null;

    if (hasOwnerKey) {
      var keyInput = el("input", {
        class: "text",
        type: "password",
        placeholder: t("admin.ownerKeyPlaceholder", null, "Owner key"),
        autocomplete: "current-password"
      });
      var submit = el("button", { type: "button", class: "btn btn-primary", text: t("admin.login", null, "Sign in") });
      function doLogin() {
        errBox.textContent = "";
        submit.disabled = true;
        api.loginOwnerKey(keyInput.value).then(function () {
          init();
        }).catch(function (e) {
          errBox.textContent = (e && e.message) || t("admin.loginFailed", null, "Sign in failed");
          submit.disabled = false;
        });
      }
      submit.addEventListener("click", doLogin);
      keyInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
      var panel = el("div", { class: "login-panel" }, [
        el("label", { class: "field", text: t("admin.ownerKeyTab", null, "Owner Key") }),
        keyInput,
        el("div", { style: "margin-top:0.75rem;" }, [submit])
      ]);
      firstTab = addTab("owner-key", t("admin.ownerKeyTab", null, "Owner Key"), panel) || firstTab;
    }

    if (hasCF) {
      var panelCF = el("div", { class: "login-panel" }, [
        el("p", { class: "admin-muted", text: t("admin.cfHint", null, "This deployment is protected by Cloudflare Access. Sign in via Cloudflare and refresh to continue.") }),
        el("button", { type: "button", class: "btn", text: t("common.refresh", null, "Refresh"), onclick: function () { init(); } })
      ]);
      var tTab = addTab("cf-access", t("admin.cfTab", null, "Cloudflare Access"), panelCF);
      if (!firstTab) firstTab = tTab;
    }

    if (!hasOwnerKey && !hasCF) {
      card.appendChild(el("p", { class: "msg-err", text: t("admin.noAuthMethods", null, "No sign-in methods available (neither OWNER_KEY nor Cloudflare Access is configured).") }));
      app.appendChild(card);
      return;
    }

    card.appendChild(tabs);
    card.appendChild(panels);
    card.appendChild(errBox);
    app.appendChild(card);

    // Activate the first tab.
    if (firstTab) firstTab.click();
  }

  // --- dashboard ---
  function renderDashboard(info, skipFetch) {
    clear(app);
    var wrap = el("div", { class: "admin-wrap" });

    var logoutBtn = el("button", { type: "button", class: "btn btn-sm", text: t("admin.logout", null, "Sign out") });
    logoutBtn.addEventListener("click", function () {
      api.logout().then(init).catch(init);
    });
    var headerRight = el("div", { style: "display:flex;align-items:center;gap:0.5rem;" }, [
      langSwitcher(),
      logoutBtn
    ]);
    var header = el("div", { class: "admin-header" }, [
      el("div", {}, [
        el("h1", { text: t("admin.title", null, "Owner Dashboard") }),
        el("div", { class: "admin-muted", text: t("admin.signedInAs", { method: info.method || "" }, "Signed in · " + (info.method || "")) })
      ]),
      headerRight
    ]);
    wrap.appendChild(header);

    // Toolbar: status + kind filters.
    function sel(labelText, key, options) {
      var s = el("select", { class: "text" });
      options.forEach(function (o) {
        s.appendChild(el("option", { value: o[0], text: o[1] }));
      });
      s.value = state[key];
      s.addEventListener("change", function () { state[key] = s.value; state.offset = 0; loadTable(); });
      return el("label", { class: "admin-muted", style: "display:flex;gap:0.35rem;align-items:center;" }, [labelText, s]);
    }
    var toolbar = el("div", { class: "toolbar" }, [
      sel(t("admin.filterStatus", null, "Status"), "status", [
        ["all", t("admin.all", null, "All")],
        ["active", t("admin.active", null, "Active")],
        ["expired", t("admin.expired", null, "Expired")]
      ]),
      sel(t("admin.filterKind", null, "Type"), "kind", [
        ["all", t("admin.all", null, "All")],
        ["diff", "diff"],
        ["files", "files"]
      ]),
      el("button", { type: "button", class: "btn btn-sm", text: t("common.refresh", null, "Refresh"), onclick: function () { loadTable(); } })
    ]);
    wrap.appendChild(toolbar);

    tableHost = el("div", {});
    wrap.appendChild(tableHost);
    app.appendChild(wrap);

    if (skipFetch && state.lastItems) {
      renderTable(tableHost, state.lastItems);
    } else {
      loadTable();
    }
  }

  function sortHeader(label, key) {
    var arrow = state.sort === key ? (state.order === "asc" ? " ▲" : " ▼") : "";
    var th = el("th", { text: label + arrow });
    th.addEventListener("click", function () {
      if (state.sort === key) {
        state.order = state.order === "asc" ? "desc" : "asc";
      } else {
        state.sort = key;
        state.order = "desc";
      }
      state.offset = 0;
      loadTable();
    });
    return th;
  }

  function loadTable() {
    var host = tableHost;
    if (!host) return;
    clear(host);
    host.appendChild(el("div", { class: "empty", text: t("common.loading", null, "Loading…") }));

    api.list({
      limit: state.limit,
      offset: state.offset,
      sort: state.sort,
      order: state.order,
      status: state.status,
      kind: state.kind
    }).then(function (data) {
      state.total = data.total;
      state.lastItems = data.items;
      renderTable(host, data.items);
    }).catch(function (e) {
      if (e.status === 401) { init(); return; }
      clear(host);
      host.appendChild(el("div", { class: "empty" }, [
        el("span", { class: "msg-err", text: (e && e.message) || t("admin.loadFailed", null, "Failed to load") })
      ]));
    });
  }

  function renderTable(host, items) {
    clear(host);
    var scroll = el("div", { class: "table-scroll" });
    var table = el("table", { class: "shares" });
    var thead = el("thead", {}, [el("tr", {}, [
      sortHeader(t("admin.colId", null, "ID"), "created_at"),
      el("th", { text: t("admin.colKind", null, "Type") }),
      sortHeader(t("admin.colCreated", null, "Created"), "created_at"),
      sortHeader(t("admin.colExpires", null, "Expires"), "expired_at"),
      el("th", { text: t("admin.colStatus", null, "Status") }),
      el("th", { text: t("admin.colStorage", null, "Storage") }),
      el("th", { text: t("admin.colSize", null, "Size") }),
      el("th", { text: t("admin.colActions", null, "Actions") })
    ])]);
    table.appendChild(thead);

    var tbody = el("tbody", {});
    if (!items.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "8" }, [el("div", { class: "empty", text: t("admin.empty", null, "No shares found") })])]));
    }
    items.forEach(function (it) { tbody.appendChild(renderRow(it)); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    host.appendChild(scroll);

    // Pager.
    var start = state.total === 0 ? 0 : state.offset + 1;
    var end = Math.min(state.offset + state.limit, state.total);
    var prev = el("button", { type: "button", class: "btn btn-sm", text: t("admin.prevPage", null, "Previous") });
    var next = el("button", { type: "button", class: "btn btn-sm", text: t("admin.nextPage", null, "Next") });
    prev.disabled = state.offset <= 0;
    next.disabled = end >= state.total;
    prev.addEventListener("click", function () { state.offset = Math.max(0, state.offset - state.limit); loadTable(); });
    next.addEventListener("click", function () { state.offset = state.offset + state.limit; loadTable(); });
    host.appendChild(el("div", { class: "pager" }, [
      el("span", { text: t("admin.pager", { start: start, end: end, total: state.total }, start + "–" + end + " of " + state.total) }),
      el("div", { class: "row-actions" }, [prev, next])
    ]));
  }

  function statusPill(it) {
    if (it.never_expires) return el("span", { class: "pill pill-forever", text: t("admin.statusForever", null, "Keep forever 🔒") });
    if (it.status === "expired") return el("span", { class: "pill pill-expired", text: t("admin.statusExpired", null, "Expired") });
    return el("span", { class: "pill pill-active", text: t("admin.statusActive", null, "Active") });
  }

  function renderRow(it) {
    var previewPath = (it.kind === "diff" ? "/p/" : "/f/") + encodeURIComponent(it.id);
    var idLink = el("a", { href: previewPath, target: "_blank", rel: "noopener", text: it.id });

    var keepBtn = el("button", {
      type: "button",
      class: "btn btn-sm",
      text: it.never_expires
        ? t("admin.actionUnkeep", null, "Enable expiry")
        : t("admin.actionKeep", null, "Keep forever")
    });
    keepBtn.addEventListener("click", function () {
      keepBtn.disabled = true;
      api.keepForever(it.kind, it.id, !it.never_expires).then(function () {
        loadTable();
      }).catch(function (e) { keepBtn.disabled = false; alertError(e); });
    });

    var revokeBtn = el("button", { type: "button", class: "btn btn-sm", text: t("admin.actionRevoke", null, "Revoke") });
    revokeBtn.addEventListener("click", function () {
      confirmModal(
        t("admin.revokeTitle", null, "Revoke share"),
        t("admin.revokeMsg", null, "This immediately makes the share inaccessible and schedules it for permanent deletion on the next cleanup sweep."),
        t("admin.actionRevoke", null, "Revoke"),
        "btn-danger",
        function () {
          api.revoke(it.kind, it.id).then(loadTable).catch(alertError);
        }
      );
    });

    var reshareBtn = el("button", { type: "button", class: "btn btn-sm", text: t("admin.actionReshare", null, "Reshare") });
    reshareBtn.addEventListener("click", function () {
      reshareBtn.disabled = true;
      api.reshare(it.kind, it.id, {}).then(function (data) {
        reshareBtn.disabled = false;
        showReshareResult(data);
        loadTable();
      }).catch(function (e) { reshareBtn.disabled = false; alertError(e); });
    });

    var resetBtn = el("button", { type: "button", class: "btn btn-sm", text: t("admin.actionReset", null, "Reset key") });
    resetBtn.addEventListener("click", function () { openResetModal(it); });

    var delBtn = el("button", { type: "button", class: "btn btn-sm btn-danger", text: t("admin.actionDelete", null, "Delete") });
    delBtn.addEventListener("click", function () {
      confirmModal(
        t("admin.deleteTitle", null, "Delete permanently"),
        t("admin.deleteMsg", null, "This immediately deletes the record and its encrypted payload. This cannot be undone."),
        t("admin.actionDelete", null, "Delete"),
        "btn-danger",
        function () {
          api.remove(it.kind, it.id).then(loadTable).catch(alertError);
        }
      );
    });

    return el("tr", {}, [
      el("td", {}, [idLink]),
      el("td", { text: it.kind }),
      el("td", { text: fmtDate(it.created_at) }),
      el("td", { text: it.never_expires ? "—" : fmtDate(it.expired_at) }),
      el("td", {}, [statusPill(it)]),
      el("td", { text: it.storage }),
      el("td", { text: fmtSize(it.byte_size) }),
      el("td", {}, [el("div", { class: "row-actions" }, [keepBtn, reshareBtn, resetBtn, revokeBtn, delBtn])])
    ]);
  }

  function showReshareResult(data) {
    var copyBtn = el("button", { type: "button", class: "btn", text: t("admin.copyManageUrl", null, "Copy manage link") });
    copyBtn.addEventListener("click", function () {
      try {
        navigator.clipboard.writeText(data.manage_url).then(function () {
          copyBtn.textContent = t("common.copied", null, "Copied");
        });
      } catch (e) { /* clipboard unavailable */ }
    });
    modal({
      title: t("admin.reshareTitle", null, "New share link created"),
      bodyNodes: [
        el("p", { text: t("admin.reshareMsg", null, "The original link is unaffected. The passphrase is unchanged — recipients can open the new link with the same passphrase.") }),
        el("code", { text: data.preview_url }),
        el("div", { class: "row-actions" }, [
          el("a", { class: "btn", href: data.preview_url, target: "_blank", rel: "noopener", text: t("common.open", null, "Open") }),
          copyBtn
        ])
      ],
      actions: [{ label: t("common.close", null, "Close"), cls: "", onClick: function (close) { close(); } }]
    });
  }

  // resolvePrivateKey accepts either a raw base64 PKCS8 key, or the protected
  // JSON file { "enc": { ciphertext, iv, salt } } plus its passphrase.
  function resolvePrivateKey(text, keyPass) {
    text = (text || "").trim();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* not JSON: treat as raw */ }
    if (parsed && parsed.enc && parsed.enc.ciphertext) {
      if (!keyPass) {
        return Promise.reject(new Error(t("admin.resetKeyPassRequired", null, "This private key file is encrypted — please enter its protecting passphrase.")));
      }
      return window.AgentGateCrypto.decrypt(parsed.enc.ciphertext, parsed.enc.iv, parsed.enc.salt, keyPass);
    }
    return Promise.resolve(text);
  }

  function showResetResult(data, newPass) {
    var passCode = el("code", { text: newPass });
    var copyLink = el("button", { type: "button", class: "btn", text: t("admin.copyLink", null, "Copy link") });
    copyLink.addEventListener("click", function () {
      try { navigator.clipboard.writeText(data.preview_url); copyLink.textContent = t("common.copied", null, "Copied"); } catch (e) {}
    });
    var copyPass = el("button", { type: "button", class: "btn", text: t("admin.copyPassphrase", null, "Copy passphrase") });
    copyPass.addEventListener("click", function () {
      try { navigator.clipboard.writeText(newPass); copyPass.textContent = t("common.copied", null, "Copied"); } catch (e) {}
    });
    modal({
      title: t("admin.resetResultTitle", null, "Reset & reshared"),
      bodyNodes: [
        el("p", { text: t("admin.resetResultMsg", null, "The old link and old passphrase are now invalid. Deliver the new link and new passphrase separately via a secure channel.") }),
        el("div", { class: "admin-muted", text: t("admin.newLink", null, "New link") }),
        el("code", { text: data.preview_url }),
        el("div", { class: "admin-muted", style: "margin-top:0.5rem;", text: t("admin.newPassphrase", null, "New passphrase (shown only once)") }),
        passCode,
        el("div", { class: "row-actions", style: "margin-top:0.75rem;" }, [
          el("a", { class: "btn", href: data.preview_url, target: "_blank", rel: "noopener", text: t("common.open", null, "Open") }),
          copyLink, copyPass
        ])
      ],
      actions: [{ label: t("common.close", null, "Close"), cls: "", onClick: function (close) { close(); } }]
    });
  }

  function openResetModal(it) {
    var keyInput = el("textarea", {
      class: "text",
      rows: "4",
      placeholder: t("admin.resetKeyPlaceholder", null, "Paste recovery private key (base64 from recovery-keygen, or encrypted JSON file contents)"),
      style: "width:100%;box-sizing:border-box;font-family:monospace;"
    });
    var passInput = el("input", {
      class: "text",
      type: "password",
      placeholder: t("admin.resetKeyPassPlaceholder", null, "Passphrase protecting the private key (leave blank if unencrypted)"),
      style: "width:100%;box-sizing:border-box;margin-top:0.5rem;"
    });
    var errBox = el("div", { class: "msg-err" });
    var close = modal({
      title: t("admin.resetModalTitle", null, "Reset & Reshare (rotate passphrase)"),
      bodyNodes: [
        el("p", { class: "admin-muted", text: t("admin.resetModalHint", null, "Unwrap the content key locally with your offline recovery private key, assign a brand-new passphrase and link, and revoke the old link. Your private key never leaves the browser.") }),
        keyInput, passInput, errBox
      ],
      actions: [
        { label: t("common.cancel", null, "Cancel"), cls: "", onClick: function (c) { c(); } },
        { label: t("admin.resetBtn", null, "Reset"), cls: "btn-primary", onClick: function (c) {
          errBox.textContent = "";
          api.recoveryDek(it.kind, it.id)
            .then(function (data) {
              return resolvePrivateKey(keyInput.value, passInput.value)
                .then(function (privB64) { return window.AgentGateCrypto.recoverDek(privB64, data.wrap_recov); });
            })
            .then(function (dek) {
              var newPass = window.AgentGateCrypto.randomPassphrase();
              return window.AgentGateCrypto.rewrapUnderPassphrase(dek, newPass)
                .then(function (wrap) {
                  return api.resetReshare(it.kind, it.id, { salt: wrap.salt, iv_p: wrap.iv_p, wrap_pass: wrap.wrap_pass });
                })
                .then(function (res) { c(); showResetResult(res, newPass); loadTable(); });
            })
            .catch(function (e) {
              if (e && e.status === 409) {
                errBox.textContent = t("admin.resetNotCapable", null, "This share has no recovery key (uploaded before recovery was enabled) and cannot be reset. Use Revoke or Delete instead.");
              } else {
                errBox.textContent = (e && e.message) || t("admin.resetFailed", null, "Reset failed (is the private key correct?)");
              }
            });
        } }
      ]
    });
    return close;
  }

  function alertError(e) {
    modal({
      title: t("admin.opFailed", null, "Action failed"),
      bodyNodes: [el("p", { text: (e && e.message) || t("admin.genericError", null, "An error occurred") })],
      actions: [{ label: t("common.close", null, "Close"), cls: "", onClick: function (close) { close(); } }]
    });
  }

  function applyTitle() {
    document.title = t("admin.pageTitle", null, "Owner Dashboard - AgentGate");
  }

  // --- entry ---
  function init() {
    applyTitle();
    clear(app);
    app.appendChild(el("div", { class: "empty", text: t("common.loading", null, "Loading…") }));
    api.status().then(function (info) {
      state.lastSession = info;
      if (info.authenticated) renderDashboard(info);
      else renderLogin(info);
    }).catch(function (e) {
      clear(app);
      app.appendChild(el("div", { class: "empty" }, [
        el("span", { class: "msg-err", text: (e && e.message) || t("admin.connectFailed", null, "Unable to connect") })
      ]));
    });
  }

  if (window.AgentGateI18n && window.AgentGateI18n.onChange) {
    window.AgentGateI18n.onChange(function () {
      applyTitle();
      if (!state.lastSession) return;
      if (state.lastSession.authenticated) renderDashboard(state.lastSession, true);
      else renderLogin(state.lastSession);
    });
  }

  init();
  window.AgentGateAdmin = { reload: init };
})();
