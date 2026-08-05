(function () {
  "use strict";

  // Unified-diff renderer, running inside AgentGate's sandbox.
  //
  // Ported from the old web/static/js/diff-viewer.js. Same tables and colours; the
  // difference is that the patch is now parsed and turned into HTML inside an opaque
  // origin with connect-src 'none', instead of on the page holding the decryption key.
  //
  // diff2html is used only to parse the patch — the split/unified tables below are ours,
  // styled by the .diff-* rules in renderer.css.

  var UI = window.AgentGateFrameUI;
  var Frame = UI.frame;
  var escapeHtml = UI.escapeHtml;

  var boot = UI.readBoot();
  var data = boot.payload;

  var LANG_MAP = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", py: "python", go: "go", rs: "rust",
    java: "java", kt: "kotlin", cs: "csharp", cpp: "cpp", c: "c", h: "c", hpp: "cpp",
    css: "css", scss: "scss", less: "less", html: "html", svg: "xml", xml: "xml",
    json: "json", yaml: "yaml", yml: "yaml", toml: "ini", md: "markdown", sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash", php: "php", vue: "xml", svelte: "xml",
    gql: "graphql",
  };

  function detectLanguage(filename) {
    return LANG_MAP[(filename || "").split(".").pop().toLowerCase()] || null;
  }

  function highlightLines(code, lang) {
    if (!code) return [];
    var highlighted;
    if (lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else if (typeof hljs !== "undefined") {
      highlighted = hljs.highlightAuto(code).value;
    } else {
      highlighted = escapeHtml(code);
    }
    return highlighted.split("\n");
  }

  function parseDiffFiles(files) {
    if (typeof Diff2Html === "undefined") return [];
    var combinedPatch = (files || [])
      .map(function (f) {
        return f.patch;
      })
      .join("\n");
    return Diff2Html.parse(combinedPatch).map(function (diffFile, idx) {
      var orig = (files || [])[idx] || {};
      return {
        filename: diffFile.newName || diffFile.oldName || "unknown",
        language: orig.language || detectLanguage(diffFile.newName || diffFile.oldName),
        blocks: diffFile.blocks || [],
        addedLines: diffFile.addedLines || 0,
        deletedLines: diffFile.deletedLines || 0,
      };
    });
  }

  // buildSplitLines pairs a hunk's deletions with its insertions so the two columns line
  // up: runs of deletes and inserts are zipped, context lines appear on both sides.
  function buildSplitLines(lines) {
    var result = [];
    var i = 0;
    while (i < lines.length) {
      var deletions = [];
      while (i < lines.length && lines[i].type === "delete") deletions.push(lines[i++]);
      var insertions = [];
      while (i < lines.length && lines[i].type === "insert") insertions.push(lines[i++]);

      if (deletions.length || insertions.length) {
        var max = Math.max(deletions.length, insertions.length);
        for (var j = 0; j < max; j++) {
          result.push({ left: deletions[j] || null, right: insertions[j] || null });
        }
        continue;
      }
      if (i < lines.length) {
        result.push({ left: lines[i], right: lines[i] });
        i++;
      }
    }
    return result;
  }

  function stripPrefix(content) {
    return String(content || "").replace(/^[-+ ]/, "");
  }

  // addColumns fixes the column widths explicitly.
  //
  // .diff-table is `table-layout: fixed`, which takes its widths from the first row — but
  // the first row is always a hunk header spanning every column, so without a <colgroup>
  // the browser falls back to equal-width columns and the gutters end up as wide as the
  // code. (The pre-sandbox viewer had the same defect.)
  function addColumns(table, widths) {
    var group = document.createElement("colgroup");
    widths.forEach(function (w) {
      var col = document.createElement("col");
      if (w) col.style.width = w;
      group.appendChild(col);
    });
    table.appendChild(group);
  }

  function renderUnifiedView(file) {
    var table = document.createElement("table");
    table.className = "diff-table unified";
    addColumns(table, ["3.5rem", "3.5rem", null]);

    // Highlight the whole file in one pass, then hand out lines: highlight.js needs
    // surrounding context to tokenise correctly, so per-line highlighting is worse.
    var allContent = [];
    file.blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        allContent.push(stripPrefix(line.content));
      });
    });
    var highlighted = highlightLines(allContent.join("\n"), file.language);

    var lineIdx = 0;
    file.blocks.forEach(function (block) {
      var headerRow = document.createElement("tr");
      headerRow.className = "diff-hunk-header";
      headerRow.innerHTML =
        '<td colspan="3" class="text-mono text-sm">' + escapeHtml(block.header || "") + "</td>";
      table.appendChild(headerRow);

      block.lines.forEach(function (line) {
        var row = document.createElement("tr");
        row.className =
          line.type === "insert" ? "diff-add" : line.type === "delete" ? "diff-del" : "";
        var oldNum = line.type !== "insert" ? line.oldNumber || "" : "";
        var newNum = line.type !== "delete" ? line.newNumber || "" : "";
        var prefix = line.type === "insert" ? "+" : line.type === "delete" ? "-" : " ";
        var hl = highlighted[lineIdx] || escapeHtml(stripPrefix(line.content));

        row.innerHTML =
          '<td class="diff-line-num text-mono">' + oldNum + "</td>" +
          '<td class="diff-line-num text-mono">' + newNum + "</td>" +
          '<td class="diff-line-content"><span class="diff-prefix">' + prefix + "</span>" + hl + "</td>";
        table.appendChild(row);
        lineIdx++;
      });
    });
    return table;
  }

  function renderSplitView(file) {
    var table = document.createElement("table");
    table.className = "diff-table split";
    addColumns(table, ["3.5rem", "calc(50% - 3.5rem)", "3.5rem", null]);

    var oldContent = [];
    var newContent = [];
    file.blocks.forEach(function (block) {
      block.lines.forEach(function (line) {
        if (line.type !== "insert") oldContent.push(stripPrefix(line.content));
        if (line.type !== "delete") newContent.push(stripPrefix(line.content));
      });
    });
    var oldHighlighted = highlightLines(oldContent.join("\n"), file.language);
    var newHighlighted = highlightLines(newContent.join("\n"), file.language);

    var oldIdx = 0;
    var newIdx = 0;

    file.blocks.forEach(function (block) {
      var headerRow = document.createElement("tr");
      headerRow.className = "diff-hunk-header";
      headerRow.innerHTML =
        '<td colspan="4" class="text-mono text-sm">' + escapeHtml(block.header || "") + "</td>";
      table.appendChild(headerRow);

      buildSplitLines(block.lines).forEach(function (pair) {
        var row = document.createElement("tr");
        var leftClass = "";
        var rightClass = "";
        var leftNum = "";
        var rightNum = "";
        var leftContent = "";
        var rightContent = "";

        if (pair.left) {
          if (pair.left.type === "delete") leftClass = "diff-del";
          leftNum = pair.left.oldNumber || "";
          leftContent = oldHighlighted[oldIdx] || escapeHtml(stripPrefix(pair.left.content));
          oldIdx++;
        }
        if (pair.right) {
          if (pair.right.type === "insert") rightClass = "diff-add";
          rightNum = pair.right.newNumber || "";
          rightContent = newHighlighted[newIdx] || escapeHtml(stripPrefix(pair.right.content));
          newIdx++;
        }

        row.innerHTML =
          '<td class="diff-line-num text-mono ' + leftClass + '">' + leftNum + "</td>" +
          '<td class="diff-line-content ' + leftClass + '">' + leftContent + "</td>" +
          '<td class="diff-line-num text-mono ' + rightClass + '">' + rightNum + "</td>" +
          '<td class="diff-line-content ' + rightClass + '">' + rightContent + "</td>";
        table.appendChild(row);
      });
    });
    return table;
  }

  // --- state ---------------------------------------------------------------------

  var diffFiles = parseDiffFiles(data.files || []);
  var filesContainer = document.getElementById("ag-diff-files");
  var summary = document.getElementById("ag-summary");
  var splitBtn = document.getElementById("ag-view-split");
  var unifiedBtn = document.getElementById("ag-view-unified");

  // The split/unified choice used to live in this viewer's own localStorage. The frame is
  // opaque-origin and has none, so the host persists it: it arrives in boot.prefs and is
  // written back through the bridge.
  var stored = boot.prefs && boot.prefs["diff-view"];
  var mode = stored === "unified" || stored === "split" ? stored : window.innerWidth > 768 ? "split" : "unified";

  var totalAdd = 0;
  var totalDel = 0;
  diffFiles.forEach(function (f) {
    totalAdd += f.addedLines;
    totalDel += f.deletedLines;
  });
  summary.innerHTML =
    diffFiles.length + " file" + (diffFiles.length === 1 ? "" : "s") + " | " +
    '<span class="badge-add">+' + totalAdd + "</span> " +
    '<span class="badge-del">-' + totalDel + "</span>";

  if (!diffFiles.length) {
    filesContainer.innerHTML =
      '<p class="text-muted text-sm">This diff is empty — nothing was changed.</p>';
    document.getElementById("ag-diff-toolbar").hidden = true;
  }

  function renderFiles() {
    filesContainer.textContent = "";
    diffFiles.forEach(function (file) {
      var fileBlock = document.createElement("div");
      fileBlock.className = "diff-file";

      var fileHeader = document.createElement("div");
      fileHeader.className = "diff-header";
      fileHeader.innerHTML =
        '<span class="diff-collapse-arrow">&#9660;</span>' +
        '<span class="text-mono text-sm">' + escapeHtml(file.filename) + "</span> " +
        '<span class="badge-add">+' + file.addedLines + "</span> " +
        '<span class="badge-del">-' + file.deletedLines + "</span>";
      var arrow = fileHeader.querySelector(".diff-collapse-arrow");
      fileBlock.appendChild(fileHeader);

      var contentDiv = document.createElement("div");
      contentDiv.className = "diff-file-content";
      contentDiv.appendChild(mode === "unified" ? renderUnifiedView(file) : renderSplitView(file));
      fileBlock.appendChild(contentDiv);

      fileHeader.addEventListener("click", function () {
        contentDiv.classList.toggle("collapsed");
        arrow.classList.toggle("collapsed");
        Frame.reportHeight();
      });

      filesContainer.appendChild(fileBlock);
    });
    UI.assignHeadingIds(filesContainer);
    find.refresh();
    Frame.reportHeight();
  }

  function setMode(next) {
    mode = next;
    splitBtn.classList.toggle("active", mode === "split");
    unifiedBtn.classList.toggle("active", mode === "unified");
    Frame.savePref("diff-view", mode);
    renderFiles();
  }

  function setCollapsedAll(collapsed) {
    Array.prototype.forEach.call(filesContainer.querySelectorAll(".diff-file-content"), function (el) {
      el.classList.toggle("collapsed", collapsed);
    });
    Array.prototype.forEach.call(filesContainer.querySelectorAll(".diff-collapse-arrow"), function (el) {
      el.classList.toggle("collapsed", collapsed);
    });
    Frame.reportHeight();
  }

  var find = UI.createFind({
    root: function () {
      return filesContainer;
    },
    // A collapsed file still matches; say so rather than reporting "no matches" when the
    // hit is simply hidden.
    otherMatches: function (query) {
      var needle = query.toLowerCase();
      return Array.prototype.filter.call(
        filesContainer.querySelectorAll(".diff-file"),
        function (el) {
          var content = el.querySelector(".diff-file-content");
          return (
            content &&
            content.classList.contains("collapsed") &&
            (el.textContent || "").toLowerCase().indexOf(needle) !== -1
          );
        }
      ).length;
    },
  });

  splitBtn.addEventListener("click", function () {
    setMode("split");
  });
  unifiedBtn.addEventListener("click", function () {
    setMode("unified");
  });
  document.getElementById("ag-expand-all").addEventListener("click", function () {
    setCollapsedAll(false);
  });
  document.getElementById("ag-collapse-all").addEventListener("click", function () {
    setCollapsedAll(true);
  });

  // Printing must show everything, including files the reader had collapsed.
  Frame.onPrintScope = function () {
    setCollapsedAll(false);
  };

  Frame.onHash = function (hash) {
    UI.scrollToHash(hash);
  };

  UI.wireAnchors(filesContainer);

  splitBtn.classList.toggle("active", mode === "split");
  unifiedBtn.classList.toggle("active", mode === "unified");
  if (diffFiles.length) renderFiles();
  if (boot.hash) UI.scrollToHash(boot.hash);
})();
