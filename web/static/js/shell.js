(function () {
  "use strict";

  // AgentGateShell is the host chrome around a sandboxed renderer.
  //
  // Division of labour: the shell decrypts the share, decides which built-in renderer to
  // run, and owns everything *outside* the frame — header, expiry badge, owner toggle,
  // display settings, export, feedback notes, and the address bar. It never looks at the
  // decrypted content beyond picking a renderer and counting files, because this page
  // holds the decryption key, the remembered passphrase, and possibly an admin session
  // cookie. Interpreting content happens in the frame.

  function t(key, vars, fallback) {
    if (window.AgentGateI18n && window.AgentGateI18n.t) {
      return window.AgentGateI18n.t(key, vars);
    }
    return fallback != null ? fallback : key;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function row(gap) {
    var node = el("div");
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.gap = gap || "0.75rem";
    return node;
  }

  // --- feedback & review notes -------------------------------------------------------
  // Local-only review notes + inline diff/doc review state, kept on the host: the frame
  // runs in an opaque origin and has no localStorage at all.

  function feedbackKey(shareId) {
    return "agentgate-plan-feedback-" + shareId;
  }

  function reviewKey(shareId) {
    return "agentgate-review:" + shareId;
  }

  function loadFeedback(shareId) {
    try {
      return JSON.parse(localStorage.getItem(feedbackKey(shareId)) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveFeedback(shareId, items) {
    try {
      localStorage.setItem(feedbackKey(shareId), JSON.stringify(items));
    } catch (e) {
      // ignore
    }
  }

  function loadReviewState(shareId) {
    try {
      var raw = JSON.parse(localStorage.getItem(reviewKey(shareId)) || "null");
      if (raw && typeof raw === "object") {
        return {
          viewed: raw.viewed && typeof raw.viewed === "object" ? raw.viewed : {},
          comments: Array.isArray(raw.comments) ? raw.comments : [],
        };
      }
    } catch (e) {
      // ignore
    }
    return { viewed: {}, comments: [] };
  }

  function saveReviewState(shareId, state) {
    try {
      localStorage.setItem(reviewKey(shareId), JSON.stringify(state));
    } catch (e) {
      // ignore
    }
  }

  function formatInlineLocation(c) {
    if (c.line != null && c.line !== "") {
      return (c.file || "file") + ":" + c.line + (c.side ? " (" + c.side + ")" : "");
    }
    if (c.section) {
      return (c.file || "document") + " § " + c.section;
    }
    return c.file || "note";
  }

  function createFeedbackPanel(shareId, titleText, opts) {
    opts = opts || {};
    var items = loadFeedback(shareId);
    var reviewState = opts.initialReview || { viewed: {}, comments: [] };

    var aside = el("aside", "plan-feedback collapsed");
    var header = el("div", "plan-feedback-toggle");
    var titleWrap = row("0.5rem");
    var titleKey = opts.isReview ? "review.title" : "feedback.title";
    var titleEl = el("span", null, t(titleKey, null, opts.isReview ? "Review" : "Chat / Feedback"));
    titleEl.setAttribute("data-i18n", titleKey);
    var countBadge = el("span", "shell-badge", "");
    countBadge.hidden = true;
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(countBadge);
    header.appendChild(titleWrap);
    header.appendChild(el("span", "plan-feedback-chevron", "▲"));
    header.addEventListener("click", function () {
      aside.classList.toggle("collapsed");
    });
    aside.appendChild(header);

    var content = el("div", "plan-feedback-content");
    var hintEl = el(
      "p",
      "plan-feedback-hint",
      t(
        opts.isReview ? "review.noComments" : "feedback.hint",
        null,
        opts.isReview
          ? "Click any diff line number or document heading to add an inline comment."
          : "Local-only notes for now. Copy them back to your agent after review."
      )
    );
    hintEl.setAttribute("data-i18n", opts.isReview ? "review.noComments" : "feedback.hint");
    content.appendChild(hintEl);

    var inlineSection = el("div", "plan-feedback-inline");
    var list = el("div", "plan-feedback-list");

    function updateBadge() {
      var total = items.length + (reviewState.comments ? reviewState.comments.length : 0);
      countBadge.textContent = String(total);
      countBadge.hidden = total === 0;
    }

    function redraw() {
      inlineSection.textContent = "";
      var inlineComments = Array.isArray(reviewState.comments) ? reviewState.comments : [];
      if (inlineComments.length) {
        var inlineHead = el("div", "plan-feedback-subhead", t("review.inlineComments", null, "Inline comments"));
        inlineSection.appendChild(inlineHead);
        inlineComments.forEach(function (c) {
          var wrap = el("div", "plan-feedback-item");
          wrap.appendChild(el("div", "plan-feedback-meta text-mono", formatInlineLocation(c)));
          wrap.appendChild(el("div", null, c.text || ""));
          inlineSection.appendChild(wrap);
        });
      }

      list.textContent = "";
      if (items.length && inlineComments.length) {
        list.appendChild(el("div", "plan-feedback-subhead", t("review.generalNotes", null, "General notes")));
      }
      items.forEach(function (item, idx) {
        var wrap = el("div", "plan-feedback-item");
        wrap.appendChild(el("div", "plan-feedback-meta", "#" + (idx + 1) + " · " + item.created_at));
        wrap.appendChild(el("div", null, item.text));
        list.appendChild(wrap);
      });
      updateBadge();
    }

    var ta = el("textarea", "form-input plan-feedback-input");
    ta.placeholder = t("feedback.placeholder", null, "Leave feedback, questions, or change requests...");
    ta.setAttribute("data-i18n-placeholder", "feedback.placeholder");

    var actions = el("div", "plan-feedback-actions");

    var add = el("button", "btn", t("feedback.add", null, "Add"));
    add.type = "button";
    add.setAttribute("data-i18n", "feedback.add");
    add.addEventListener("click", function () {
      var text = (ta.value || "").trim();
      if (!text) return;
      items.push({ text: text, created_at: new Date().toLocaleString() });
      saveFeedback(shareId, items);
      ta.value = "";
      redraw();
    });

    var copy = el("button", "btn", t("feedback.copyForAgent", null, "Copy for agent"));
    copy.type = "button";
    copy.setAttribute("data-i18n", "feedback.copyForAgent");
    copy.addEventListener("click", function () {
      var blocks = [t("feedback.copyHeader", { title: titleText }, "Feedback for " + titleText)];
      var inlineComments = Array.isArray(reviewState.comments) ? reviewState.comments : [];
      if (inlineComments.length) {
        blocks.push(
          "### " +
            t("review.inlineComments", null, "Inline comments") +
            "\n" +
            inlineComments
              .map(function (c) {
                return "- `" + formatInlineLocation(c) + "`: " + (c.text || "");
              })
              .join("\n")
        );
      }
      if (items.length) {
        blocks.push(
          "### " +
            t("review.generalNotes", null, "General notes") +
            "\n" +
            items
              .map(function (item, i) {
                return i + 1 + ". " + item.text;
              })
              .join("\n")
        );
      }
      var text = blocks.join("\n\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      copy.textContent = t("common.copied", null, "Copied");
      setTimeout(function () {
        copy.textContent = t("feedback.copyForAgent", null, "Copy for agent");
      }, 1200);
    });

    actions.appendChild(add);
    actions.appendChild(copy);
    content.appendChild(inlineSection);
    content.appendChild(list);
    content.appendChild(ta);
    content.appendChild(actions);
    aside.appendChild(content);
    redraw();

    return {
      node: aside,
      setReviewState: function (next) {
        reviewState = next || { viewed: {}, comments: [] };
        redraw();
      },
    };
  }

  // --- host-bridged persistent storage (client-only localStorage) --------------------
  // Namespaced per share & scope so framed code can never touch AgentGate's own keys
  // (passphrases, settings, prefs). Zero server writes keeps the zero-knowledge guarantee
  // intact across both Go self-host and Cloudflare Workers deployments.

  var MAX_STORE_KEYS_PER_SCOPE = 200;

  function storagePrefix(shareId, shared) {
    return "agentgate-art-store:" + shareId + ":" + (shared ? "shared:" : "user:");
  }

  function handleStorageRequest(shareId, req) {
    try {
      if (typeof localStorage === "undefined") {
        return { id: req.id, ok: false, error: "Browser localStorage is unavailable." };
      }
      var prefix = storagePrefix(shareId, !!req.shared);
      if (req.op === "get") {
        var val = localStorage.getItem(prefix + req.key);
        return {
          id: req.id,
          ok: true,
          result: val === null ? null : { key: req.key, value: val, shared: !!req.shared },
        };
      }
      if (req.op === "set") {
        var fullKey = prefix + req.key;
        if (localStorage.getItem(fullKey) === null) {
          var count = 0;
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) count++;
          }
          if (count >= MAX_STORE_KEYS_PER_SCOPE) {
            return { id: req.id, ok: false, error: "Storage key limit (" + MAX_STORE_KEYS_PER_SCOPE + ") reached." };
          }
        }
        localStorage.setItem(fullKey, req.value);
        return {
          id: req.id,
          ok: true,
          result: { key: req.key, value: req.value, shared: !!req.shared },
        };
      }
      if (req.op === "delete") {
        localStorage.removeItem(prefix + req.key);
        return {
          id: req.id,
          ok: true,
          result: { key: req.key, deleted: true, shared: !!req.shared },
        };
      }
      if (req.op === "list") {
        var matchPrefix = prefix + (req.prefix || "");
        var keys = [];
        for (var j = 0; j < localStorage.length; j++) {
          var lk = localStorage.key(j);
          if (lk && lk.indexOf(matchPrefix) === 0) {
            keys.push(lk.slice(prefix.length));
          }
        }
        keys.sort();
        return {
          id: req.id,
          ok: true,
          result: { keys: keys, prefix: req.prefix || "", shared: !!req.shared },
        };
      }
      return { id: req.id, ok: false, error: "Unsupported storage operation" };
    } catch (e) {
      return { id: req.id, ok: false, error: e && e.message ? e.message : "Storage error" };
    }
  }

  // --- diagnostics drawer (runtime errors & console warn/error) ----------------------

  function createDiagnosticsUI(headerRight, viewer, showByDefault) {
    var entries = [];
    var errorCount = 0;
    var warnCount = 0;
    var open = false;

    var trigger = el("button", "btn btn-sm shell-diag-trigger");
    trigger.type = "button";
    trigger.hidden = !showByDefault;
    trigger.title = t("artifact.diagnosticsTitle", null, "Runtime errors and console warnings");
    trigger.setAttribute("data-i18n-title", "artifact.diagnosticsTitle");
    var triggerLabel = el("span", null, t("artifact.diagnostics", null, "Console"));
    triggerLabel.setAttribute("data-i18n", "artifact.diagnostics");
    var triggerBadge = el("span", "shell-badge", "");
    triggerBadge.hidden = true;
    trigger.appendChild(triggerLabel);
    trigger.appendChild(triggerBadge);
    headerRight.appendChild(trigger);

    var drawer = el("section", "shell-diag-drawer");
    drawer.hidden = true;

    var head = el("div", "shell-diag-head");
    var headTitle = el("strong", null, t("artifact.diagnostics", null, "Console"));
    headTitle.setAttribute("data-i18n", "artifact.diagnostics");
    var headActions = row("0.375rem");

    var copyBtn = el("button", "btn btn-sm", t("artifact.diagCopy", null, "Copy for agent"));
    copyBtn.type = "button";
    copyBtn.setAttribute("data-i18n", "artifact.diagCopy");
    copyBtn.addEventListener("click", function () {
      var text = entries
        .map(function (e) {
          var loc = e.source ? " (" + e.source + (e.line ? ":" + e.line : "") + ")" : "";
          return "[" + e.level.toUpperCase() + " " + e.time + "] " + e.message + loc + (e.stack ? "\n" + e.stack : "");
        })
        .join("\n\n");
      if (navigator.clipboard && text) navigator.clipboard.writeText(text);
      copyBtn.textContent = t("common.copied", null, "Copied");
      setTimeout(function () {
        copyBtn.textContent = t("artifact.diagCopy", null, "Copy for agent");
      }, 1200);
    });

    var clearBtn = el("button", "btn btn-sm", t("artifact.diagClear", null, "Clear"));
    clearBtn.type = "button";
    clearBtn.setAttribute("data-i18n", "artifact.diagClear");

    var closeBtn = el("button", "btn btn-sm", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t("common.close", null, "Close"));
    closeBtn.addEventListener("click", function () {
      open = false;
      drawer.hidden = true;
      trigger.classList.remove("active");
    });

    headActions.appendChild(copyBtn);
    headActions.appendChild(clearBtn);
    headActions.appendChild(closeBtn);
    head.appendChild(headTitle);
    head.appendChild(headActions);

    var body = el("div", "shell-diag-body");
    drawer.appendChild(head);
    drawer.appendChild(body);
    viewer.appendChild(drawer);

    function sync() {
      var total = errorCount + warnCount;
      triggerBadge.textContent = String(total);
      triggerBadge.hidden = total === 0;
      triggerBadge.className = "shell-badge" + (errorCount > 0 ? " shell-badge--error" : warnCount > 0 ? " shell-badge--warn" : "");
      if (total > 0) trigger.hidden = false;

      body.textContent = "";
      if (!entries.length) {
        var empty = el("div", "shell-diag-empty", t("artifact.diagEmpty", null, "No errors or warnings recorded."));
        empty.setAttribute("data-i18n", "artifact.diagEmpty");
        body.appendChild(empty);
        return;
      }
      entries.forEach(function (entry) {
        var rowEl = el("div", "shell-diag-entry shell-diag-entry--" + entry.level);
        var top = el("div", "shell-diag-entry-top");
        top.appendChild(el("span", "shell-diag-level", entry.level.toUpperCase()));
        top.appendChild(el("span", "shell-diag-time", entry.time));
        if (entry.source) {
          top.appendChild(el("span", "shell-diag-source text-mono", entry.source + (entry.line ? ":" + entry.line : "")));
        }
        rowEl.appendChild(top);
        rowEl.appendChild(el("div", "shell-diag-msg text-mono", entry.message));
        if (entry.stack) {
          var pre = el("pre", "shell-diag-stack text-mono", entry.stack);
          rowEl.appendChild(pre);
        }
        body.appendChild(rowEl);
      });
    }

    function push(level, message, meta) {
      meta = meta || {};
      entries.push({
        level: level,
        message: String(message || ""),
        source: meta.source || "",
        line: meta.line || 0,
        stack: meta.stack || "",
        time: new Date().toLocaleTimeString(),
      });
      if (entries.length > 200) entries.shift();
      if (level === "error") errorCount++;
      else if (level === "warn") warnCount++;
      sync();
    }

    clearBtn.addEventListener("click", function () {
      entries = [];
      errorCount = 0;
      warnCount = 0;
      sync();
    });

    trigger.addEventListener("click", function () {
      open = !open;
      drawer.hidden = !open;
      trigger.classList.toggle("active", open);
    });

    document.addEventListener("keydown", function (ev) {
      if (open && ev.key === "Escape") {
        open = false;
        drawer.hidden = true;
        trigger.classList.remove("active");
      }
    });

    sync();

    return {
      pushError: function (err) {
        push("error", err.message, { source: err.source, line: err.line, stack: err.stack });
      },
      pushLog: function (log) {
        var lvl = log.level === "error" ? "error" : log.level === "warn" ? "warn" : "log";
        push(lvl, log.text);
      },
      clear: function () {
        entries = [];
        errorCount = 0;
        warnCount = 0;
        sync();
      },
    };
  }

  // --- artifact/webapp source inspector + live edit & reload -------------------------

  function createSourceInspector(headerRight, workspace, origFiles, onReload) {
    var textFiles = origFiles.filter(function (f) {
      return f.encoding !== "base64";
    });
    if (!textFiles.length) return null;

    var workingFiles = origFiles.map(function (f) {
      return Object.assign({}, f);
    });
    var activeTitle = textFiles[0].title || "";
    var isOpen = false;

    var toggleBtn = el("button", "btn btn-sm shell-code-trigger", "</> " + t("artifact.codeBtn", null, "Code"));
    toggleBtn.type = "button";
    toggleBtn.title = t("artifact.codeTitle", null, "Inspect and live-edit source files");
    toggleBtn.setAttribute("data-i18n-title", "artifact.codeTitle");
    headerRight.appendChild(toggleBtn);

    var panel = el("aside", "shell-inspector");
    panel.hidden = true;

    var bar = el("div", "shell-inspector-bar");
    var tabs = el("div", "shell-inspector-tabs");
    var controls = row("0.375rem");

    var runBtn = el("button", "btn btn-sm btn-primary", t("artifact.runReload", null, "Run / Reload"));
    runBtn.type = "button";
    runBtn.setAttribute("data-i18n", "artifact.runReload");

    var resetBtn = el("button", "btn btn-sm", t("artifact.resetCode", null, "Reset"));
    resetBtn.type = "button";
    resetBtn.setAttribute("data-i18n", "artifact.resetCode");

    controls.appendChild(runBtn);
    controls.appendChild(resetBtn);
    bar.appendChild(tabs);
    bar.appendChild(controls);

    var editor = document.createElement("textarea");
    editor.className = "shell-inspector-editor text-mono";
    editor.spellcheck = false;
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocomplete", "off");

    var hint = el("div", "shell-inspector-hint", t("artifact.editedHint", null, "Local in-memory edits only (not uploaded)."));
    hint.setAttribute("data-i18n", "artifact.editedHint");

    panel.appendChild(bar);
    panel.appendChild(editor);
    panel.appendChild(hint);
    workspace.appendChild(panel);

    function findWorking(title) {
      for (var i = 0; i < workingFiles.length; i++) {
        if ((workingFiles[i].title || "") === title) return workingFiles[i];
      }
      return null;
    }

    function commitCurrent() {
      var cur = findWorking(activeTitle);
      if (cur && cur.encoding !== "base64") {
        cur.content = editor.value;
      }
    }

    function renderTabs() {
      tabs.textContent = "";
      workingFiles.forEach(function (f) {
        if (f.encoding === "base64") return;
        var b = el("button", "shell-inspector-tab" + ((f.title || "") === activeTitle ? " active" : ""), f.title || "untitled");
        b.type = "button";
        b.addEventListener("click", function () {
          commitCurrent();
          activeTitle = f.title || "";
          loadActive();
        });
        tabs.appendChild(b);
      });
    }

    function loadActive() {
      var cur = findWorking(activeTitle);
      editor.value = cur ? String(cur.content || "") : "";
      renderTabs();
    }

    function triggerReload() {
      commitCurrent();
      runBtn.disabled = true;
      Promise.resolve(onReload(workingFiles)).finally(function () {
        runBtn.disabled = false;
      });
    }

    runBtn.addEventListener("click", triggerReload);

    resetBtn.addEventListener("click", function () {
      workingFiles = origFiles.map(function (f) {
        return Object.assign({}, f);
      });
      loadActive();
      triggerReload();
    });

    editor.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        triggerReload();
        return;
      }
      if (ev.key === "Tab") {
        ev.preventDefault();
        var s = editor.selectionStart;
        var e = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + "  " + editor.value.slice(e);
        editor.selectionStart = editor.selectionEnd = s + 2;
      }
    });

    toggleBtn.addEventListener("click", function () {
      isOpen = !isOpen;
      panel.hidden = !isOpen;
      workspace.classList.toggle("shell-workspace--split", isOpen);
      toggleBtn.classList.toggle("active", isOpen);
      if (isOpen) loadActive();
    });

    return {
      getFiles: function () {
        commitCurrent();
        return workingFiles;
      },
      updateLabel: function () {
        toggleBtn.textContent = "</> " + t("artifact.codeBtn", null, "Code");
      },
    };
  }

  // --- standalone open / save --------------------------------------------------------

  // The assembled document is fully self-contained (every asset inlined), so it can be
  // opened on its own or saved as a single file. This is also the answer to the things an
  // iframe makes awkward: open it standalone and the browser's own find, zoom, and print
  // behave normally.
  function createStandaloneControls(handle, filenameBase) {
    var wrap = row("0.375rem");

    var open = el("button", "btn btn-icon", "↗");
    open.type = "button";
    open.setAttribute("data-i18n-title", "standalone.openTitle");
    open.setAttribute("data-i18n-aria-label", "standalone.openAria");
    open.title = t("standalone.openTitle", null, "Open in a new tab (standalone, no network access)");
    open.setAttribute("aria-label", t("standalone.openAria", null, "Open in a new tab"));
    open.addEventListener("click", function () {
      var url = handle.objectURL();
      var win = window.open(url, "_blank");
      // Revoking immediately would race the new tab's load.
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 60000);
      if (!win) open.title = t("standalone.popupBlocked", null, "Popup blocked — allow popups to open standalone");
    });

    var save = el("button", "btn btn-icon", "⤓");
    save.type = "button";
    save.setAttribute("data-i18n-title", "standalone.saveTitle");
    save.setAttribute("data-i18n-aria-label", "standalone.saveAria");
    save.title = t("standalone.saveTitle", null, "Save as a single self-contained .html file");
    save.setAttribute("aria-label", t("standalone.saveAria", null, "Save as HTML"));
    save.addEventListener("click", function () {
      var url = handle.objectURL();
      var a = document.createElement("a");
      a.href = url;
      a.download = (filenameBase || "agentgate").replace(/[^\w.-]+/g, "_").slice(0, 80) + ".html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    });

    wrap.appendChild(open);
    wrap.appendChild(save);
    return wrap;
  }

  // --- main ---------------------------------------------------------------------------

  // prefKey namespaces a renderer view preference the frame asked the host to remember
  // (e.g. the diff's split/unified choice). Per renderer, not per share: the choice is
  // about how you like to read, not about this particular diff.
  function prefKey(renderer, key) {
    return "agentgate-pref:" + renderer + ":" + key;
  }

  function loadPrefs(renderer) {
    var out = {};
    try {
      var prefix = prefKey(renderer, "");
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) out[k.slice(prefix.length)] = localStorage.getItem(k);
      }
    } catch (e) {
      // private mode: no stored preferences, defaults apply
    }
    return out;
  }

  // render mounts share content: either a built-in renderer, or the bundle's own
  // index.html when config.webapp is set.
  //
  // config:
  //   renderer   name of the directory under /static/renderers/ (omit for webapp)
  //   webapp     true to run the payload's own index.html instead
  //   label      header text describing the share
  //   title      display title, also the export filename base
  //   features   optional renderer features to enable (e.g. { mdx: true })
  //   allowEval  whether the frame needs 'unsafe-eval' (MDX compilation does)
  //   feedback   show the review-notes panel
  //   exportKind value for the export control's `kind`
  function render(data, expiresAt, config) {
    var app = document.getElementById("app");
    var Sandbox = window.AgentGateSandbox;
    if (!app) return;
    if (!Sandbox) {
      app.textContent = t("share.sandboxUnavailable", null, "Sandbox unavailable — sandbox.js failed to load.");
      return;
    }

    var files = data.files || [];
    var shareId = window.AgentGateShare ? window.AgentGateShare.getShareId() : "unknown";
    var isFixed = !!(config.webapp || config.fixed);

    // Uploaded webapps and interactive artifacts keep a viewport-height frame (see
    // .shell-viewer--fixed); document/diff/file renderers grow to their content instead.
    var viewer = el("div", "shell-viewer" + (isFixed ? " shell-viewer--fixed" : ""));
    var headerEl = el("header", "file-viewer-header");
    var headerLeft = row();
    var headerRight = row();
    headerRight.style.flexShrink = "0";

    var labelEl = el("span", null, config.label);
    function updateHeaderLabel() {
      if (!config.labelKey) return;
      var vars = Object.assign({}, config.labelVars || {});
      if (Object.prototype.hasOwnProperty.call(vars, "title") && !vars.title) {
        vars.title = t("common.untitled", null, "untitled");
      }
      labelEl.textContent = t(config.labelKey, vars, config.label);
    }
    updateHeaderLabel();
    headerLeft.appendChild(labelEl);

    var Expiry = window.AgentGateExpiry;
    var meta = Expiry ? Expiry.getShareMeta() : null;
    var badgeHandle = Expiry ? Expiry.createExpiryBadge(expiresAt, meta && meta.neverExpires) : null;
    if (badgeHandle) headerLeft.appendChild(badgeHandle.node);
    if (badgeHandle && meta && Expiry) {
      var toggle = Expiry.createOwnerToggle(meta, badgeHandle);
      if (toggle) headerRight.appendChild(toggle);
    }

    headerEl.appendChild(headerLeft);
    headerEl.appendChild(headerRight);
    viewer.appendChild(headerEl);

    var workspace = el("div", "shell-workspace");
    var frameHost = el("div", "shell-frame-host");
    workspace.appendChild(frameHost);
    viewer.appendChild(workspace);

    var loading = el("div", "app-error", t("common.preparing", null, "Preparing…"));
    frameHost.appendChild(loading);

    app.textContent = "";
    app.appendChild(viewer);

    var Settings = window.AgentGateSettings;

    function assembleFor(currentData, currentFiles) {
      if (config.webapp) {
        return Sandbox.assembleWebapp(currentFiles, { allowEval: !!config.allowEval });
      }
      var nextFeatures = config.features || {};
      var nextAllowEval = !!config.allowEval;
      if (
        config.renderer === "artifact" &&
        window.AgentGateShareKind &&
        typeof window.AgentGateShareKind.detectFeatures === "function"
      ) {
        nextFeatures = window.AgentGateShareKind.detectFeatures(currentData, currentFiles, "artifact");
        nextAllowEval = !!nextFeatures.react;
      }
      return Sandbox.assembleRenderer(config.renderer, currentData, {
        features: nextFeatures,
        allowEval: nextAllowEval,
        settings: Settings ? Settings.describe() : null,
        hash: location.hash || "",
        prefs: loadPrefs(config.renderer),
      });
    }

    // An uploaded webapp brings its own document; a built-in renderer is fetched from the
    // server and handed the payload as inert JSON.
    var assembled = assembleFor(data, files);

    assembled
      .then(function (result) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);

        if (result.error) {
          frameHost.appendChild(el("div", "app-error", result.error));
          return;
        }

        // autoHeight grows the frame to its reported content height so the host page owns
        // the only scrollbar. Off for uploaded webapps and fixed-viewport artifacts: they
        // may use vh units or scroll internally.
        var handle = Sandbox.mount(frameHost, result.html, {
          className: config.webapp ? "app-frame" : isFixed ? "shell-frame shell-frame--fixed" : "shell-frame",
          autoHeight: !isFixed,
        });

        var diag = createDiagnosticsUI(headerRight, viewer, !!(config.inspectable));
        handle.on("error", function (err) {
          diag.pushError(err);
        });
        handle.on("log", function (log) {
          diag.pushLog(log);
        });

        handle.on("storageReq", function (req) {
          handle.replyStorage(handleStorageRequest(shareId, req));
        });

        handle.on("aiReq", function (req) {
          if (typeof window.AgentGateAIHandler === "function") {
            Promise.resolve()
              .then(function () {
                return window.AgentGateAIHandler(req);
              })
              .then(
                function (text) {
                  handle.replyAI({ id: req.id, ok: true, text: String(text == null ? "" : text) });
                },
                function (err) {
                  var msg = err && err.message ? err.message : String(err || "AI error");
                  handle.replyAI({ id: req.id, ok: false, error: msg });
                }
              );
            return;
          }
          var disabledMsg = t(
            "artifact.aiDisabled",
            null,
            "AI completion is disabled by default in AgentGate (offline sandbox mode — no external network requests are made)."
          );
          diag.pushLog({ level: "warn", text: disabledMsg });
          handle.replyAI({ id: req.id, ok: false, error: disabledMsg });
        });

        var inspector = null;
        if (config.inspectable) {
          inspector = createSourceInspector(headerRight, workspace, files, function (updatedFiles) {
            var nextData = Object.assign({}, data, { files: updatedFiles });
            diag.clear();
            return assembleFor(nextData, updatedFiles).then(function (rebuilt) {
              if (rebuilt.error) {
                diag.pushError({ message: rebuilt.error });
                return;
              }
              handle.reload(rebuilt.html);
            });
          });
        }

        var initialReview = config.review ? loadReviewState(shareId) : null;
        var feedbackHandle = null;
        if (config.feedback || config.review) {
          feedbackHandle = createFeedbackPanel(shareId, config.title, {
            isReview: !config.feedback && !!config.review,
            initialReview: initialReview,
          });
          viewer.appendChild(feedbackHandle.node);
        }

        if (config.review) {
          handle.on("ready", function () {
            handle.setReviewState(loadReviewState(shareId));
          });
          handle.on("reviewState", function (nextState) {
            saveReviewState(shareId, nextState);
            if (feedbackHandle) feedbackHandle.setReviewState(nextState);
          });
        }

        handle.on("pref", function (pref) {
          try {
            localStorage.setItem(prefKey(config.renderer, pref.key), pref.value);
          } catch (e) {
            // private mode: the choice just will not persist
          }
        });

        var currentFile = files.length ? files[0].title : config.title;
        handle.on("currentFile", function (name) {
          if (name) currentFile = name;
        });
        // The frame cannot touch the address bar, so it reports where it scrolled to and
        // the host writes the hash — deep links keep working from inside the sandbox.
        // sandbox.js has already reduced the value to a bare fragment, so this cannot be
        // talked into rewriting the path.
        handle.on("hash", function (hash) {
          if (hash && hash.charAt(0) === "#" && hash !== location.hash) {
            history.replaceState(null, "", hash);
          }
        });
        window.addEventListener("hashchange", function () {
          handle.setHash(location.hash);
        });

        if (Settings) {
          Settings.renderSettingsPanel(headerRight);
          Settings.onChange(function (described) {
            handle.setSettings(described);
          });
        }
        if (window.AgentGateI18n) {
          window.AgentGateI18n.onChange(function () {
            updateHeaderLabel();
            if (inspector) inspector.updateLabel();
            if (Settings) handle.setSettings(Settings.describe());
          });
        }

        headerRight.appendChild(createStandaloneControls(handle, config.title));

        if (window.AgentGateExport) {
          window.AgentGateExport.renderExportControl(headerRight, {
            kind: config.exportKind || "docs",
            title: config.title,
            multi: files.length > 1,
            sources: files.map(function (f) {
              return { name: f.title, content: f.content, encoding: f.encoding };
            }),
            // The host already holds every decrypted file, so only the *name* of the
            // selected one has to cross the frame boundary.
            getCurrentSource: function () {
              var activeList = inspector ? inspector.getFiles() : files;
              for (var i = 0; i < activeList.length; i++) {
                if ((activeList[i].title || "") === currentFile) return activeList[i];
              }
              return activeList[0] || null;
            },
            // Ask the frame to render the requested scope, then expand it to full height
            // and print, so the PDF paginates instead of clipping to one page.
            pdfCustom: function (scope) {
              handle.setPrintScope(scope === "current" ? "current" : "all");
              setTimeout(function () {
                Sandbox.printFullHeight(handle);
              }, 400);
            },
          });
        }
      })
      .catch(function (err) {
        console.error("Failed to prepare renderer:", err);
        var msg = err && err.message ? err.message : String(err);
        loading.textContent = t("share.renderFailed", { err: msg }, "Failed to render: " + msg);
      });
  }

  // start wires the standard decrypt-then-render flow. `plan(data)` maps a decrypted
  // payload to a render config, so each view only has to describe its own labelling.
  function start(plan) {
    function attemptDecrypt(passphrase, remember) {
      var S = window.AgentGateShare;
      var encrypted = S ? S.getEncryptedData() : null;
      if (!encrypted) return;

      var P = window.AgentGatePassphrase;
      if (P) P.showDecryptingState();

      window.AgentGateCrypto.decryptShare(encrypted, passphrase)
        .then(function (plaintext) {
          var data = JSON.parse(plaintext);
          if (remember && P) P.storePassphrase(passphrase);
          if (P) P.hidePassphraseDialog();
          render(data, S.getExpiresAt(), plan(data));
        })
        .catch(function (err) {
          console.error("Decryption failed:", err);
          if (P) {
            P.updatePassphraseError(
              t("passphrase.failed", null, "Decryption failed. Please check your passphrase.")
            );
          }
        });
    }

    function init() {
      if (window.AgentGateI18n) {
        document.title = t("share.pageTitle", null, "Share - AgentGate");
        window.AgentGateI18n.applyDom(document);
        window.AgentGateI18n.onChange(function () {
          document.title = t("share.pageTitle", null, "Share - AgentGate");
        });
      }
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

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  window.AgentGateShell = { start: start, render: render };
})();
