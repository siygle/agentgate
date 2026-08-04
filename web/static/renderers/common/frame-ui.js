(function () {
  "use strict";

  // Shared plumbing for AgentGate's built-in renderers, all of which run inside the
  // render sandbox: reading the injected payload, talking to the host bridge, and the
  // in-frame find bar.
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

  function readBoot() {
    var el = document.getElementById("agentgate-payload");
    if (!el) return { payload: {}, hash: "", prefs: {} };
    try {
      var boot = JSON.parse(el.textContent || "{}");
      boot.payload = boot.payload || {};
      boot.prefs = boot.prefs || {};
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
    if (target) target.scrollIntoView({ block: "start" });
  }

  // wireAnchors makes in-document links scroll locally and tell the host, which owns the
  // address bar.
  function wireAnchors(root) {
    if (!root) return;
    root.addEventListener("click", function (ev) {
      var link = ev.target && ev.target.closest ? ev.target.closest("a[href^='#']") : null;
      if (!link) return;
      ev.preventDefault();
      var hash = link.getAttribute("href");
      scrollToHash(hash);
      Frame.reportHash(hash);
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

    function updateCount() {
      if (!countEl) return;
      if (!state.query) {
        countEl.textContent = "";
        return;
      }
      var others = opts.otherMatches ? opts.otherMatches(state.query) : 0;
      var suffix = others ? " · " + others + " other file" + (others === 1 ? "" : "s") : "";
      if (!state.marks.length) {
        countEl.textContent = others ? "0 here" + suffix : "no matches";
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

  window.AgentGateFrameUI = {
    frame: Frame,
    readBoot: readBoot,
    escapeHtml: escapeHtml,
    themeIsDark: themeIsDark,
    slugify: slugify,
    assignHeadingIds: assignHeadingIds,
    scrollToHash: scrollToHash,
    wireAnchors: wireAnchors,
    createFind: createFind,
  };
})();
