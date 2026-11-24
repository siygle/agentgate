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

  var lastMermaidDark = null;

  function renderMermaid(container, forceRerender) {
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
            UI.t("frame.missingMermaid", null, "Diagram not rendered — the mermaid library was not loaded for this share.") +
            "\n\n" +
            (node.textContent || "");
          node.replaceWith(note);
        });
      }
      return;
    }
    try {
      var isDark = UI.themeIsDark();
      var nodes = container.querySelectorAll(".mermaid");
      if (!nodes.length) return;
      if (forceRerender && lastMermaidDark === isDark) return;

      Array.prototype.forEach.call(nodes, function (node) {
        var saved = node.getAttribute("data-ag-mermaid-src");
        if (saved == null) {
          saved = node.textContent || "";
          node.setAttribute("data-ag-mermaid-src", saved);
        } else if (forceRerender || node.getAttribute("data-processed") === "true") {
          // Restore raw diagram syntax so mermaid.run() re-renders with the new theme.
          node.removeAttribute("data-processed");
          node.textContent = saved;
        }
      });

      lastMermaidDark = isDark;
      mermaid.initialize({ startOnLoad: false, theme: isDark ? "dark" : "default" });
      return Promise.resolve(mermaid.run({ nodes: nodes })).then(function () {
        Frame.reportHeight();
      });
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
      label.setAttribute("data-i18n", "frame.wireframe");
      label.textContent = UI.t("frame.wireframe", null, "Wireframe");
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

  function resolveRelativePath(baseFile, relPath) {
    var raw = String(relPath || "").replace(/[?#].*$/, "");
    if (!raw) return "";
    var baseParts = String(baseFile || "").split("/");
    baseParts.pop();
    var segs = (raw.charAt(0) === "/" ? raw.slice(1) : baseParts.concat(raw.split("/")).join("/")).split("/");
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || s === ".") continue;
      if (s === "..") {
        if (out.length) out.pop();
      } else {
        out.push(s);
      }
    }
    return out.join("/");
  }

  function resolveBundleFile(relPath) {
    if (!relPath || !files.length) return null;
    var candidates = [];
    var curTitle = (current && current.title) || "";
    var fromCur = resolveRelativePath(curTitle, relPath);
    if (fromCur) candidates.push(fromCur);
    var cleaned = normalizeAssetKey(relPath);
    if (cleaned && candidates.indexOf(cleaned) === -1) candidates.push(cleaned);
    var base = cleaned.split("/").pop();
    for (var c = 0; c < candidates.length; c++) {
      var target = candidates[c];
      for (var i = 0; i < files.length; i++) {
        if (normalizeAssetKey(files[i].title || "") === target) return files[i];
      }
    }
    if (base) {
      for (var j = 0; j < files.length; j++) {
        var fBase = normalizeAssetKey(files[j].title || "").split("/").pop();
        if (fBase === base) return files[j];
      }
    }
    return null;
  }

  function renderMath(container) {
    if (!container) return;
    var nodes = container.querySelectorAll("[data-ag-math]");
    if (!nodes.length) return;
    if (typeof katex === "undefined") {
      console.warn("AgentGate: content contains math formulas but KaTeX was not inlined");
      Array.prototype.forEach.call(nodes, function (node) {
        var raw = node.getAttribute("data-ag-math") || "";
        var tex = raw;
        try {
          tex = decodeURIComponent(raw);
        } catch (e) {
          /* keep raw */
        }
        node.innerHTML = '<code class="ag-missing-lib">' + UI.escapeHtml(tex) + "</code>";
      });
      return;
    }
    Array.prototype.forEach.call(nodes, function (node) {
      var raw = node.getAttribute("data-ag-math") || "";
      var tex = raw;
      try {
        tex = decodeURIComponent(raw);
      } catch (e) {
        /* keep raw */
      }
      var displayMode = node.getAttribute("data-ag-math-display") === "1";
      try {
        katex.render(tex, node, { displayMode: displayMode, throwOnError: false });
      } catch (e) {
        node.textContent = tex;
      }
    });
  }

  // --- section-level review comments (persisted via host reviewState bridge) --------

  var reviewState = { viewed: {}, comments: [] };

  function emitReviewState() {
    if (Frame && typeof Frame.reportReviewState === "function") {
      Frame.reportReviewState({ viewed: reviewState.viewed, comments: reviewState.comments });
    }
  }

  function renderSectionComments(container) {
    if (!container) return;
    // Remove any previously injected comment UI before re-attaching.
    Array.prototype.forEach.call(
      container.querySelectorAll(".ag-heading-comment-btn, .ag-doc-comment-thread"),
      function (el) {
        el.remove();
      }
    );

    var fileName = (current && current.title) || "document";
    var headings = container.querySelectorAll("h1, h2, h3");
    Array.prototype.forEach.call(headings, function (h) {
      var sectionTitle = (h.textContent || "").trim();
      if (!sectionTitle) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ag-heading-comment-btn";
      btn.textContent = "+";
      btn.title = UI.t("review.addComment", null, "Add review comment");
      btn.setAttribute("aria-label", btn.title);

      var thread = document.createElement("div");
      thread.className = "ag-doc-comment-thread";

      function drawThread(openEditor) {
        thread.textContent = "";
        var matching = reviewState.comments.filter(function (c) {
          return c.file === fileName && c.section === sectionTitle;
        });
        matching.forEach(function (c) {
          var card = document.createElement("div");
          card.className = "ag-inline-comment-card";
          var meta = document.createElement("div");
          meta.className = "ag-inline-comment-meta";
          var ts = document.createElement("span");
          ts.textContent = c.created_at || "";
          var del = document.createElement("button");
          del.type = "button";
          del.className = "ag-inline-comment-del";
          del.textContent = "×";
          del.title = UI.t("review.deleteComment", null, "Delete comment");
          del.addEventListener("click", function () {
            reviewState.comments = reviewState.comments.filter(function (x) {
              return x.id !== c.id;
            });
            emitReviewState();
            drawThread(false);
            Frame.reportHeight();
          });
          meta.appendChild(ts);
          meta.appendChild(del);
          var body = document.createElement("div");
          body.className = "ag-inline-comment-text";
          body.textContent = c.text;
          card.appendChild(meta);
          card.appendChild(body);
          thread.appendChild(card);
        });

        if (openEditor) {
          var box = document.createElement("div");
          box.className = "ag-inline-comment-editor";
          var ta = document.createElement("textarea");
          ta.className = "ag-inline-comment-input";
          ta.rows = 2;
          ta.placeholder = UI.t("review.commentPlaceholder", null, "Add a review note for this section…");
          var acts = document.createElement("div");
          acts.className = "ag-inline-comment-actions";
          var saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "diff-toolbar-btn active";
          saveBtn.textContent = UI.t("review.saveComment", null, "Save");
          var cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "diff-toolbar-btn";
          cancelBtn.textContent = UI.t("common.cancel", null, "Cancel");

          function submit() {
            var txt = (ta.value || "").trim();
            if (!txt) return;
            reviewState.comments.push({
              id: "dc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
              file: fileName,
              section: sectionTitle,
              text: txt,
              created_at: new Date().toLocaleTimeString(),
            });
            emitReviewState();
            drawThread(false);
            Frame.reportHeight();
          }

          saveBtn.addEventListener("click", submit);
          ta.addEventListener("keydown", function (ev) {
            if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
              ev.preventDefault();
              submit();
            } else if (ev.key === "Escape") {
              drawThread(false);
              Frame.reportHeight();
            }
          });
          cancelBtn.addEventListener("click", function () {
            drawThread(false);
            Frame.reportHeight();
          });

          acts.appendChild(saveBtn);
          acts.appendChild(cancelBtn);
          box.appendChild(ta);
          box.appendChild(acts);
          thread.appendChild(box);
          setTimeout(function () {
            ta.focus();
          }, 0);
        }

        thread.hidden = !thread.childNodes.length;
      }

      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        drawThread(true);
        Frame.reportHeight();
      });

      h.appendChild(btn);
      if (h.parentNode) {
        h.parentNode.insertBefore(thread, h.nextSibling);
      }
      drawThread(false);
    });
  }

  function finishRenderedContent(node) {
    resolveAssets(node);
    promoteMermaidCodeBlocks(node);
    renderMath(node);
    attachCodeHighlight(node);
    UI.attachCodeBlockCopyButtons(node);
    renderWireframes(node);
    UI.assignHeadingIds(node);
    UI.prepareLinks(node, { canResolveFile: resolveBundleFile });
    renderSectionComments(node);
    return renderMermaid(node);
  }

  function renderContentInto(node, content, file) {
    if (isMdxFile(file) && window.AgentGateMDX) {
      node.innerHTML = '<div class="mdx-loading">' + UI.escapeHtml(UI.t("frame.renderingMdx", null, "Rendering MDX…")) + "</div>";
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
    title.setAttribute("data-i18n", "common.files");
    title.textContent = UI.t("common.files", null, "Files");
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
  // the generated SVG, so it has to re-run from the saved diagram source.
  Frame.onSettings = function () {
    renderMermaid(article, true);
  };

  Frame.onReviewInit = function (st) {
    if (!st || typeof st !== "object") return;
    reviewState.viewed = st.viewed && typeof st.viewed === "object" ? st.viewed : {};
    reviewState.comments = Array.isArray(st.comments) ? st.comments : [];
    renderSectionComments(article);
    Frame.reportHeight();
  };

  // --- boot -------------------------------------------------------------------------

  var sidebar = buildSidebar();
  if (sidebar) layout.insertBefore(sidebar, article);
  UI.wireAnchors(article, {
    onFileLink: function (path, hash) {
      var target = resolveBundleFile(path);
      if (!target) return;
      selectFile(target).then(function () {
        if (hash) {
          UI.scrollToHash(hash);
          Frame.reportHash(hash);
        }
      });
    },
  });

  if (window.AgentGateI18n && window.AgentGateI18n.applyDom) {
    window.AgentGateI18n.applyDom(document);
  }

  selectFile(current).then(function () {
    if (boot.hash) UI.scrollToHash(boot.hash);
  });
})();
