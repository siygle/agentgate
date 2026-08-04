(function () {
  "use strict";

  // Document / visual-plan renderer, running inside AgentGate's sandbox.
  //
  // Ported from the old web/static/js/plan-viewer.js. The important difference is where
  // it runs: markdown is turned into HTML and MDX expressions are evaluated *here*, in
  // an opaque origin with connect-src 'none', instead of on the page that holds the
  // decryption key and the remembered passphrase.
  //
  // Talks to the host only through the bridge in renderers/common/frame-ui.js, which also
  // supplies the find bar, heading ids, and anchor handling shared by every renderer.
  var UI = window.AgentGateFrameUI;
  var Frame = UI.frame;

  var boot = UI.readBoot();
  var data = boot.payload;
  var files = data.files || [];

  // --- entry selection --------------------------------------------------------------

  function fileMap(list) {
    var map = {};
    (list || []).forEach(function (f) {
      map[f.title || ""] = f;
    });
    return map;
  }

  function pickEntry() {
    // plan_mdx is the oldest payload shape, from before bundles carried a file list.
    if (data.plan_mdx) return { title: data.title || "plan.mdx", content: data.plan_mdx };
    var map = fileMap(files);
    if (data.entry && map[data.entry]) return map[data.entry];
    var preferred = ["plan.mdx", "plan.md", "README.mdx", "README.md"];
    for (var i = 0; i < preferred.length; i++) {
      if (map[preferred[i]]) return map[preferred[i]];
    }
    for (var j = 0; j < files.length; j++) {
      if (/\.(mdx?|markdown)$/i.test(files[j].title || "")) return files[j];
    }
    return files[0] || { title: "document", content: "" };
  }

  // --- payload assets ---------------------------------------------------------------
  // Local image/media references in the rendered markdown (e.g. ![](diagram.png)) become
  // data: URIs from the bundle, so a document that ships its own images renders instead
  // of showing broken links. The frame allows img-src data: only, so this is the only way
  // an image can appear at all.

  var ASSET_MIME = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp", svg: "image/svg+xml",
    mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
  };

  function normalizeAssetKey(path) {
    return (path || "").replace(/^\.?\//, "").replace(/[?#].*$/, "");
  }

  function buildAssetMap(list) {
    var map = {};
    (list || []).forEach(function (f) {
      var name = f.title || "";
      var entry = { content: f.content || "", encoding: f.encoding || "" };
      map[normalizeAssetKey(name)] = entry;
      var base = name.split("/").pop();
      if (base && !(normalizeAssetKey(base) in map)) map[normalizeAssetKey(base)] = entry;
    });
    return map;
  }

  function assetToDataURI(entry, name) {
    var isB64 = entry && entry.encoding === "base64";
    var ext = (name || "").split(".").pop().toLowerCase();
    var mime = ASSET_MIME[ext] || (isB64 ? "application/octet-stream" : "text/plain");
    if (isB64) return "data:" + mime + ";base64," + entry.content;
    return "data:" + mime + ";charset=utf-8," + encodeURIComponent(entry.content);
  }

  var assetMap = buildAssetMap(files);

  function resolveAssets(container) {
    if (!container) return;
    var els = container.querySelectorAll("img[src], source[src], video[src], audio[src]");
    Array.prototype.forEach.call(els, function (el) {
      var ref = el.getAttribute("src");
      if (!ref || /^(https?:|data:|blob:|#)/i.test(ref)) return;
      var key = normalizeAssetKey(ref);
      var entry = assetMap[key] || assetMap[key.split("/").pop()];
      if (!entry) return;
      el.setAttribute("src", assetToDataURI(entry, ref));
    });
  }

  // --- render pipeline --------------------------------------------------------------

  function renderMarkdown(markdown) {
    if (window.AgentGateMarkdown) return window.AgentGateMarkdown.renderMarkdown(markdown || "");
    if (typeof marked !== "undefined") return marked.parse(markdown || "");
    return "<pre>" + UI.escapeHtml(markdown || "") + "</pre>";
  }

  function attachCodeHighlight(container) {
    if (!container) return;
    var blocks = container.querySelectorAll("pre code");
    if (typeof hljs === "undefined") {
      // Unhighlighted code still reads fine, so this degrades rather than breaks — but it
      // means detection missed something, which is worth knowing about.
      if (blocks.length) {
        console.warn("AgentGate: content has code blocks but highlight.js was not inlined");
      }
      return;
    }
    for (var i = 0; i < blocks.length; i++) hljs.highlightElement(blocks[i]);
  }

  function renderMermaid(container) {
    if (!container) return;
    // The library is only inlined when detectFeatures (share-kind.js) saw a diagram in the
    // payload. If detection missed one, say so in place of the diagram: a blank gap would
    // look like a rendering bug and hide the real cause.
    if (typeof mermaid === "undefined") {
      var missed = container.querySelectorAll(".mermaid");
      if (missed.length) {
        console.error("AgentGate: content contains a mermaid diagram the sandbox did not inline mermaid for");
        Array.prototype.forEach.call(missed, function (node) {
          var note = document.createElement("pre");
          note.className = "code-content ag-missing-lib";
          note.textContent =
            "Diagram not rendered — the mermaid library was not loaded for this share.\n\n" +
            (node.textContent || "");
          node.replaceWith(note);
        });
      }
      return;
    }
    try {
      mermaid.initialize({ startOnLoad: false, theme: UI.themeIsDark() ? "dark" : "default" });
      var nodes = container.querySelectorAll(".mermaid");
      if (nodes.length) return mermaid.run({ nodes: nodes });
    } catch (e) {
      console.warn("Mermaid render failed", e);
    }
  }

  function promoteMermaidCodeBlocks(node) {
    if (!node) return;
    var blocks = node.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid");
    for (var i = 0; i < blocks.length; i++) {
      var code = blocks[i];
      var pre = code.parentElement;
      var div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent || "";
      if (pre) pre.replaceWith(div);
    }
  }

  // Wireframes are static HTML fenced blocks. They already render inside this sandbox,
  // so the extra nested iframe exists only to keep a wireframe's styles from leaking
  // into the surrounding document.
  function wireframeSrcdoc(html) {
    var css =
      "<style>" +
      "html,body{margin:0;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      "body{padding:16px;box-sizing:border-box;}" +
      "button,.btn{border:1px solid #c8d0d9;border-radius:8px;background:#f6f8fa;padding:7px 12px;font:inherit;}" +
      "button.primary,.primary{background:#0969da;color:#fff;border-color:#0969da;}" +
      ".wf-card,.card{border:1px solid #d8dee4;border-radius:12px;background:#fff;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.04);}" +
      ".wf-box,.box{border:1px dashed #aeb8c2;border-radius:10px;background:#f6f8fa;min-height:44px;padding:12px;display:flex;align-items:center;justify-content:center;color:#57606a;text-align:center;}" +
      ".muted{color:#57606a}.row{display:flex;gap:12px;align-items:center}.col{display:flex;flex-direction:column;gap:12px}" +
      "*{box-sizing:border-box}" +
      "</style>";
    var csp =
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
      "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'\">";
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      csp +
      css +
      "</head><body>" +
      html +
      "</body></html>"
    );
  }

  function renderWireframes(container) {
    if (!container) return;
    var nodes = container.querySelectorAll(".plan-wireframe-source");
    Array.prototype.forEach.call(nodes, function (node) {
      var raw = node.getAttribute("data-wireframe") || "";
      var html = raw;
      try {
        html = decodeURIComponent(raw);
      } catch (e) {
        /* keep raw */
      }

      var shell = document.createElement("div");
      shell.className = "plan-wireframe";
      var toolbar = document.createElement("div");
      toolbar.className = "plan-wireframe-toolbar";
      var label = document.createElement("span");
      label.textContent = "Wireframe";
      toolbar.appendChild(label);
      var frame = document.createElement("iframe");
      frame.className = "plan-wireframe-frame";
      frame.setAttribute("sandbox", "");
      frame.setAttribute("srcdoc", wireframeSrcdoc(html));
      shell.appendChild(toolbar);
      shell.appendChild(frame);
      node.replaceWith(shell);
    });
    // A nested frame's own layout settles after this turn; re-measure so the host does
    // not clip it.
    if (nodes.length) setTimeout(Frame.reportHeight, 120);
  }

  function isMdxFile(file) {
    return /\.mdx$/i.test((file && file.title) || "");
  }

  function finishRenderedContent(node) {
    resolveAssets(node);
    promoteMermaidCodeBlocks(node);
    attachCodeHighlight(node);
    renderWireframes(node);
    UI.assignHeadingIds(node);
    return renderMermaid(node);
  }

  function renderContentInto(node, content, file) {
    if (isMdxFile(file) && window.AgentGateMDX) {
      node.innerHTML = '<div class="mdx-loading">Rendering MDX…</div>';
      return window.AgentGateMDX
        .renderMdxInto(node, content || "")
        .then(function () {
          return finishRenderedContent(node);
        })
        .catch(function (err) {
          // markdown.js handles the same Callout/Mermaid/DataModel/Endpoint tags with
          // regex preprocessing — less faithful, but it always renders something.
          console.warn("MDX render failed; falling back to markdown", err);
          node.innerHTML = renderMarkdown(content || "");
          return finishRenderedContent(node);
        });
    }
    node.innerHTML = renderMarkdown(content || "");
    return Promise.resolve(finishRenderedContent(node));
  }

  // --- layout -----------------------------------------------------------------------

  var layout = document.getElementById("ag-layout");
  var article = document.getElementById("ag-document");
  var current = pickEntry();

  var isVisualPlan = (data.kind || "") === "visual-plan" || (data.kind || "") === "visual-recap";
  if (!isVisualPlan) layout.classList.add("docs-mode");
  if (files.length <= 1) layout.classList.add("no-sidebar");

  var sidebarButtons = [];

  function buildSidebar() {
    if (files.length <= 1) return null;
    var wrap = document.createElement("aside");
    wrap.className = "plan-sidebar";
    var title = document.createElement("h2");
    title.textContent = "Files";
    wrap.appendChild(title);
    var list = document.createElement("ul");
    list.className = "plan-file-tree";
    files.forEach(function (f) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = f.title || "untitled";
      if ((f.title || "") === (current.title || "")) btn.className = "active";
      btn.addEventListener("click", function () {
        selectFile(f);
      });
      sidebarButtons.push({ button: btn, file: f });
      li.appendChild(btn);
      list.appendChild(li);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function markActiveInSidebar() {
    sidebarButtons.forEach(function (item) {
      item.button.classList.toggle("active", (item.file.title || "") === (current.title || ""));
    });
  }

  function selectFile(file) {
    current = file;
    markActiveInSidebar();
    Frame.reportCurrentFile(file.title || "");
    return renderContentInto(article, file.content || "", file).then(function () {
      find.refresh();
      Frame.reportHeight();
    });
  }

  var find = UI.createFind({
    root: function () {
      return article;
    },
    // Report how many *other* files in the bundle match, which browser find cannot know.
    otherMatches: function (query) {
      var needle = query.toLowerCase();
      return files.filter(function (f) {
        return (
          (f.title || "") !== (current.title || "") &&
          String(f.content || "").toLowerCase().indexOf(needle) !== -1
        );
      }).length;
    },
  });

  // --- host messages ----------------------------------------------------------------

  // Print scope: "all" renders every file into the document so the PDF contains the
  // whole bundle; "current" restores the single-file view.
  Frame.onPrintScope = function (scope) {
    if (scope !== "all" || files.length <= 1) return selectFile(current);
    article.innerHTML = "";
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var head = document.createElement("h2");
        head.className = "plan-print-filename";
        head.textContent = f.title || "untitled";
        article.appendChild(head);
        var section = document.createElement("div");
        article.appendChild(section);
        return renderContentInto(section, f.content || "", f);
      });
    });
    return chain;
  };

  Frame.onHash = function (hash) {
    UI.scrollToHash(hash);
  };

  // Re-theme diagrams when the host's theme setting changes; mermaid bakes colours into
  // the generated SVG, so it has to re-run.
  Frame.onSettings = function () {
    renderMermaid(article);
  };

  // --- boot -------------------------------------------------------------------------

  var sidebar = buildSidebar();
  if (sidebar) layout.insertBefore(sidebar, article);
  UI.wireAnchors(article);

  selectFile(current).then(function () {
    if (boot.hash) UI.scrollToHash(boot.hash);
  });
})();
