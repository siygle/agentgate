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

  function formatRelativeExpiry(expiresAt) {
    if (!expiresAt) return { text: "", isWarning: false };
    try {
      var now = Date.now();
      var exp = new Date(expiresAt).getTime();
      var diff = exp - now;
      if (diff <= 0) return { text: "Expired", isWarning: true };
      var minutes = Math.floor(diff / 60000);
      var hours = Math.floor(minutes / 60);
      var remainMinutes = minutes % 60;
      var text;
      if (hours > 0) {
        text = hours + "h " + remainMinutes + "m remaining";
      } else {
        text = minutes + "m remaining";
      }
      return { text: text, isWarning: minutes < 60 };
    } catch (e) {
      return { text: expiresAt, isWarning: false };
    }
  }

  function createExpiryBadge(expiresAt) {
    var info = formatRelativeExpiry(expiresAt);
    var badge = document.createElement("span");
    badge.className = "expiry-badge" + (info.isWarning ? " expiry-badge--warning" : "");
    badge.innerHTML = '<span class="expiry-dot"></span>' + escapeHtml(info.text);

    setInterval(function () {
      var updated = formatRelativeExpiry(expiresAt);
      badge.className = "expiry-badge" + (updated.isWarning ? " expiry-badge--warning" : "");
      badge.innerHTML = '<span class="expiry-dot"></span>' + escapeHtml(updated.text);
    }, 60000);

    return badge;
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
    headerLeft.appendChild(createExpiryBadge(expiresAt));

    var headerRight = document.createElement("div");
    headerRight.style.flexShrink = "0";
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
        var tabBar = document.createElement("div");
        tabBar.className = "tab-bar";

        var sourceTab = document.createElement("button");
        sourceTab.className = "tab active";
        sourceTab.textContent = "Source";

        var previewTab = document.createElement("button");
        previewTab.className = "tab";
        previewTab.textContent = "Preview";

        tabBar.appendChild(sourceTab);
        tabBar.appendChild(previewTab);
        contentPanel.appendChild(tabBar);

        var sourcePane = document.createElement("pre");
        sourcePane.className = "code-content";
        sourcePane.innerHTML =
          '<code class="hljs">' +
          highlightCode(file.content || "", lang) +
          "</code>";
        contentPanel.appendChild(sourcePane);

        var previewPane = document.createElement("div");
        previewPane.className = "markdown-body";
        previewPane.style.display = "none";
        previewPane.innerHTML = MD.renderMarkdown(file.content || "");
        contentPanel.appendChild(previewPane);

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
        var tabBar = document.createElement("div");
        tabBar.className = "tab-bar";

        var sourceTab = document.createElement("button");
        sourceTab.className = "tab active";
        sourceTab.textContent = "Source";

        var previewTab = document.createElement("button");
        previewTab.className = "tab";
        previewTab.textContent = "Preview";

        tabBar.appendChild(sourceTab);
        tabBar.appendChild(previewTab);
        accordionBody.appendChild(tabBar);

        var sourcePane = document.createElement("pre");
        sourcePane.className = "code-content";
        sourcePane.innerHTML =
          '<code class="hljs">' +
          highlightCode(file.content || "", lang) +
          "</code>";
        accordionBody.appendChild(sourcePane);

        var previewPane = document.createElement("div");
        previewPane.className = "markdown-body";
        previewPane.style.display = "none";
        previewPane.innerHTML = MD.renderMarkdown(file.content || "");
        accordionBody.appendChild(previewPane);

        (function (st, pt, sp, pp) {
          st.addEventListener("click", function () {
            st.className = "tab active";
            pt.className = "tab";
            sp.style.display = "";
            pp.style.display = "none";
          });
          pt.addEventListener("click", function () {
            pt.className = "tab active";
            st.className = "tab";
            sp.style.display = "none";
            pp.style.display = "";
          });
        })(sourceTab, previewTab, sourcePane, previewPane);
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

  function getEncryptedData() {
    var el = document.getElementById("encrypted-data");
    if (!el) return null;
    var val = el.getAttribute("data-value");
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch (e) {
      return null;
    }
  }

  function getExpiresAt() {
    var el = document.getElementById("expires-at");
    if (!el) return null;
    return el.getAttribute("data-value") || "";
  }

  function attemptDecrypt(passphrase, remember) {
    var encrypted = getEncryptedData();
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
        renderFileViewer(data, getExpiresAt());
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

    var encrypted = getEncryptedData();
    if (!encrypted) return;

    var P = window.AgentGatePassphrase;
    if (!P) return;

    var stored = P.getStoredPassphrase();
    if (stored) {
      P.showPassphraseDialog(attemptDecrypt, { isDecrypting: true });
      attemptDecrypt(stored, true);
    } else {
      P.showPassphraseDialog(attemptDecrypt);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
