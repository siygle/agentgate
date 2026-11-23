(function () {
  "use strict";

  // Shared plumbing for AgentGate's built-in renderers, all of which run inside the
  // render sandbox: reading the injected payload, talking to the host bridge, safe link
  // handling, code-block copy buttons, i18n, and the in-frame find bar.
  //
  // The find bar exists because Ctrl+F is unreliable against a srcdoc frame — browsers
  // do search subframes, but only the focused one, and highlight-all behaves oddly. A
  // renderer's own box is also simply better here: it can say how many *other files* in
  // the bundle match, which the browser cannot know.

  // sandbox.js installs window.AgentGateFrame at the end of <head>, before any renderer
  // script. If it is missing, deep links, print-scope switching and the current-file
  // report all stop working while height reporting keeps going on its own — a silent
  // partial failure, so say so rather than degrading quietly.
  var Frame = window.AgentGateFrame;
  if (!Frame) {
    console.error(
      "AgentGate: host bridge missing — sandbox.js must inject it before renderer scripts."
    );
    Frame = {
      reportHeight: function () {},
      reportHash: function () {},
      reportCurrentFile: function () {},
      savePref: function () {},
    };
  }

  function t(key, vars, fallback) {
    if (window.AgentGateI18n && window.AgentGateI18n.t) {
      return window.AgentGateI18n.t(key, vars);
    }
    return fallback != null ? fallback : key;
  }

  function readBoot() {
    var el = document.getElementById("agentgate-payload");
    if (!el) return { payload: {}, hash: "", prefs: {} };
    try {
      var boot = JSON.parse(el.textContent || "{}");
      boot.payload = boot.payload || {};
      boot.prefs = boot.prefs || {};
      if (boot.settings && boot.settings.lang && window.AgentGateI18n) {
        window.AgentGateI18n.setLocale(boot.settings.lang, { persist: false });
      }
      return boot;
    } catch (e) {
      console.error("AgentGate: unreadable payload", e);
      return { payload: {}, hash: "", prefs: {} };
    }
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // themeIsDark honours the host's explicit light/dark override before falling back to
  // the OS preference, so libraries that bake colours in (mermaid) match the page.
  function themeIsDark() {
    var attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    return prefersDark();
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w一-鿿\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);
  }

  // assignHeadingIds gives headings stable ids so the host can turn "#some-section" into
  // a scroll position. The frame cannot own the address bar, so it reports the target
  // back instead of setting location itself.
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
    if (!target) {
      try {
        target = document.getElementById(decodeURIComponent(id));
      } catch (e) {
        // ignore invalid percent encoding
      }
    }
    if (target) target.scrollIntoView({ block: "start" });
  }

  // --- safe link handling ------------------------------------------------------------
  //
  // Share content runs inside an opaque-origin <iframe srcdoc>. Letting the browser
  // navigate the iframe itself to an external URL triggers X-Frame-Options /
  // frame-ancestors error pages and wipes out the decrypted post; navigating a relative
  // URL inside about:srcdoc also produces an error page.

  function classifyLink(rawHref) {
    var href = String(rawHref == null ? "" : rawHref).trim();
    if (!href) return { kind: "empty", href: "" };
    if (href.charAt(0) === "#") return { kind: "hash", href: href };
    if (/^https?:\/\//i.test(href)) return { kind: "external", href: href };
    if (/^\/\//.test(href)) return { kind: "external", href: "https:" + href };
    if (/^(mailto:|tel:)/i.test(href)) return { kind: "protocol", href: href };
    if (/^(javascript:|vbscript:|data:)/i.test(href)) return { kind: "unsafe", href: href };
    // Reject any other unknown scheme (e.g. file:, chrome:) rather than navigating iframe.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "unsafe", href: href };
    var hashIdx = href.indexOf("#");
    var pathPart = hashIdx === -1 ? href : href.slice(0, hashIdx);
    var hashPart = hashIdx === -1 ? "" : href.slice(hashIdx);
    var cleanPath = pathPart.replace(/\?.*$/, "");
    return { kind: "relative", href: href, path: cleanPath, hash: hashPart };
  }

  function ensureRelNoopener(link) {
    var rel = String(link.getAttribute("rel") || "");
    var parts = rel ? rel.split(/\s+/) : [];
    if (parts.indexOf("noopener") === -1) parts.push("noopener");
    if (parts.indexOf("noreferrer") === -1) parts.push("noreferrer");
    link.setAttribute("rel", parts.join(" ").trim());
  }

  // prepareLinks normalizes rendered anchors so external links open cleanly in a new tab
  // (including middle-click, Cmd/Ctrl+click, right-click, and standalone saved HTML) and
  // unresolvable relative links carry a clear tooltip instead of navigating into an error.
  function prepareLinks(root, opts) {
    if (!root || !root.querySelectorAll) return;
    opts = opts || {};
    var canResolve = typeof opts.canResolveFile === "function" ? opts.canResolveFile : null;

    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (link) {
      var info = classifyLink(link.getAttribute("href"));
      if (info.kind === "external") {
        if (info.href !== link.getAttribute("href")) link.setAttribute("href", info.href);
        link.setAttribute("target", "_blank");
        ensureRelNoopener(link);
      } else if (info.kind === "protocol") {
        link.setAttribute("target", "_blank");
        ensureRelNoopener(link);
      } else if (info.kind === "relative") {
        var resolved = canResolve ? !!canResolve(info.path) : false;
        if (!resolved) {
          link.setAttribute("data-ag-unresolved-link", "1");
          if (!link.getAttribute("title")) {
            link.setAttribute("title", t("frame.unresolvedLink", null, "Link target is not included in this share"));
          }
        } else {
          link.removeAttribute("data-ag-unresolved-link");
        }
      }
    });
  }

  // wireAnchors intercepts anchor clicks inside built-in renderers so:
  //   - #hash links scroll locally and update the host address bar
  //   - http(s)/mailto/tel links always open outside the iframe
  //   - relative links resolve inside multi-file bundles via opts.onFileLink, or are
  //     safely blocked from turning the iframe into a browser error page
  //   - unsafe schemes (javascript:, data:, etc.) are blocked
  function wireAnchors(root, opts) {
    if (!root) return;
    opts = opts || {};
    root.addEventListener("click", function (ev) {
      var link = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
      if (!link) return;
      var info = classifyLink(link.getAttribute("href"));

      if (info.kind === "hash") {
        ev.preventDefault();
        scrollToHash(info.href);
        Frame.reportHash(info.href);
        return;
      }

      if (info.kind === "external" || info.kind === "protocol") {
        var target = String(link.getAttribute("target") || "").toLowerCase();
        if (target !== "_blank") {
          ev.preventDefault();
          try {
            window.open(info.href, "_blank", "noopener,noreferrer");
          } catch (e) {
            // popup blocked or unavailable
          }
        } else {
          ensureRelNoopener(link);
        }
        return;
      }

      if (info.kind === "relative") {
        ev.preventDefault();
        if (typeof opts.onFileLink === "function" && info.path) {
          opts.onFileLink(info.path, info.hash || "");
        }
        return;
      }

      if (info.kind === "unsafe" || info.kind === "empty") {
        ev.preventDefault();
      }
    });
  }

  // --- copy buttons ------------------------------------------------------------------

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

  function flashCopyState(btn, ok) {
    btn.textContent = ok
      ? t("common.copied", null, "Copied")
      : t("common.failed", null, "Failed");
    btn.classList.add(ok ? "copy-btn--success" : "copy-btn--error");
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = t("common.copy", null, "Copy");
      btn.classList.remove("copy-btn--success", "copy-btn--error");
      btn.disabled = false;
    }, 1500);
  }

  function createCopyButton(getText) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.setAttribute("data-ag-copy-btn", "1");
    btn.textContent = t("common.copy", null, "Copy");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      Promise.resolve(copyText(getText() || "")).then(function (ok) {
        flashCopyState(btn, ok);
      });
    });
    return btn;
  }

  function attachCodeBlockCopyButtons(container) {
    if (!container || !container.querySelectorAll) return;
    Array.prototype.forEach.call(container.querySelectorAll("pre"), function (pre) {
      if (pre.querySelector(".copy-btn--block")) return;
      var code = pre.querySelector("code");
      if (!code) return;
      var btn = createCopyButton(function () {
        return code.textContent;
      });
      btn.classList.add("copy-btn--block");
      pre.appendChild(btn);
    });
  }

  // --- find bar ----------------------------------------------------------------------

  // createFind wires the toolbar markup every renderer's frame.html shares.
  //
  //   opts.root         () => element to search within (re-read on each search, because
  //                     renderers replace their content when switching file or view)
  //   opts.otherMatches (query) => number of *other* items that also match, or 0
  function createFind(opts) {
    var input = document.getElementById("ag-find-input");
    var countEl = document.getElementById("ag-find-count");
    var toolbar = document.getElementById("ag-toolbar");
    if (!input) return { refresh: function () {}, query: function () { return ""; } };
    if (toolbar) toolbar.hidden = false;

    var state = { query: "", marks: [], index: 0 };

    function clearMarks(root) {
      Array.prototype.forEach.call(root.querySelectorAll("mark[data-ag-find]"), function (m) {
        var parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      });
      state.marks = [];
    }

    function markMatches(root, query) {
      if (!query) return [];
      var marks = [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          // Skip generated SVG (mermaid), buttons (copy button), and scripts/styles.
          var p = n.parentElement;
          while (p && p !== root) {
            var tag = p.tagName;
            if (
              tag === "SVG" ||
              tag === "svg" ||
              tag === "MARK" ||
              tag === "SCRIPT" ||
              tag === "STYLE" ||
              tag === "BUTTON"
            ) {
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

    function updateCount() {
      if (!countEl) return;
      if (!state.query) {
        countEl.textContent = "";
        return;
      }
      var others = opts.otherMatches ? opts.otherMatches(state.query) : 0;
      var suffix = others
        ? others === 1
          ? t("frame.otherFileOne", null, " · 1 other file")
          : t("frame.otherFiles", { n: others }, " · " + others + " other files")
        : "";
      if (!state.marks.length) {
        countEl.textContent = others
          ? t("frame.zeroHere", null, "0 here") + suffix
          : t("frame.noMatches", null, "no matches");
        return;
      }
      countEl.textContent = state.index + 1 + "/" + state.marks.length + suffix;
    }

    function focusMatch(delta) {
      if (!state.marks.length) return;
      state.marks.forEach(function (m) {
        m.removeAttribute("data-ag-current");
      });
      state.index = (state.index + delta + state.marks.length) % state.marks.length;
      var current = state.marks[state.index];
      current.setAttribute("data-ag-current", "1");
      current.scrollIntoView({ block: "center" });
      updateCount();
    }

    function run(query) {
      var root = opts.root();
      if (!root) return;
      state.query = query;
      clearMarks(root);
      state.marks = markMatches(root, query);
      state.index = 0;
      if (state.marks.length) {
        state.marks[0].setAttribute("data-ag-current", "1");
        state.marks[0].scrollIntoView({ block: "center" });
      }
      updateCount();
      Frame.reportHeight();
    }

    var debounce = null;
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      var value = input.value;
      debounce = setTimeout(function () {
        run(value);
      }, 140);
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        focusMatch(ev.shiftKey ? -1 : 1);
      } else if (ev.key === "Escape") {
        input.value = "";
        run("");
      }
    });
    var next = document.getElementById("ag-find-next");
    var prev = document.getElementById("ag-find-prev");
    if (next) next.addEventListener("click", function () { focusMatch(1); });
    if (prev) prev.addEventListener("click", function () { focusMatch(-1); });

    // Land the browser shortcut in this box rather than opening the host's find bar
    // against a frame it cannot search well.
    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "f") {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });

    if (window.AgentGateI18n && window.AgentGateI18n.onChange) {
      window.AgentGateI18n.onChange(function () {
        updateCount();
      });
    }

    return {
      // refresh re-applies the active query after the renderer has replaced its content.
      refresh: function () {
        if (state.query) run(state.query);
      },
      query: function () {
        return state.query;
      },
    };
  }

  // Keep dynamic labels in sync when the host switches language.
  if (window.AgentGateI18n && window.AgentGateI18n.onChange) {
    window.AgentGateI18n.onChange(function () {
      if (typeof document === "undefined" || !document.querySelectorAll) return;
      Array.prototype.forEach.call(document.querySelectorAll("[data-ag-copy-btn]"), function (btn) {
        if (!btn.disabled) btn.textContent = t("common.copy", null, "Copy");
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-ag-unresolved-link]"), function (a) {
        a.setAttribute("title", t("frame.unresolvedLink", null, "Link target is not included in this share"));
      });
    });
  }

  window.AgentGateFrameUI = {
    frame: Frame,
    t: t,
    readBoot: readBoot,
    escapeHtml: escapeHtml,
    themeIsDark: themeIsDark,
    slugify: slugify,
    assignHeadingIds: assignHeadingIds,
    scrollToHash: scrollToHash,
    classifyLink: classifyLink,
    prepareLinks: prepareLinks,
    wireAnchors: wireAnchors,
    copyText: copyText,
    createCopyButton: createCopyButton,
    attachCodeBlockCopyButtons: attachCodeBlockCopyButtons,
    createFind: createFind,
  };
})();
