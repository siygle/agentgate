(function () {
  "use strict";

  // Document / visual-plan renderer, running inside AgentGate's sandbox.
  //
  // Ported from the old web/static/js/plan-viewer.js. The important difference is where
  // it runs: markdown is turned into HTML and MDX expressions are evaluated *here*, in
  // an opaque origin with connect-src 'none', instead of on the page that holds the
  // decryption key and the remembered passphrase.
  //
  // Talks to the host only through window.AgentGateFrame (installed by sandbox.js):
  // reports its height and current file, receives print-scope and deep-link messages.

  // sandbox.js installs the bridge at the end of <head>, so it must already exist here.
  // If it does not, deep links, print-scope switching, and the current-file report all
  // stop working while height reporting keeps going on its own — a silent partial
  // failure. Complain loudly instead of degrading quietly.
  var Frame = window.AgentGateFrame;
  if (!Frame) {
    console.error(
      "AgentGate: host bridge missing — sandbox.js must inject it before renderer scripts."
    );
    Frame = {
      reportHeight: function () {},
      reportHash: function () {},
      reportCurrentFile: function () {},
    };
  }

  // --- payload ---------------------------------------------------------------------

  function readPayload() {
    var el = document.getElementById("agentgate-payload");
    if (!el) return { payload: {}, hash: "" };
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      console.error("Unreadable payload", e);
      return { payload: {}, hash: "" };
    }
  }

  var boot = readPayload();
  var data = boot.payload || {};
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

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function themeIsDark() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return prefersDark();
  }

  function renderMermaid(container) {
    if (!container || typeof mermaid === "undefined") return;
    try {
      mermaid.initialize({ startOnLoad: false, theme: themeIsDark() ? "dark" : "default" });
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
    assignHeadingIds(node);
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

  // --- deep links -------------------------------------------------------------------

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w一-鿿\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);
  }

  // Headings get stable ids so the host can turn "#some-section" into a scroll position.
  // The frame cannot own the address bar, so it reports the target back instead.
  function assignHeadingIds(node) {
    if (!node) return;
    var used = {};
    Array.prototype.forEach.call(node.querySelectorAll("h1, h2, h3, h4"), function (h) {
      if (h.id) return;
      var base = slugify(h.textContent);
      if (!base) return;
      var id = base;
      var n = 2;
      while (used[id] || document.getElementById(id)) id = base + "-" + n++;
      used[id] = true;
      h.id = id;
    });
  }

  function scrollToHash(hash) {
    var id = String(hash || "").replace(/^#/, "");
    if (!id) return;
    var target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: "start" });
  }

  // --- in-frame find ----------------------------------------------------------------
  // Browsers do search into srcdoc subframes, but only the focused one, which makes
  // Ctrl+F unreliable here. This is also better than Ctrl+F for the multi-file case: it
  // reports how many files match, not just the one on screen.

  var findState = { query: "", marks: [], index: 0 };

  function clearFindMarks(root) {
    Array.prototype.forEach.call(root.querySelectorAll("mark[data-ag-find]"), function (m) {
      var parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent || ""), m);
      parent.normalize();
    });
    findState.marks = [];
  }

  function markMatches(root, query) {
    if (!query) return [];
    var marks = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // Skip generated SVG (mermaid) — rewriting its text nodes breaks the diagram.
        var p = n.parentElement;
        while (p && p !== root) {
          var tag = p.tagName;
          if (tag === "SVG" || tag === "svg" || tag === "MARK" || tag === "SCRIPT" || tag === "STYLE") {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var targets = [];
    var node;
    while ((node = walker.nextNode())) targets.push(node);

    var needle = query.toLowerCase();
    targets.forEach(function (text) {
      var value = text.nodeValue;
      var lower = value.toLowerCase();
      var at = lower.indexOf(needle);
      if (at === -1) return;
      var frag = document.createDocumentFragment();
      var cursor = 0;
      while (at !== -1) {
        if (at > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, at)));
        var mark = document.createElement("mark");
        mark.setAttribute("data-ag-find", "1");
        mark.textContent = value.slice(at, at + query.length);
        frag.appendChild(mark);
        marks.push(mark);
        cursor = at + query.length;
        at = lower.indexOf(needle, cursor);
      }
      if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
      if (text.parentNode) text.parentNode.replaceChild(frag, text);
    });
    return marks;
  }

  function focusMatch(delta) {
    if (!findState.marks.length) return;
    findState.marks.forEach(function (m) {
      m.removeAttribute("data-ag-current");
    });
    findState.index = (findState.index + delta + findState.marks.length) % findState.marks.length;
    var current = findState.marks[findState.index];
    current.setAttribute("data-ag-current", "1");
    current.scrollIntoView({ block: "center" });
    updateFindCount();
  }

  function updateFindCount() {
    var el = document.getElementById("ag-find-count");
    if (!el) return;
    if (!findState.query) {
      el.textContent = "";
      return;
    }
    if (!findState.marks.length) {
      el.textContent = "no matches";
      return;
    }
    var suffix = "";
    if (files.length > 1) {
      var others = files.filter(function (f) {
        return (
          (f.title || "") !== (current.title || "") &&
          String(f.content || "").toLowerCase().indexOf(findState.query.toLowerCase()) !== -1
        );
      }).length;
      if (others) suffix = " · " + others + " other file" + (others === 1 ? "" : "s");
    }
    el.textContent = findState.index + 1 + "/" + findState.marks.length + suffix;
  }

  // --- layout -----------------------------------------------------------------------

  var layout = document.getElementById("ag-layout");
  var article = document.getElementById("ag-document");
  var toolbar = document.getElementById("ag-toolbar");
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
      if (findState.query) runFind(findState.query);
      Frame.reportHeight();
    });
  }

  function runFind(query) {
    findState.query = query;
    clearFindMarks(article);
    findState.marks = markMatches(article, query);
    findState.index = 0;
    if (findState.marks.length) {
      findState.marks[0].setAttribute("data-ag-current", "1");
      findState.marks[0].scrollIntoView({ block: "center" });
    }
    updateFindCount();
    Frame.reportHeight();
  }

  function wireFind() {
    var input = document.getElementById("ag-find-input");
    if (!input) return;
    toolbar.hidden = false;
    var debounce = null;
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      var value = input.value;
      debounce = setTimeout(function () {
        runFind(value);
      }, 140);
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        focusMatch(ev.shiftKey ? -1 : 1);
      } else if (ev.key === "Escape") {
        input.value = "";
        runFind("");
      }
    });
    document.getElementById("ag-find-next").addEventListener("click", function () {
      focusMatch(1);
    });
    document.getElementById("ag-find-prev").addEventListener("click", function () {
      focusMatch(-1);
    });
    // Make the browser shortcut land in this box rather than opening the host's find bar
    // against a frame it cannot search well.
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "f") {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

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
    scrollToHash(hash);
  };

  // Re-theme diagrams when the host's theme setting changes; mermaid bakes colours into
  // the generated SVG, so it has to re-run.
  Frame.onSettings = function () {
    renderMermaid(article);
  };

  // --- boot -------------------------------------------------------------------------

  var sidebar = buildSidebar();
  if (sidebar) layout.insertBefore(sidebar, article);
  wireFind();

  // Anchor clicks inside the document scroll locally and tell the host, which owns the
  // address bar.
  article.addEventListener("click", function (ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest("a[href^='#']") : null;
    if (!link) return;
    ev.preventDefault();
    var hash = link.getAttribute("href");
    scrollToHash(hash);
    Frame.reportHash(hash);
  });

  selectFile(current).then(function () {
    if (boot.hash) scrollToHash(boot.hash);
  });
})();
