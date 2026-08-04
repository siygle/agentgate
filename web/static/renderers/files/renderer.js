(function () {
  "use strict";

  // File-bundle renderer, running inside AgentGate's sandbox.
  //
  // Ported from the old web/static/js/file-viewer.js. Same sidebar, mobile accordion,
  // and Source/Preview tabs for markdown; the difference is that highlighting and
  // markdown rendering now happen in an opaque origin with connect-src 'none' rather
  // than on the page holding the decryption key.

  var UI = window.AgentGateFrameUI;
  var Frame = UI.frame;
  var escapeHtml = UI.escapeHtml;
  var MD = window.AgentGateMarkdown;

  var boot = UI.readBoot();
  var data = boot.payload;
  var files = data.files || [];

  var LANG_MAP = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", py: "python", go: "go", rs: "rust",
    java: "java", kt: "kotlin", cs: "csharp", cpp: "cpp", c: "c", h: "c", hpp: "cpp",
    css: "css", scss: "scss", less: "less", html: "html", svg: "xml", xml: "xml",
    json: "json", yaml: "yaml", yml: "yaml", toml: "ini", md: "markdown", sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash", php: "php", vue: "xml", svelte: "xml",
    gql: "graphql", dockerfile: "dockerfile", makefile: "makefile",
  };

  function detectLanguage(filename) {
    return LANG_MAP[(filename || "").split(".").pop().toLowerCase()] || null;
  }

  function highlightCode(code, lang) {
    if (typeof hljs === "undefined") return escapeHtml(code);
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch (e) {
      return escapeHtml(code);
    }
  }

  // --- copy buttons -------------------------------------------------------------

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  // The frame is sandboxed without allow-same-origin, so the async Clipboard API can be
  // refused. execCommand still works from a user gesture and is the only fallback left.
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function flashCopyState(btn, ok) {
    var orig = "Copy";
    btn.textContent = ok ? "Copied" : "Failed";
    btn.classList.add(ok ? "copy-btn--success" : "copy-btn--error");
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = orig;
      btn.classList.remove("copy-btn--success", "copy-btn--error");
      btn.disabled = false;
    }, 1500);
  }

  function createCopyButton(getText) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      Promise.resolve(copyText(getText() || "")).then(function (ok) {
        flashCopyState(btn, ok);
      });
    });
    return btn;
  }

  function attachCodeBlockCopyButtons(container) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll("pre"), function (pre) {
      var code = pre.querySelector("code");
      if (!code) return;
      var btn = createCopyButton(function () {
        return code.textContent;
      });
      btn.classList.add("copy-btn--block");
      pre.appendChild(btn);
    });
  }

  // --- content ------------------------------------------------------------------

  function renderMarkdownPanel(target, file, lang) {
    var tabBar = document.createElement("div");
    tabBar.className = "tab-bar";

    var sourceTab = document.createElement("button");
    sourceTab.type = "button";
    sourceTab.className = "tab active";
    sourceTab.textContent = "Source";

    var previewTab = document.createElement("button");
    previewTab.type = "button";
    previewTab.className = "tab";
    previewTab.textContent = "Preview";

    tabBar.appendChild(sourceTab);
    tabBar.appendChild(previewTab);
    tabBar.appendChild(
      createCopyButton(function () {
        return file.content || "";
      })
    );
    target.appendChild(tabBar);

    var sourcePane = document.createElement("pre");
    sourcePane.className = "code-content";
    sourcePane.innerHTML = '<code class="hljs">' + highlightCode(file.content || "", lang) + "</code>";
    target.appendChild(sourcePane);

    var previewPane = document.createElement("div");
    previewPane.className = "markdown-body";
    previewPane.style.display = "none";
    previewPane.innerHTML = MD ? MD.renderMarkdown(file.content || "") : "";
    attachCodeBlockCopyButtons(previewPane);
    target.appendChild(previewPane);

    function select(tab) {
      var preview = tab === "preview";
      previewTab.className = preview ? "tab active" : "tab";
      sourceTab.className = preview ? "tab" : "tab active";
      previewPane.style.display = preview ? "" : "none";
      sourcePane.style.display = preview ? "none" : "";
      find.refresh();
      Frame.reportHeight();
    }

    sourceTab.addEventListener("click", function () {
      select("source");
    });
    previewTab.addEventListener("click", function () {
      select("preview");
    });
  }

  function buildFileContentNode(file) {
    var filename = file.title || "untitled";
    var lang = detectLanguage(filename);

    var wrap = document.createElement("div");
    wrap.className = "file-content-block";

    var headerBar = document.createElement("div");
    headerBar.className = "file-header-bar";
    headerBar.innerHTML = "<span>" + escapeHtml(filename) + "</span>";
    wrap.appendChild(headerBar);

    if (MD && MD.isMarkdown(filename)) {
      renderMarkdownPanel(wrap, file, lang);
    } else {
      var codeBlock = document.createElement("pre");
      codeBlock.className = "code-content";
      codeBlock.innerHTML = '<code class="hljs">' + highlightCode(file.content || "", lang) + "</code>";
      wrap.appendChild(codeBlock);
      attachCodeBlockCopyButtons(wrap);
    }
    return wrap;
  }

  // --- layout -------------------------------------------------------------------

  var sidebar = document.getElementById("ag-sidebar");
  var contentPanel = document.getElementById("ag-content");
  var accordion = document.getElementById("ag-accordion");
  var activeIndex = 0;

  function renderDesktopContent(index) {
    contentPanel.textContent = "";
    var file = files[index];
    if (!file) return;
    contentPanel.appendChild(buildFileContentNode(file));
    Frame.reportCurrentFile(file.title || "");
    find.refresh();
    Frame.reportHeight();
  }

  function buildSidebar() {
    files.forEach(function (file, idx) {
      var item = document.createElement("div");
      item.className = "file-sidebar-item" + (idx === 0 ? " active" : "");
      item.textContent = file.title || "untitled";
      item.addEventListener("click", function () {
        activeIndex = idx;
        Array.prototype.forEach.call(sidebar.querySelectorAll(".file-sidebar-item"), function (el) {
          el.classList.remove("active");
        });
        item.classList.add("active");
        renderDesktopContent(idx);
      });
      sidebar.appendChild(item);
    });
  }

  function buildAccordion() {
    files.forEach(function (file) {
      var filename = file.title || "untitled";
      var lang = detectLanguage(filename);

      var item = document.createElement("div");
      item.className = "accordion-item";

      var header = document.createElement("div");
      header.className = "accordion-header";
      header.innerHTML =
        '<span class="text-mono text-sm">' + escapeHtml(filename) + "</span>" +
        '<span class="accordion-arrow">&#9660;</span>';

      var body = document.createElement("div");
      body.className = "accordion-body";
      body.style.display = "none";

      if (MD && MD.isMarkdown(filename)) {
        renderMarkdownPanel(body, file, lang);
      } else {
        var codeBlock = document.createElement("pre");
        codeBlock.className = "code-content";
        codeBlock.innerHTML = '<code class="hljs">' + highlightCode(file.content || "", lang) + "</code>";
        body.appendChild(codeBlock);
        attachCodeBlockCopyButtons(body);
      }

      header.addEventListener("click", function () {
        var isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "";
        header.querySelector(".accordion-arrow").innerHTML = isOpen ? "&#9660;" : "&#9650;";
        Frame.reportHeight();
      });

      item.appendChild(header);
      item.appendChild(body);
      accordion.appendChild(item);
    });
  }

  var find = UI.createFind({
    // Search the whole body: on desktop that is the open file, on mobile every expanded
    // accordion section.
    root: function () {
      return document.querySelector(".file-viewer-body");
    },
    otherMatches: function (query) {
      var needle = query.toLowerCase();
      return files.filter(function (f, idx) {
        return idx !== activeIndex && String(f.content || "").toLowerCase().indexOf(needle) !== -1;
      }).length;
    },
  });

  // Printing shows every file, so a PDF of a bundle is the whole bundle; "current"
  // restores the single-file view.
  Frame.onPrintScope = function (scope) {
    if (scope !== "all") return renderDesktopContent(activeIndex);
    contentPanel.textContent = "";
    files.forEach(function (file) {
      contentPanel.appendChild(buildFileContentNode(file));
    });
    Frame.reportHeight();
  };

  Frame.onHash = function (hash) {
    UI.scrollToHash(hash);
  };

  if (!files.length) {
    contentPanel.innerHTML = '<p class="text-muted text-sm">This bundle is empty.</p>';
  } else {
    buildSidebar();
    buildAccordion();
    renderDesktopContent(0);
  }
  UI.wireAnchors(document.querySelector(".file-viewer-body"));
  if (boot.hash) UI.scrollToHash(boot.hash);
})();
