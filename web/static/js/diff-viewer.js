(function () {
  "use strict";

  var VIEW_STORAGE_KEY = "agentgate-diff-view";

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

  function highlightLines(code, lang) {
    if (!code) return [];
    var highlighted;
    if (
      lang &&
      typeof hljs !== "undefined" &&
      hljs.getLanguage(lang)
    ) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else if (typeof hljs !== "undefined") {
      highlighted = hljs.highlightAuto(code).value;
    } else {
      highlighted = escapeHtml(code);
    }
    return highlighted.split("\n");
  }

  function parseDiffFiles(files) {
    var combinedPatch = files
      .map(function (f) {
        return f.patch;
      })
      .join("\n");

    if (typeof Diff2Html === "undefined") {
      return [];
    }

    var parsed = Diff2Html.parse(combinedPatch);

    return parsed.map(function (diffFile, idx) {
      var origFile = files[idx] || {};
      var lang =
        origFile.language || detectLanguage(diffFile.newName || diffFile.oldName);
      return {
        filename: diffFile.newName || diffFile.oldName || "unknown",
        language: lang,
        blocks: diffFile.blocks || [],
        addedLines: diffFile.addedLines || 0,
        deletedLines: diffFile.deletedLines || 0,
      };
    });
  }

  function buildSplitLines(lines) {
    var result = [];
    var i = 0;

    while (i < lines.length) {
      var deletions = [];
      while (i < lines.length && lines[i].type === "delete") {
        deletions.push(lines[i]);
        i++;
      }
      var insertions = [];
      while (i < lines.length && lines[i].type === "insert") {
        insertions.push(lines[i]);
        i++;
      }

      if (deletions.length > 0 || insertions.length > 0) {
        var max = Math.max(deletions.length, insertions.length);
        for (var j = 0; j < max; j++) {
          result.push({
            left: deletions[j] || null,
            right: insertions[j] || null,
          });
        }
        continue;
      }

      if (i < lines.length) {
        result.push({
          left: lines[i],
          right: lines[i],
        });
        i++;
      }
    }

    return result;
  }

  function renderUnifiedView(file) {
    var table = document.createElement("table");
    table.className = "diff-table unified";

    var lang = file.language;
    var allContent = [];
    file.blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        allContent.push(line.content.replace(/^[-+ ]/, ""));
      });
    });
    var highlighted = highlightLines(allContent.join("\n"), lang);

    var lineIdx = 0;
    file.blocks.forEach(function (block) {
      var headerRow = document.createElement("tr");
      headerRow.className = "diff-hunk-header";
      headerRow.innerHTML =
        '<td colspan="3" class="text-mono text-sm">' +
        escapeHtml(block.header || "") +
        "</td>";
      table.appendChild(headerRow);

      block.lines.forEach(function (line) {
        var row = document.createElement("tr");
        var typeClass =
          line.type === "insert"
            ? "diff-add"
            : line.type === "delete"
              ? "diff-del"
              : "";
        row.className = typeClass;

        var oldNum = line.type !== "insert" ? line.oldNumber || "" : "";
        var newNum = line.type !== "delete" ? line.newNumber || "" : "";
        var prefix =
          line.type === "insert" ? "+" : line.type === "delete" ? "-" : " ";
        var hl = highlighted[lineIdx] || escapeHtml(line.content.replace(/^[-+ ]/, ""));

        row.innerHTML =
          '<td class="diff-line-num text-mono">' +
          oldNum +
          "</td>" +
          '<td class="diff-line-num text-mono">' +
          newNum +
          "</td>" +
          '<td class="diff-line-content"><span class="diff-prefix">' +
          prefix +
          "</span>" +
          hl +
          "</td>";

        table.appendChild(row);
        lineIdx++;
      });
    });

    return table;
  }

  function renderSplitView(file) {
    var table = document.createElement("table");
    table.className = "diff-table split";

    var lang = file.language;

    var oldContent = [];
    var newContent = [];
    file.blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        if (line.type !== "insert") {
          oldContent.push(line.content.replace(/^[-+ ]/, ""));
        }
        if (line.type !== "delete") {
          newContent.push(line.content.replace(/^[-+ ]/, ""));
        }
      });
    });

    var oldHighlighted = highlightLines(oldContent.join("\n"), lang);
    var newHighlighted = highlightLines(newContent.join("\n"), lang);

    var globalOldIdx = 0;
    var globalNewIdx = 0;

    file.blocks.forEach(function (block) {
      var headerRow = document.createElement("tr");
      headerRow.className = "diff-hunk-header";
      headerRow.innerHTML =
        '<td colspan="4" class="text-mono text-sm">' +
        escapeHtml(block.header || "") +
        "</td>";
      table.appendChild(headerRow);

      var splitLines = buildSplitLines(block.lines);

      splitLines.forEach(function (pair) {
        var row = document.createElement("tr");

        var leftClass = "";
        var rightClass = "";
        var leftNum = "";
        var rightNum = "";
        var leftContent = "";
        var rightContent = "";

        if (pair.left && pair.left.type === "delete") {
          leftClass = "diff-del";
          leftNum = pair.left.oldNumber || "";
          leftContent =
            oldHighlighted[globalOldIdx] ||
            escapeHtml(pair.left.content.replace(/^[-+ ]/, ""));
          globalOldIdx++;
        } else if (pair.left) {
          leftNum = pair.left.oldNumber || "";
          leftContent =
            oldHighlighted[globalOldIdx] ||
            escapeHtml(pair.left.content.replace(/^[-+ ]/, ""));
          globalOldIdx++;
        }

        if (pair.right && pair.right.type === "insert") {
          rightClass = "diff-add";
          rightNum = pair.right.newNumber || "";
          rightContent =
            newHighlighted[globalNewIdx] ||
            escapeHtml(pair.right.content.replace(/^[-+ ]/, ""));
          globalNewIdx++;
        } else if (pair.right) {
          rightNum = pair.right.newNumber || "";
          rightContent =
            newHighlighted[globalNewIdx] ||
            escapeHtml(pair.right.content.replace(/^[-+ ]/, ""));
          globalNewIdx++;
        }

        row.innerHTML =
          '<td class="diff-line-num text-mono ' +
          leftClass +
          '">' +
          leftNum +
          "</td>" +
          '<td class="diff-line-content ' +
          leftClass +
          '">' +
          leftContent +
          "</td>" +
          '<td class="diff-line-num text-mono ' +
          rightClass +
          '">' +
          rightNum +
          "</td>" +
          '<td class="diff-line-content ' +
          rightClass +
          '">' +
          rightContent +
          "</td>";

        table.appendChild(row);
      });
    });

    return table;
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

    // Auto-update every minute
    setInterval(function () {
      var updated = formatRelativeExpiry(expiresAt);
      badge.className = "expiry-badge" + (updated.isWarning ? " expiry-badge--warning" : "");
      badge.innerHTML = '<span class="expiry-dot"></span>' + escapeHtml(updated.text);
    }, 60000);

    return badge;
  }

  function getViewMode() {
    try {
      var stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "unified" || stored === "split") return stored;
    } catch (e) {
      // ignore
    }
    return window.innerWidth > 768 ? "split" : "unified";
  }

  function setViewMode(mode) {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch (e) {
      // ignore
    }
  }

  function renderDiffPage(data, expiresAt) {
    var app = document.getElementById("app");
    if (!app) return;

    var diffFiles = parseDiffFiles(data.files || []);

    var totalAdd = 0;
    var totalDel = 0;
    diffFiles.forEach(function (f) {
      totalAdd += f.addedLines;
      totalDel += f.deletedLines;
    });

    var container = document.createElement("div");
    container.className = "container";
    container.style.paddingTop = "2rem";
    container.style.paddingBottom = "2rem";

    // Header with title, expiry badge, and settings
    var header = document.createElement("div");
    header.style.marginBottom = "1.5rem";
    header.style.display = "flex";
    header.style.alignItems = "flex-start";
    header.style.justifyContent = "space-between";
    header.style.gap = "1rem";

    var headerLeft = document.createElement("div");
    headerLeft.innerHTML =
      '<h1 style="font-size:1.125rem;font-weight:600;margin-bottom:0.375rem">' +
      escapeHtml(data.title || "Untitled") +
      "</h1>";
    headerLeft.appendChild(createExpiryBadge(expiresAt));

    var headerRight = document.createElement("div");
    headerRight.style.flexShrink = "0";
    if (window.AgentGateSettings) {
      window.AgentGateSettings.renderSettingsPanel(headerRight);
    }

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    container.appendChild(header);

    // Summary
    var summary = document.createElement("div");
    summary.className = "diff-summary text-sm text-muted text-mono";
    summary.innerHTML =
      diffFiles.length +
      " files | " +
      '<span class="badge-add">+' +
      totalAdd +
      "</span> " +
      '<span class="badge-del">-' +
      totalDel +
      "</span>";
    container.appendChild(summary);

    // Toolbar
    var currentMode = getViewMode();
    var toolbar = document.createElement("div");
    toolbar.className = "diff-toolbar";

    // View toggle group
    var viewGroup = document.createElement("div");
    viewGroup.className = "diff-toolbar-group";

    var splitBtn = document.createElement("button");
    splitBtn.className = "diff-toolbar-btn" + (currentMode === "split" ? " active" : "");
    splitBtn.textContent = "Split";

    var unifiedBtn = document.createElement("button");
    unifiedBtn.className = "diff-toolbar-btn" + (currentMode === "unified" ? " active" : "");
    unifiedBtn.textContent = "Unified";

    viewGroup.appendChild(splitBtn);
    viewGroup.appendChild(unifiedBtn);
    toolbar.appendChild(viewGroup);

    // Collapse group
    var collapseGroup = document.createElement("div");
    collapseGroup.className = "diff-toolbar-group";

    var expandAllBtn = document.createElement("button");
    expandAllBtn.className = "diff-toolbar-btn";
    expandAllBtn.textContent = "Expand All";

    var collapseAllBtn = document.createElement("button");
    collapseAllBtn.className = "diff-toolbar-btn";
    collapseAllBtn.textContent = "Collapse All";

    collapseGroup.appendChild(expandAllBtn);
    collapseGroup.appendChild(collapseAllBtn);
    toolbar.appendChild(collapseGroup);

    container.appendChild(toolbar);

    // File blocks container
    var filesContainer = document.createElement("div");
    filesContainer.id = "diff-files-container";

    function renderFiles(mode) {
      filesContainer.innerHTML = "";
      diffFiles.forEach(function (file) {
        var fileBlock = document.createElement("div");
        fileBlock.className = "diff-file";

        var fileHeader = document.createElement("div");
        fileHeader.className = "diff-header";

        var arrow = document.createElement("span");
        arrow.className = "diff-collapse-arrow";
        arrow.innerHTML = "&#9660;";

        fileHeader.appendChild(arrow);
        fileHeader.innerHTML +=
          '<span class="text-mono text-sm">' +
          escapeHtml(file.filename) +
          "</span> " +
          '<span class="badge-add">+' +
          file.addedLines +
          "</span> " +
          '<span class="badge-del">-' +
          file.deletedLines +
          "</span>";

        // Re-get arrow reference after innerHTML
        arrow = fileHeader.querySelector(".diff-collapse-arrow");

        fileBlock.appendChild(fileHeader);

        var contentDiv = document.createElement("div");
        contentDiv.className = "diff-file-content";

        if (mode === "unified") {
          contentDiv.appendChild(renderUnifiedView(file));
        } else {
          contentDiv.appendChild(renderSplitView(file));
        }

        fileBlock.appendChild(contentDiv);

        // Collapse toggle
        fileHeader.addEventListener("click", function () {
          var isCollapsed = contentDiv.classList.contains("collapsed");
          contentDiv.classList.toggle("collapsed");
          arrow.classList.toggle("collapsed");
        });

        filesContainer.appendChild(fileBlock);
      });
    }

    renderFiles(currentMode);
    container.appendChild(filesContainer);

    // Toggle handlers
    splitBtn.addEventListener("click", function () {
      splitBtn.classList.add("active");
      unifiedBtn.classList.remove("active");
      currentMode = "split";
      setViewMode("split");
      renderFiles("split");
    });

    unifiedBtn.addEventListener("click", function () {
      unifiedBtn.classList.add("active");
      splitBtn.classList.remove("active");
      currentMode = "unified";
      setViewMode("unified");
      renderFiles("unified");
    });

    expandAllBtn.addEventListener("click", function () {
      filesContainer.querySelectorAll(".diff-file-content").forEach(function (el) {
        el.classList.remove("collapsed");
      });
      filesContainer.querySelectorAll(".diff-collapse-arrow").forEach(function (el) {
        el.classList.remove("collapsed");
      });
    });

    collapseAllBtn.addEventListener("click", function () {
      filesContainer.querySelectorAll(".diff-file-content").forEach(function (el) {
        el.classList.add("collapsed");
      });
      filesContainer.querySelectorAll(".diff-collapse-arrow").forEach(function (el) {
        el.classList.add("collapsed");
      });
    });

    app.innerHTML = "";
    app.appendChild(container);
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
        renderDiffPage(data, getExpiresAt());
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
