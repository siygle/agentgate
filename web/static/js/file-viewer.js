(function () {
  "use strict";

  var LANG_MAP = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    svg: "xml",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    php: "php",
    vue: "xml",
    svelte: "xml",
    gql: "graphql",
  };

  function detectLanguage(filename) {
    var ext = (filename || "").split(".").pop().toLowerCase();
    return LANG_MAP[ext] || null;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightCode(code, lang) {
    if (
      lang &&
      typeof hljs !== "undefined" &&
      hljs.getLanguage(lang)
    ) {
      return hljs.highlight(code, { language: lang }).value;
    }
    if (typeof hljs !== "undefined") {
      return hljs.highlightAuto(code).value;
    }
    return escapeHtml(code);
  }


  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard
        .writeText(text)
        .then(function () {
          return true;
        })
        .catch(function () {
          return fallbackCopy(text);
        });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function flashCopyState(btn, ok) {
    var orig = btn.getAttribute("data-label") || btn.textContent;
    btn.setAttribute("data-label", orig);
    btn.textContent = ok ? "Copied!" : "Failed";
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
    var pres = container.querySelectorAll("pre");
    for (var i = 0; i < pres.length; i++) {
      (function (pre) {
        var code = pre.querySelector("code");
        if (!code) return;
        var btn = createCopyButton(function () {
          return code.textContent;
        });
        btn.classList.add("copy-btn--block");
        pre.appendChild(btn);
      })(pres[i]);
    }
  }

  function renderMarkdownPanel(target, file, lang) {
    var MD = window.AgentGateMarkdown;

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

    var copyBtn = createCopyButton(function () {
      return file.content || "";
    });

    tabBar.appendChild(sourceTab);
    tabBar.appendChild(previewTab);
    tabBar.appendChild(copyBtn);
    target.appendChild(tabBar);

    var sourcePane = document.createElement("pre");
    sourcePane.className = "code-content";
    sourcePane.innerHTML =
      '<code class="hljs">' +
      highlightCode(file.content || "", lang) +
      "</code>";
    target.appendChild(sourcePane);

    var previewPane = document.createElement("div");
    previewPane.className = "markdown-body";
    previewPane.style.display = "none";
    previewPane.innerHTML = MD.renderMarkdown(file.content || "");
    attachCodeBlockCopyButtons(previewPane);
    target.appendChild(previewPane);

    sourceTab.addEventListener("click", function () {
      sourceTab.className = "tab active";
      previewTab.className = "tab";
      sourcePane.style.display = "";
      previewPane.style.display = "none";
    });

    previewTab.addEventListener("click", function () {
      previewTab.className = "tab active";
      sourceTab.className = "tab";
      sourcePane.style.display = "none";
      previewPane.style.display = "";
    });
  }

  function renderFileViewer(data, expiresAt) {
    var app = document.getElementById("app");
    if (!app) return;

    var files = data.files || [];
    var MD = window.AgentGateMarkdown;
    var activeIndex = 0;

    var viewer = document.createElement("div");
    viewer.className = "file-viewer";

    // Header with expiry badge and settings
    var headerEl = document.createElement("header");
    headerEl.className = "file-viewer-header";

    var headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.style.gap = "0.75rem";

    var fileCount = document.createElement("span");
    fileCount.textContent =
      files.length + " file" + (files.length !== 1 ? "s" : "");
    headerLeft.appendChild(fileCount);

    var meta = window.AgentGateExpiry
      ? window.AgentGateExpiry.getShareMeta()
      : null;
    var badgeHandle = window.AgentGateExpiry
      ? window.AgentGateExpiry.createExpiryBadge(
          expiresAt,
          meta && meta.neverExpires
        )
      : null;
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

    if (window.AgentGateSettings) {
      window.AgentGateSettings.renderSettingsPanel(headerRight);
    }

    headerEl.appendChild(headerLeft);
    headerEl.appendChild(headerRight);
    viewer.appendChild(headerEl);

    var body = document.createElement("div");
    body.className = "file-viewer-body";

    // --- Desktop layout ---
    var sidebar = document.createElement("nav");
    sidebar.className = "file-sidebar desktop-only";

    var contentPanel = document.createElement("div");
    contentPanel.className = "file-content desktop-only";

    function renderDesktopContent(index) {
      var file = files[index];
      var filename = file.title || "untitled";
      var lang = detectLanguage(filename);
      var isMd = MD && MD.isMarkdown(filename);

      contentPanel.innerHTML = "";

      var headerBar = document.createElement("div");
      headerBar.className = "file-header-bar";
      headerBar.innerHTML = "<span>" + escapeHtml(filename) + "</span>";
      contentPanel.appendChild(headerBar);

      if (isMd) {
        renderMarkdownPanel(contentPanel, file, lang);
      } else {
        var codeBlock = document.createElement("pre");
        codeBlock.className = "code-content";
        codeBlock.innerHTML =
          '<code class="hljs">' +
          highlightCode(file.content || "", lang) +
          "</code>";
        contentPanel.appendChild(codeBlock);
      }
    }

    // Build sidebar items
    files.forEach(function (file, idx) {
      var item = document.createElement("div");
      item.className =
        "file-sidebar-item" + (idx === 0 ? " active" : "");
      item.textContent = file.title || "untitled";
      item.setAttribute("data-index", idx);
      item.addEventListener("click", function () {
        activeIndex = idx;
        sidebar
          .querySelectorAll(".file-sidebar-item")
          .forEach(function (el) {
            el.classList.remove("active");
          });
        item.classList.add("active");
        renderDesktopContent(idx);
      });
      sidebar.appendChild(item);
    });

    body.appendChild(sidebar);
    body.appendChild(contentPanel);

    if (files.length > 0) {
      renderDesktopContent(0);
    }

    // --- Mobile layout (accordion) ---
    var mobileDiv = document.createElement("div");
    mobileDiv.className = "mobile-only";

    files.forEach(function (file, idx) {
      var filename = file.title || "untitled";
      var lang = detectLanguage(filename);
      var isMd = MD && MD.isMarkdown(filename);

      var accordionItem = document.createElement("div");
      accordionItem.className = "accordion-item";

      var accordionHeader = document.createElement("div");
      accordionHeader.className = "accordion-header";
      accordionHeader.innerHTML =
        '<span class="text-mono text-sm">' +
        escapeHtml(filename) +
        "</span>" +
        '<span class="accordion-arrow">&#9660;</span>';

      var accordionBody = document.createElement("div");
      accordionBody.className = "accordion-body";
      accordionBody.style.display = "none";

      if (isMd) {
        renderMarkdownPanel(accordionBody, file, lang);
      } else {
        var codeBlock = document.createElement("pre");
        codeBlock.className = "code-content";
        codeBlock.innerHTML =
          '<code class="hljs">' +
          highlightCode(file.content || "", lang) +
          "</code>";
        accordionBody.appendChild(codeBlock);
      }

      accordionHeader.addEventListener("click", function () {
        var isOpen = accordionBody.style.display !== "none";
        accordionBody.style.display = isOpen ? "none" : "";
        accordionHeader.querySelector(".accordion-arrow").innerHTML = isOpen
          ? "&#9660;"
          : "&#9650;";
      });

      accordionItem.appendChild(accordionHeader);
      accordionItem.appendChild(accordionBody);
      mobileDiv.appendChild(accordionItem);
    });

    body.appendChild(mobileDiv);
    viewer.appendChild(body);

    app.innerHTML = "";
    app.appendChild(viewer);
  }

  function attemptDecrypt(passphrase, remember) {
    var S = window.AgentGateShare;
    var encrypted = S ? S.getEncryptedData() : null;
    if (!encrypted) return;

    var P = window.AgentGatePassphrase;
    if (P) P.showDecryptingState();

    window.AgentGateCrypto
      .decrypt(
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt,
        passphrase
      )
      .then(function (plaintext) {
        var data = JSON.parse(plaintext);
        if (remember && P) {
          P.storePassphrase(passphrase);
        }
        if (P) P.hidePassphraseDialog();
        renderFileViewer(data, S.getExpiresAt());
      })
      .catch(function (err) {
        console.error("Decryption failed:", err);
        if (P) {
          P.updatePassphraseError(
            "Decryption failed. Please check your passphrase."
          );
        }
      });
  }

  function init() {
    if (window.AgentGateSettings) {
      window.AgentGateSettings.init();
    }

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

  document.addEventListener("DOMContentLoaded", init);
})();
