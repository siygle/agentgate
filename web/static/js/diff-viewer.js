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
      // Collect consecutive deletions
      var deletions = [];
      while (i < lines.length && lines[i].type === "delete") {
        deletions.push(lines[i]);
        i++;
      }
      // Collect consecutive insertions
      var insertions = [];
      while (i < lines.length && lines[i].type === "insert") {
        insertions.push(lines[i]);
        i++;
      }

      // Pair deletions with insertions
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

      // Context line
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

  function getAllLinesContent(blocks, type) {
    var content = [];
    blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        if (type === "old" && line.type !== "insert") {
          content.push(line.content.replace(/^[-+ ]/, ""));
        } else if (type === "new" && line.type !== "delete") {
          content.push(line.content.replace(/^[-+ ]/, ""));
        } else if (type === "all") {
          content.push(line.content.replace(/^[-+ ]/, ""));
        }
      });
    });
    return content.join("\n");
  }

  function renderUnifiedView(file) {
    var table = document.createElement("table");
    table.className = "diff-table unified";

    var lang = file.language;
    // Build full content for highlighting
    var allContent = [];
    file.blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        allContent.push(line.content.replace(/^[-+ ]/, ""));
      });
    });
    var highlighted = highlightLines(allContent.join("\n"), lang);

    var lineIdx = 0;
    file.blocks.forEach(function (block) {
      // Block header
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

    // Build old and new content separately for highlighting
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

    file.blocks.forEach(function (block) {
      // Block header
      var headerRow = document.createElement("tr");
      headerRow.className = "diff-hunk-header";
      headerRow.innerHTML =
        '<td colspan="4" class="text-mono text-sm">' +
        escapeHtml(block.header || "") +
        "</td>";
      table.appendChild(headerRow);

      var splitLines = buildSplitLines(block.lines);
      var oldIdx = 0;
      var newIdx = 0;

      // Reset counters per block for highlighting indexing
      // We need global counters, so track them across blocks
    });

    // Re-do with global counters
    table.innerHTML = "";
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
          leftNum =
            pair.left.oldNumber || "";
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
          rightNum =
            pair.right.newNumber || "";
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

  function formatExpiresAt(expiresAt) {
    if (!expiresAt) return "";
    try {
      var d = new Date(expiresAt);
      return d.toLocaleString();
    } catch (e) {
      return expiresAt;
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

    // Title section
    var header = document.createElement("div");
    header.style.marginBottom = "1.5rem";
    header.innerHTML =
      '<h1 style="font-size:1.125rem;font-weight:600">' +
      escapeHtml(data.title || "Untitled") +
      "</h1>" +
      '<p class="text-sm text-muted text-mono">Expires ' +
      escapeHtml(formatExpiresAt(expiresAt)) +
      "</p>";
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

    // File blocks
    diffFiles.forEach(function (file) {
      var fileBlock = document.createElement("div");
      fileBlock.className = "diff-file";

      var fileHeader = document.createElement("div");
      fileHeader.className = "diff-header";
      fileHeader.innerHTML =
        '<span class="text-mono text-sm">' +
        escapeHtml(file.filename) +
        "</span> " +
        '<span class="badge-add">+' +
        file.addedLines +
        "</span> " +
        '<span class="badge-del">-' +
        file.deletedLines +
        "</span>";
      fileBlock.appendChild(fileHeader);

      // Mobile unified view
      var mobileDiv = document.createElement("div");
      mobileDiv.className = "mobile-only";
      mobileDiv.appendChild(renderUnifiedView(file));
      fileBlock.appendChild(mobileDiv);

      // Desktop split view
      var desktopDiv = document.createElement("div");
      desktopDiv.className = "desktop-only";
      desktopDiv.appendChild(renderSplitView(file));
      fileBlock.appendChild(desktopDiv);

      container.appendChild(fileBlock);
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

    var P = window.DiffminiPassphrase;
    if (P) P.showDecryptingState();

    window.DiffminiCrypto
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
    var encrypted = getEncryptedData();
    if (!encrypted) return;

    var P = window.DiffminiPassphrase;
    if (!P) return;

    var stored = P.getStoredPassphrase();
    if (stored) {
      // Auto-decrypt with stored passphrase
      P.showPassphraseDialog(attemptDecrypt, { isDecrypting: true });
      attemptDecrypt(stored, true);
    } else {
      P.showPassphraseDialog(attemptDecrypt);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
