(function () {
  "use strict";

  function getShareId() {
    return window.AgentGateShare ? window.AgentGateShare.getShareId() : "unknown";
  }

  function fileMap(files) {
    var map = {};
    (files || []).forEach(function (f) {
      map[f.title || ""] = f.content || "";
    });
    return map;
  }

  function pickEntry(data) {
    if (data.plan_mdx) return { title: data.title || "plan.mdx", content: data.plan_mdx };
    var files = data.files || [];
    var map = fileMap(files);
    if (data.entry && map[data.entry] != null) return { title: data.entry, content: map[data.entry] };
    var preferred = ["plan.mdx", "plan.md", "README.mdx", "README.md"];
    for (var i = 0; i < preferred.length; i++) {
      if (map[preferred[i]] != null) return { title: preferred[i], content: map[preferred[i]] };
    }
    for (var j = 0; j < files.length; j++) {
      var name = files[j].title || "";
      if (/\.(mdx?|markdown)$/i.test(name)) return files[j];
    }
    return files[0] || { title: "plan", content: "" };
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function renderMarkdown(markdown) {
    if (window.AgentGateMarkdown) return window.AgentGateMarkdown.renderMarkdown(markdown || "");
    if (typeof marked !== "undefined") return marked.parse(markdown || "");
    return "<pre>" + escapeHtml(markdown || "") + "</pre>";
  }

  function attachCodeHighlight(container) {
    if (!container || typeof hljs === "undefined") return;
    var blocks = container.querySelectorAll("pre code");
    for (var i = 0; i < blocks.length; i++) hljs.highlightElement(blocks[i]);
  }

  function renderMermaid(container) {
    if (!container || typeof mermaid === "undefined") return;
    try {
      mermaid.initialize({ startOnLoad: false, theme: window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
      var nodes = container.querySelectorAll(".mermaid");
      if (nodes.length) return mermaid.run({ nodes: nodes });
    } catch (e) {
      console.warn("Mermaid render failed", e);
    }
  }

  function wireframeSrcdoc(html) {
    var css = "<style>" +
      "html,body{margin:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      "body{padding:16px;box-sizing:border-box;}" +
      "button,.btn{border:1px solid #c8d0d9;border-radius:8px;background:#f6f8fa;padding:7px 12px;font:inherit;}" +
      "button.primary,.primary{background:#0969da;color:#fff;border-color:#0969da;}" +
      ".wf-card,.card{border:1px solid #d8dee4;border-radius:12px;background:#fff;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);}" +
      ".wf-box,.box{border:1px dashed #aeb8c2;border-radius:10px;background:#f6f8fa;min-height:44px;padding:12px;display:flex;align-items:center;justify-content:center;color:#57606a;text-align:center;}" +
      ".muted{color:#57606a}.row{display:flex;gap:12px;align-items:center}.col{display:flex;flex-direction:column;gap:12px}" +
      "*{box-sizing:border-box}" +
      "</style>";
    return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" + css + "</head><body>" + html + "</body></html>";
  }

  function renderWireframes(container) {
    if (!container) return;
    var nodes = container.querySelectorAll(".plan-wireframe-source");
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        var raw = node.getAttribute("data-wireframe") || "";
        var html = "";
        try { html = decodeURIComponent(raw); } catch (e) { html = raw; }

        var shell = document.createElement("div");
        shell.className = "plan-wireframe";
        var toolbar = document.createElement("div");
        toolbar.className = "plan-wireframe-toolbar";
        toolbar.innerHTML = '<span>Wireframe</span><button type="button" class="btn">Open preview</button>';
        var frame = document.createElement("iframe");
        frame.className = "plan-wireframe-frame";
        frame.setAttribute("sandbox", "");
        frame.setAttribute("srcdoc", wireframeSrcdoc(html));
        toolbar.querySelector("button").addEventListener("click", function () {
          var doc = wireframeSrcdoc(html);
          try {
            var blob = new Blob([doc], { type: "text/html" });
            var url = URL.createObjectURL(blob);
            var opened = window.open(url, "_blank");
            if (opened) {
              setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
              return;
            }
            URL.revokeObjectURL(url);
          } catch (e) {}
          var win = window.open("", "_blank");
          if (!win) return;
          win.document.open();
          win.document.write(doc);
          win.document.close();
        });
        shell.appendChild(toolbar);
        shell.appendChild(frame);
        node.replaceWith(shell);
      })(nodes[i]);
    }
  }

  function createFileTree(files, active, onSelect) {
    var wrap = document.createElement("aside");
    wrap.className = "plan-sidebar";
    var title = document.createElement("h2");
    title.textContent = "Files";
    wrap.appendChild(title);
    var list = document.createElement("ul");
    list.className = "plan-file-tree";
    (files || []).forEach(function (f) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = f.title || "untitled";
      if ((f.title || "") === active) btn.className = "active";
      btn.addEventListener("click", function () { onSelect(f); });
      li.appendChild(btn);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function feedbackKey() {
    return "agentgate-plan-feedback-" + getShareId();
  }

  function loadFeedback() {
    try { return JSON.parse(localStorage.getItem(feedbackKey()) || "[]"); } catch (e) { return []; }
  }

  function saveFeedback(items) {
    try { localStorage.setItem(feedbackKey(), JSON.stringify(items)); } catch (e) {}
  }

  function createFeedbackPanel(titleText) {
    var aside = document.createElement("aside");
    aside.className = "plan-feedback collapsed";

    var header = document.createElement("button");
    header.type = "button";
    header.className = "plan-feedback-toggle";
    header.innerHTML = '<span>Chat / Feedback</span><span class="plan-feedback-chevron">▲</span>';
    header.addEventListener("click", function () {
      aside.classList.toggle("collapsed");
    });
    aside.appendChild(header);

    var content = document.createElement("div");
    content.className = "plan-feedback-content";
    content.innerHTML = '<p class="plan-feedback-hint">Local-only notes for now. Copy them back to your agent after review.</p>';

    var list = document.createElement("div");
    list.className = "plan-feedback-list";
    var items = loadFeedback();

    function redraw() {
      list.innerHTML = "";
      items.forEach(function (item, idx) {
        var div = document.createElement("div");
        div.className = "plan-feedback-item";
        div.innerHTML = '<div class="plan-feedback-meta">#' + (idx + 1) + ' · ' + escapeHtml(item.created_at) + '</div><div></div>';
        div.lastChild.textContent = item.text;
        list.appendChild(div);
      });
    }

    var ta = document.createElement("textarea");
    ta.className = "form-input plan-feedback-input";
    ta.placeholder = "Leave feedback, questions, or change requests...";
    ta.rows = 5;

    var actions = document.createElement("div");
    actions.className = "plan-feedback-actions";
    var add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-primary";
    add.textContent = "Add";
    add.addEventListener("click", function () {
      var text = (ta.value || "").trim();
      if (!text) return;
      items.push({ text: text, created_at: new Date().toLocaleString() });
      saveFeedback(items);
      ta.value = "";
      redraw();
    });

    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn";
    copy.textContent = "Copy for agent";
    copy.addEventListener("click", function () {
      var text = "Feedback for visual plan: " + titleText + "\n\n" + items.map(function (item, i) { return (i + 1) + ". " + item.text; }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(function () { copy.textContent = "Copy for agent"; }, 1200);
    });

    actions.appendChild(add);
    actions.appendChild(copy);
    content.appendChild(list);
    content.appendChild(ta);
    content.appendChild(actions);
    aside.appendChild(content);
    redraw();
    return aside;
  }

  function renderPlanViewer(data, expiresAt) {
    var app = document.getElementById("app");
    if (!app) return;

    var files = data.files || [];
    var entry = pickEntry(data);
    var isVisualPlan = (data.kind || "") === "visual-plan" || (data.kind || "") === "visual-recap";
    var docLabel = isVisualPlan ? "visual plan" : "documents";
    var titleText = data.title || entry.title || (isVisualPlan ? "Visual plan" : "Documents");

    var viewer = document.createElement("div");
    viewer.className = "plan-viewer";

    var headerEl = document.createElement("header");
    headerEl.className = "file-viewer-header";

    var headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.style.gap = "0.75rem";

    var label = document.createElement("span");
    label.textContent = docLabel + " — " + titleText;
    headerLeft.appendChild(label);

    var meta = window.AgentGateExpiry ? window.AgentGateExpiry.getShareMeta() : null;
    var badgeHandle = window.AgentGateExpiry ? window.AgentGateExpiry.createExpiryBadge(expiresAt, meta && meta.neverExpires) : null;
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
    if (window.AgentGateSettings) window.AgentGateSettings.renderSettingsPanel(headerRight);

    headerEl.appendChild(headerLeft);
    headerEl.appendChild(headerRight);
    viewer.appendChild(headerEl);

    var body = document.createElement("div");
    body.className = "plan-layout";

    // (export control is wired below once renderPrint/entry are in scope)
    if (files.length <= 1) body.classList.add("no-sidebar");
    if (!isVisualPlan) body.classList.add("docs-mode");

    var article = document.createElement("article");
    article.className = "markdown-body plan-document";

    // Shared render pipeline — used for the live view, and reused verbatim for
    // PDF export so the printed output matches the screen exactly.
    function renderContentInto(node, content) {
      node.innerHTML = renderMarkdown(content || "");
      attachCodeHighlight(node);
      renderWireframes(node);
      return renderMermaid(node); // may return a promise (async diagrams)
    }

    function renderFile(file) {
      entry = file;
      renderContentInto(article, file.content || "");
      var buttons = body.querySelectorAll(".plan-file-tree button");
      for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle("active", buttons[i].textContent === file.title);
    }

    function renderPrint(root, scope) {
      if (scope === "current") {
        root.appendChild(article.cloneNode(true));
        return;
      }
      var promises = [];
      files.forEach(function (f) {
        if (files.length > 1) {
          var head = document.createElement("h2");
          head.className = "plan-print-filename";
          head.textContent = f.title || "untitled";
          root.appendChild(head);
        }
        var sec = document.createElement("article");
        sec.className = "markdown-body plan-document";
        root.appendChild(sec);
        var p = renderContentInto(sec, f.content || "");
        if (p) promises.push(p);
      });
      return Promise.all(promises);
    }

    if (window.AgentGateExport) {
      window.AgentGateExport.renderExportControl(headerRight, {
        kind: isVisualPlan ? "plan" : "docs",
        title: titleText,
        multi: files.length > 1,
        sources: files.map(function (f) {
          return { name: f.title, content: f.content };
        }),
        getCurrentSource: function () {
          return { name: entry.title, content: entry.content };
        },
        renderPrint: renderPrint,
      });
    }

    if (files.length > 1) body.appendChild(createFileTree(files, entry.title, renderFile));
    body.appendChild(article);
    if (isVisualPlan) body.appendChild(createFeedbackPanel(titleText));
    viewer.appendChild(body);

    app.innerHTML = "";
    app.appendChild(viewer);
    renderFile(entry);
  }

  function attemptDecrypt(passphrase, remember) {
    var S = window.AgentGateShare;
    var encrypted = S ? S.getEncryptedData() : null;
    if (!encrypted) return;

    var P = window.AgentGatePassphrase;
    if (P) P.showDecryptingState();

    window.AgentGateCrypto
      .decrypt(encrypted.ciphertext, encrypted.iv, encrypted.salt, passphrase)
      .then(function (plaintext) {
        var data = JSON.parse(plaintext);
        if (remember && P) P.storePassphrase(passphrase);
        if (P) P.hidePassphraseDialog();
        renderPlanViewer(data, S.getExpiresAt());
      })
      .catch(function (err) {
        console.error("Decryption failed:", err);
        if (P) P.updatePassphraseError("Decryption failed. Please check your passphrase.");
      });
  }

  function init() {
    if (window.AgentGateSettings) window.AgentGateSettings.init();
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
