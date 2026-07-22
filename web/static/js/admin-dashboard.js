// Owner (instance-admin) dashboard controller. Probes /api/admin/session, then
// renders either the login card (owner key + Cloudflare Access, driven by the
// server's enabled-methods flag) or the shares table with per-row actions.
// Vanilla ES5 IIFE, matching the other viewers; styling via style.css tokens
// and the scoped block in admin.html.
(function () {
  "use strict";

  var api = window.AgentGateAdminApi;
  var app = document.getElementById("app");

  var state = {
    limit: 50,
    offset: 0,
    sort: "created_at",
    order: "desc",
    status: "all",
    kind: "all",
    total: 0
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
        { label: "取消", cls: "", onClick: function (close) { close(); } },
        { label: confirmLabel, cls: cls, onClick: function (close) { close(); onConfirm(); } }
      ]
    });
  }

  // --- login ---
  function renderLogin(info) {
    clear(app);
    var methods = info.methods || [];
    var card = el("div", { class: "login-card" });
    card.appendChild(el("h1", { text: "Owner Dashboard" }));
    card.appendChild(el("div", { class: "admin-muted", text: "登入以管理所有分享資源" }));

    if (!info.enabled) {
      card.appendChild(el("p", { class: "msg-err", text: "Admin 尚未啟用（未設定 SESSION_SECRET）。" }));
      app.appendChild(card);
      return;
    }

    var hasOwnerKey = methods.indexOf("owner-key") >= 0;
    var hasCF = methods.indexOf("cf-access") >= 0;

    var tabs = el("div", { class: "login-tabs" });
    var panels = el("div", {});
    var errBox = el("div", { class: "msg-err" });

    function addTab(key, label, panel) {
      var tab = el("button", { class: "login-tab", "data-key": key, text: label });
      tab.addEventListener("click", function () {
        [].forEach.call(tabs.children, function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
        [].forEach.call(panels.children, function (p) { p.className = "login-panel" + (p === panel ? " active" : ""); });
      });
      tabs.appendChild(tab);
      panels.appendChild(panel);
      return tab;
    }

    var firstTab = null;

    if (hasOwnerKey) {
      var keyInput = el("input", { class: "text", type: "password", placeholder: "Owner key", autocomplete: "current-password" });
      var submit = el("button", { class: "btn btn-primary", text: "登入" });
      function doLogin() {
        errBox.textContent = "";
        submit.disabled = true;
        api.loginOwnerKey(keyInput.value).then(function () {
          init();
        }).catch(function (e) {
          errBox.textContent = e.message || "登入失敗";
          submit.disabled = false;
        });
      }
      submit.addEventListener("click", doLogin);
      keyInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
      var panel = el("div", { class: "login-panel" }, [
        el("label", { class: "field", text: "Owner Key" }),
        keyInput,
        el("div", { style: "margin-top:0.75rem;" }, [submit])
      ]);
      firstTab = addTab("owner-key", "Owner Key", panel) || firstTab;
    }

    if (hasCF) {
      var panelCF = el("div", { class: "login-panel" }, [
        el("p", { class: "admin-muted", text: "此部署由 Cloudflare Access 保護。透過 Cloudflare 登入後重新整理即可進入。" }),
        el("button", { class: "btn", text: "重新整理", onclick: function () { init(); } })
      ]);
      var t = addTab("cf-access", "Cloudflare Access", panelCF);
      if (!firstTab) firstTab = t;
    }

    if (!hasOwnerKey && !hasCF) {
      card.appendChild(el("p", { class: "msg-err", text: "沒有可用的登入方式（未設定 OWNER_KEY 或 Cloudflare Access）。" }));
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
  function renderDashboard(info) {
    clear(app);
    var wrap = el("div", { class: "admin-wrap" });

    var logoutBtn = el("button", { class: "btn btn-sm", text: "登出" });
    logoutBtn.addEventListener("click", function () {
      api.logout().then(init).catch(init);
    });
    var header = el("div", { class: "admin-header" }, [
      el("div", {}, [
        el("h1", { text: "Owner Dashboard" }),
        el("div", { class: "admin-muted", text: "已登入 · " + (info.method || "") })
      ]),
      logoutBtn
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
      sel("狀態", "status", [["all", "全部"], ["active", "有效"], ["expired", "已過期"]]),
      sel("類型", "kind", [["all", "全部"], ["diff", "diff"], ["files", "files"]]),
      el("button", { class: "btn btn-sm", text: "重新整理", onclick: function () { loadTable(); } })
    ]);
    wrap.appendChild(toolbar);

    tableHost = el("div", {});
    wrap.appendChild(tableHost);
    app.appendChild(wrap);

    loadTable();
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
    host.appendChild(el("div", { class: "empty", text: "載入中…" }));

    api.list({
      limit: state.limit,
      offset: state.offset,
      sort: state.sort,
      order: state.order,
      status: state.status,
      kind: state.kind
    }).then(function (data) {
      state.total = data.total;
      renderTable(host, data.items);
    }).catch(function (e) {
      if (e.status === 401) { init(); return; }
      clear(host);
      host.appendChild(el("div", { class: "empty", html: '<span class="msg-err">' + (e.message || "載入失敗") + "</span>" }));
    });
  }

  function renderTable(host, items) {
    clear(host);
    var scroll = el("div", { class: "table-scroll" });
    var table = el("table", { class: "shares" });
    var thead = el("thead", {}, [el("tr", {}, [
      sortHeader("ID", "created_at"),
      el("th", { text: "類型" }),
      sortHeader("建立", "created_at"),
      sortHeader("到期", "expired_at"),
      el("th", { text: "狀態" }),
      el("th", { text: "儲存" }),
      el("th", { text: "大小" }),
      el("th", { text: "操作" })
    ])]);
    table.appendChild(thead);

    var tbody = el("tbody", {});
    if (!items.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "8" }, [el("div", { class: "empty", text: "沒有資源" })])]));
    }
    items.forEach(function (it) { tbody.appendChild(renderRow(it)); });
    table.appendChild(tbody);
    scroll.appendChild(table);
    host.appendChild(scroll);

    // Pager.
    var start = state.total === 0 ? 0 : state.offset + 1;
    var end = Math.min(state.offset + state.limit, state.total);
    var prev = el("button", { class: "btn btn-sm", text: "上一頁" });
    var next = el("button", { class: "btn btn-sm", text: "下一頁" });
    prev.disabled = state.offset <= 0;
    next.disabled = end >= state.total;
    prev.addEventListener("click", function () { state.offset = Math.max(0, state.offset - state.limit); loadTable(); });
    next.addEventListener("click", function () { state.offset = state.offset + state.limit; loadTable(); });
    host.appendChild(el("div", { class: "pager" }, [
      el("span", { text: start + "–" + end + " / 共 " + state.total }),
      el("div", { class: "row-actions" }, [prev, next])
    ]));
  }

  function statusPill(it) {
    if (it.never_expires) return el("span", { class: "pill pill-forever", text: "永久保留 🔒" });
    if (it.status === "expired") return el("span", { class: "pill pill-expired", text: "已過期" });
    return el("span", { class: "pill pill-active", text: "有效" });
  }

  function renderRow(it) {
    var previewPath = (it.kind === "diff" ? "/p/" : "/f/") + encodeURIComponent(it.id);
    var idLink = el("a", { href: previewPath, target: "_blank", rel: "noopener", text: it.id });

    var keepBtn = el("button", {
      class: "btn btn-sm",
      text: it.never_expires ? "取消永久" : "永久保留"
    });
    keepBtn.addEventListener("click", function () {
      keepBtn.disabled = true;
      api.keepForever(it.kind, it.id, !it.never_expires).then(function () {
        loadTable();
      }).catch(function (e) { keepBtn.disabled = false; alertError(e); });
    });

    var revokeBtn = el("button", { class: "btn btn-sm", text: "Revoke" });
    revokeBtn.addEventListener("click", function () {
      confirmModal("Revoke 分享", "此動作會立即讓此分享無法存取，並會在下次清理時永久刪除。", "Revoke", "btn-danger", function () {
        api.revoke(it.kind, it.id).then(loadTable).catch(alertError);
      });
    });

    var reshareBtn = el("button", { class: "btn btn-sm", text: "重新分享" });
    reshareBtn.addEventListener("click", function () {
      reshareBtn.disabled = true;
      api.reshare(it.kind, it.id, {}).then(function (data) {
        reshareBtn.disabled = false;
        showReshareResult(data);
        loadTable();
      }).catch(function (e) { reshareBtn.disabled = false; alertError(e); });
    });

    var resetBtn = el("button", { class: "btn btn-sm", text: "Reset 換金鑰" });
    resetBtn.addEventListener("click", function () { openResetModal(it); });

    var delBtn = el("button", { class: "btn btn-sm btn-danger", text: "刪除" });
    delBtn.addEventListener("click", function () {
      confirmModal("永久刪除", "會立即刪除此紀錄與其加密內容，無法復原。", "刪除", "btn-danger", function () {
        api.remove(it.kind, it.id).then(loadTable).catch(alertError);
      });
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
    var copyBtn = el("button", { class: "btn", text: "複製管理連結" });
    copyBtn.addEventListener("click", function () {
      try {
        navigator.clipboard.writeText(data.manage_url).then(function () {
          copyBtn.textContent = "已複製";
        });
      } catch (e) { /* clipboard unavailable */ }
    });
    modal({
      title: "已產生新的存取連結",
      bodyNodes: [
        el("p", { text: "舊連結不受影響。passphrase 不變，收件者用新連結 + 同一組 passphrase 即可開啟。" }),
        el("code", { text: data.preview_url }),
        el("div", { class: "row-actions" }, [
          el("a", { class: "btn", href: data.preview_url, target: "_blank", rel: "noopener", text: "開啟" }),
          copyBtn
        ])
      ],
      actions: [{ label: "關閉", cls: "", onClick: function (close) { close(); } }]
    });
  }

  // resolvePrivateKey accepts either a raw base64 PKCS8 key, or the protected
  // JSON file { "enc": { ciphertext, iv, salt } } plus its passphrase.
  function resolvePrivateKey(text, keyPass) {
    text = (text || "").trim();
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* not JSON: treat as raw */ }
    if (parsed && parsed.enc && parsed.enc.ciphertext) {
      if (!keyPass) return Promise.reject(new Error("此私鑰檔已加密，請輸入保護用 passphrase"));
      return window.AgentGateCrypto.decrypt(parsed.enc.ciphertext, parsed.enc.iv, parsed.enc.salt, keyPass);
    }
    return Promise.resolve(text);
  }

  function showResetResult(data, newPass) {
    var passCode = el("code", { text: newPass });
    var copyLink = el("button", { class: "btn", text: "複製連結" });
    copyLink.addEventListener("click", function () {
      try { navigator.clipboard.writeText(data.preview_url); copyLink.textContent = "已複製"; } catch (e) {}
    });
    var copyPass = el("button", { class: "btn", text: "複製 passphrase" });
    copyPass.addEventListener("click", function () {
      try { navigator.clipboard.writeText(newPass); copyPass.textContent = "已複製"; } catch (e) {}
    });
    modal({
      title: "已重設並重新分享",
      bodyNodes: [
        el("p", { text: "舊連結已作廢、舊 passphrase 失效。請把下列新連結與新 passphrase 分開、透過安全管道交給收件者。" }),
        el("div", { class: "admin-muted", text: "新連結" }),
        el("code", { text: data.preview_url }),
        el("div", { class: "admin-muted", style: "margin-top:0.5rem;", text: "新 passphrase（只顯示這一次）" }),
        passCode,
        el("div", { class: "row-actions", style: "margin-top:0.75rem;" }, [
          el("a", { class: "btn", href: data.preview_url, target: "_blank", rel: "noopener", text: "開啟" }),
          copyLink, copyPass
        ])
      ],
      actions: [{ label: "關閉", cls: "", onClick: function (close) { close(); } }]
    });
  }

  function openResetModal(it) {
    var keyInput = el("textarea", { class: "text", rows: "4", placeholder: "貼上復原私鑰（recovery-keygen 產生的私鑰；未加密為 base64，或加密後的 JSON 檔內容）", style: "width:100%;box-sizing:border-box;font-family:monospace;" });
    var passInput = el("input", { class: "text", type: "password", placeholder: "若私鑰有加密保護，輸入其 passphrase（否則留空）", style: "width:100%;box-sizing:border-box;margin-top:0.5rem;" });
    var errBox = el("div", { class: "msg-err" });
    var close = modal({
      title: "Reset & 重新分享（換 passphrase）",
      bodyNodes: [
        el("p", { class: "admin-muted", text: "用離線復原私鑰在本機還原內容金鑰，換上全新 passphrase 產生新連結，並作廢舊連結。私鑰只在瀏覽器使用，不會上傳。" }),
        keyInput, passInput, errBox
      ],
      actions: [
        { label: "取消", cls: "", onClick: function (c) { c(); } },
        { label: "Reset", cls: "btn-primary", onClick: function (c) {
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
                errBox.textContent = "此分享沒有復原金鑰（在啟用復原前上傳），無法 Reset。可改用 Revoke 或刪除。";
              } else {
                errBox.textContent = (e && e.message) || "Reset 失敗（私鑰是否正確？）";
              }
            });
        } }
      ]
    });
    return close;
  }

  function alertError(e) {
    modal({
      title: "操作失敗",
      bodyNodes: [el("p", { text: (e && e.message) || "發生錯誤" })],
      actions: [{ label: "關閉", cls: "", onClick: function (close) { close(); } }]
    });
  }

  // --- entry ---
  function init() {
    clear(app);
    app.appendChild(el("div", { class: "empty", text: "載入中…" }));
    api.status().then(function (info) {
      if (info.authenticated) renderDashboard(info);
      else renderLogin(info);
    }).catch(function (e) {
      clear(app);
      app.appendChild(el("div", { class: "empty", html: '<span class="msg-err">' + (e.message || "無法連線") + "</span>" }));
    });
  }

  init();
  window.AgentGateAdmin = { reload: init };
})();
