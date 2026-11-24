(function () {
  "use strict";

  // Interactive Artifact renderer running inside AgentGate's opaque-origin sandbox.
  // Supports:
  //   1. Zero-build React / JSX / TSX / JS / TS single- or multi-file apps via Sucrase
  //      and a virtual module resolver backed by vendored offline libraries.
  //   2. Standalone interactive SVG viewer (pan, zoom, background toggle, SVG/PNG export).
  //   3. Standalone interactive Mermaid diagram viewer (pan, zoom, theme sync, export).

  function normalizePath(p) {
    return String(p || "")
      .replace(/\\/g, "/")
      .replace(/^\.?\//, "")
      .replace(/[?#].*$/, "");
  }

  function resolveRelativePath(fromFile, specifier) {
    var baseParts = normalizePath(fromFile).split("/");
    baseParts.pop();
    var raw = String(specifier || "").replace(/\\/g, "/");
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

  function buildFileLookup(files) {
    var byPath = {};
    (files || []).forEach(function (f) {
      byPath[normalizePath(f.title || "")] = f;
    });
    return byPath;
  }

  function resolveLocalFile(byPath, fromFile, specifier) {
    var target = resolveRelativePath(fromFile, specifier);
    var exts = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".css", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
    for (var i = 0; i < exts.length; i++) {
      var candidate = target + exts[i];
      if (Object.prototype.hasOwnProperty.call(byPath, candidate)) {
        return { path: candidate, file: byPath[candidate] };
      }
    }
    return null;
  }

  function createLucideProxy(React, lucide) {
    if (!lucide) return null;
    if (typeof Proxy !== "function") return lucide;
    return new Proxy(lucide, {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        if (prop === "__esModule") return true;
        if (prop === "default") return target;
        if (typeof prop === "symbol") return undefined;
        // Graceful fallback icon when an LLM invents a slightly different Lucide name.
        return function FallbackIcon(props) {
          var size = (props && props.size) || 18;
          return React.createElement(
            "svg",
            Object.assign(
              {
                width: size,
                height: size,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                "data-missing-icon": String(prop),
              },
              props
            ),
            React.createElement("circle", { cx: 12, cy: 12, r: 9 }),
            React.createElement("path", { d: "M12 8v4" }),
            React.createElement("circle", { cx: 12, cy: 16, r: 0.5 })
          );
        };
      },
    });
  }

  function buildBuiltinModules(globals) {
    var g = globals || window;
    var V = g.AgentGateArtifactVendor || {};
    var React = V.React || g.React;
    var ReactDOM = V.ReactDOM || g.ReactDOM;
    var mods = {};

    if (React) {
      mods["react"] = Object.assign({ __esModule: true, default: React }, React);
    }
    if (ReactDOM) {
      mods["react-dom"] = Object.assign({ __esModule: true, default: ReactDOM }, ReactDOM);
    }
    if (V.createRoot) {
      var clientMod = { __esModule: true, createRoot: V.createRoot, default: { createRoot: V.createRoot } };
      mods["react-dom/client"] = clientMod;
    }
    if (V.jsxRuntime) {
      mods["react/jsx-runtime"] = V.jsxRuntime;
    }
    if (g.LucideReact) {
      mods["lucide-react"] = createLucideProxy(React, g.LucideReact);
    }
    if (g.Recharts) {
      mods["recharts"] = Object.assign({ __esModule: true, default: g.Recharts }, g.Recharts);
    }
    if (g.Chart) {
      var chartMod = Object.assign({ __esModule: true, default: g.Chart, Chart: g.Chart }, g.Chart);
      mods["chart.js"] = chartMod;
      mods["chart.js/auto"] = chartMod;
    }
    if (g.LightweightCharts) {
      mods["lightweight-charts"] = Object.assign(
        { __esModule: true, default: g.LightweightCharts },
        g.LightweightCharts
      );
    }
    if (g.mermaid) {
      mods["mermaid"] = Object.assign({ __esModule: true, default: g.mermaid }, g.mermaid);
    }
    if (g.marked) {
      mods["marked"] = { __esModule: true, default: g.marked, marked: g.marked, parse: g.marked.parse };
    }
    if (g.katex) {
      mods["katex"] = Object.assign({ __esModule: true, default: g.katex }, g.katex);
    }
    if (g.hljs) {
      mods["highlight.js"] = Object.assign({ __esModule: true, default: g.hljs }, g.hljs);
    }
    return mods;
  }

  function compileAndExecute(files, entryPath, globals, injectStyle) {
    var g = globals || window;
    var V = g.AgentGateArtifactVendor;
    if (!V || typeof V.transform !== "function") {
      throw new Error("Artifact runtime (React + Sucrase) was not loaded.");
    }
    var byPath = buildFileLookup(files);
    var builtins = buildBuiltinModules(g);
    var cache = {};
    var importedStyles = {};

    function loadModule(filePath) {
      var norm = normalizePath(filePath);
      if (Object.prototype.hasOwnProperty.call(cache, norm)) {
        return cache[norm].exports;
      }
      var entry = byPath[norm];
      if (!entry) {
        throw new Error('Cannot resolve local module "' + filePath + '"');
      }
      var ext = norm.split(".").pop().toLowerCase();
      if (ext === "json") {
        var parsed = JSON.parse(entry.content || "{}");
        cache[norm] = { exports: parsed };
        return parsed;
      }
      if (ext === "css") {
        importedStyles[norm] = true;
        if (typeof injectStyle === "function") injectStyle(norm, entry.content || "");
        cache[norm] = { exports: {} };
        return {};
      }

      var result = V.transform(entry.content || "", {
        transforms: ["jsx", "typescript", "imports"],
        jsxRuntime: "classic",
        production: true,
        filePath: norm,
      });

      var mod = { exports: {} };
      cache[norm] = mod;

      function localRequire(specifier) {
        var spec = String(specifier || "").trim();
        if (Object.prototype.hasOwnProperty.call(builtins, spec)) {
          return builtins[spec];
        }
        if (spec.charAt(0) === "." || spec.charAt(0) === "/") {
          var found = resolveLocalFile(byPath, norm, spec);
          if (found) return loadModule(found.path);
          throw new Error('Module not found: "' + spec + '" (imported from ' + norm + ")");
        }
        throw new Error(
          'Unsupported import "' +
            spec +
            '" in ' +
            norm +
            ". Available built-in modules: " +
            Object.keys(builtins).join(", ")
        );
      }

      var fn = new Function("require", "exports", "module", "React", "ReactDOM", "__filename", result.code);
      fn(localRequire, mod.exports, mod, V.React, V.ReactDOM, norm);
      return mod.exports;
    }

    // Auto-inject any standalone .css files in the bundle that were not imported explicitly.
    var exportsObj = loadModule(entryPath);
    if (typeof injectStyle === "function") {
      (files || []).forEach(function (f) {
        var p = normalizePath(f.title || "");
        if (/\.css$/i.test(p) && !importedStyles[p] && f.encoding !== "base64") {
          injectStyle(p, f.content || "");
        }
      });
    }
    return exportsObj;
  }

  function pickEntryFile(data, files) {
    var list = files || [];
    var byPath = buildFileLookup(list);
    if (data && data.entry && byPath[normalizePath(data.entry)]) {
      return byPath[normalizePath(data.entry)];
    }
    var preferred = ["App.tsx", "App.jsx", "index.tsx", "index.jsx", "app.tsx", "app.jsx", "main.tsx", "main.jsx"];
    for (var i = 0; i < preferred.length; i++) {
      if (byPath[normalizePath(preferred[i])]) return byPath[normalizePath(preferred[i])];
    }
    for (var j = 0; j < list.length; j++) {
      if (/\.(tsx|jsx|svg|mmd|mermaid|ts|js)$/i.test(list[j].title || "")) return list[j];
    }
    return list[0] || { title: "App.jsx", content: "" };
  }

  // Expose core for Node unit tests.
  window.AgentGateArtifactCore = {
    normalizePath: normalizePath,
    resolveRelativePath: resolveRelativePath,
    resolveLocalFile: resolveLocalFile,
    buildBuiltinModules: buildBuiltinModules,
    compileAndExecute: compileAndExecute,
    pickEntryFile: pickEntryFile,
  };

  if (typeof document === "undefined" || !window.AgentGateFrameUI) return;

  // --- Browser boot -----------------------------------------------------------------

  var UI = window.AgentGateFrameUI;
  var Frame = UI.frame;
  var boot = UI.readBoot();
  var data = boot.payload || {};
  var files = data.files || [];
  var rootEl = document.getElementById("root");
  if (!rootEl) return;

  function reportError(err, phase) {
    var msg = err && err.message ? err.message : String(err || "Unknown error");
    var stack = err && err.stack ? String(err.stack) : "";
    if (Frame && typeof Frame.reportError === "function") {
      Frame.reportError({
        message: (phase ? "[" + phase + "] " : "") + msg,
        stack: stack,
        source: entry ? entry.title : "",
      });
    }
  }

  function renderErrorCard(title, err) {
    var msg = err && err.message ? err.message : String(err || "Unknown error");
    var stack = err && err.stack ? String(err.stack) : "";
    rootEl.innerHTML =
      '<div class="ag-artifact-error">' +
      '<div class="ag-artifact-error-head"><span>' +
      UI.escapeHtml(title) +
      "</span></div>" +
      '<div class="ag-artifact-error-msg">' +
      UI.escapeHtml(msg) +
      "</div>" +
      (stack ? '<pre class="ag-artifact-error-stack">' + UI.escapeHtml(stack) + "</pre>" : "") +
      "</div>";
    Frame.reportHeight();
  }

  function downloadFile(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function exportSvgAsPng(svgEl, filenameBase) {
    try {
      var clone = svgEl.cloneNode(true);
      var rect = svgEl.getBoundingClientRect();
      var w = Math.max(Math.round(rect.width || 800), 1);
      var h = Math.max(Math.round(rect.height || 600), 1);
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));
      var serialized = new XMLSerializer().serializeToString(clone);
      var svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function () {
        var scale = 2;
        var canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        var ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (pngBlob) {
          if (pngBlob) downloadFile((filenameBase || "diagram") + ".png", pngBlob);
        }, "image/png");
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (e) {
      reportError(e, "export-png");
    }
  }

  // Interactive pan/zoom/background/export canvas for SVG and Mermaid artifacts.
  function mountInteractiveCanvas(opts) {
    rootEl.innerHTML = "";
    var shell = document.createElement("div");
    shell.className = "ag-canvas-shell";

    var toolbar = document.createElement("div");
    toolbar.className = "ag-canvas-toolbar";

    var zoomGroup = document.createElement("div");
    zoomGroup.className = "ag-canvas-group";
    var btnOut = document.createElement("button");
    btnOut.type = "button";
    btnOut.className = "ag-canvas-btn";
    btnOut.textContent = "−";
    var zoomLabel = document.createElement("span");
    zoomLabel.className = "ag-canvas-zoom-label";
    zoomLabel.textContent = "100%";
    var btnIn = document.createElement("button");
    btnIn.type = "button";
    btnIn.className = "ag-canvas-btn";
    btnIn.textContent = "+";
    var btnReset = document.createElement("button");
    btnReset.type = "button";
    btnReset.className = "ag-canvas-btn";
    btnReset.textContent = UI.t("artifact.resetZoom", null, "Fit");
    zoomGroup.appendChild(btnOut);
    zoomGroup.appendChild(zoomLabel);
    zoomGroup.appendChild(btnIn);
    zoomGroup.appendChild(btnReset);

    var rightGroup = document.createElement("div");
    rightGroup.className = "ag-canvas-group";
    var bgModes = [
      { id: "auto", label: UI.t("artifact.bgAuto", null, "Auto") },
      { id: "light", label: UI.t("artifact.bgLight", null, "Light") },
      { id: "dark", label: UI.t("artifact.bgDark", null, "Dark") },
      { id: "checker", label: UI.t("artifact.bgChecker", null, "Grid") },
    ];
    var bgButtons = [];
    bgModes.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ag-canvas-btn" + (m.id === "auto" ? " active" : "");
      b.textContent = m.label;
      b.addEventListener("click", function () {
        stage.setAttribute("data-bg", m.id);
        bgButtons.forEach(function (x) {
          x.classList.toggle("active", x === b);
        });
      });
      bgButtons.push(b);
      rightGroup.appendChild(b);
    });

    var btnSvg = document.createElement("button");
    btnSvg.type = "button";
    btnSvg.className = "ag-canvas-btn";
    btnSvg.textContent = "SVG";
    btnSvg.addEventListener("click", function () {
      var svgEl = content.querySelector("svg");
      if (!svgEl) return;
      var serialized = new XMLSerializer().serializeToString(svgEl);
      downloadFile((opts.name || "artifact") + ".svg", new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    });
    rightGroup.appendChild(btnSvg);

    var btnPng = document.createElement("button");
    btnPng.type = "button";
    btnPng.className = "ag-canvas-btn";
    btnPng.textContent = "PNG";
    btnPng.addEventListener("click", function () {
      var svgEl = content.querySelector("svg");
      if (svgEl) exportSvgAsPng(svgEl, opts.name || "artifact");
    });
    rightGroup.appendChild(btnPng);

    toolbar.appendChild(zoomGroup);
    toolbar.appendChild(rightGroup);

    var stage = document.createElement("div");
    stage.className = "ag-canvas-stage";
    stage.setAttribute("data-bg", "auto");

    var content = document.createElement("div");
    content.className = "ag-canvas-content";
    stage.appendChild(content);

    shell.appendChild(toolbar);
    shell.appendChild(stage);
    rootEl.appendChild(shell);

    var scale = 1;
    var tx = 0;
    var ty = 0;

    function applyTransform() {
      content.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
      zoomLabel.textContent = Math.round(scale * 100) + "%";
    }

    function resetView() {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    }

    btnIn.addEventListener("click", function () {
      scale = Math.min(8, scale * 1.25);
      applyTransform();
    });
    btnOut.addEventListener("click", function () {
      scale = Math.max(0.15, scale / 1.25);
      applyTransform();
    });
    btnReset.addEventListener("click", resetView);

    stage.addEventListener(
      "wheel",
      function (ev) {
        ev.preventDefault();
        var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        scale = Math.min(8, Math.max(0.15, scale * factor));
        applyTransform();
      },
      { passive: false }
    );

    var dragging = false;
    var sx = 0;
    var sy = 0;
    stage.addEventListener("pointerdown", function (ev) {
      dragging = true;
      sx = ev.clientX - tx;
      sy = ev.clientY - ty;
      if (stage.setPointerCapture) stage.setPointerCapture(ev.pointerId);
    });
    stage.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      tx = ev.clientX - sx;
      ty = ev.clientY - sy;
      applyTransform();
    });
    stage.addEventListener("pointerup", function () {
      dragging = false;
    });

    return { content: content, resetView: resetView };
  }

  var entry = pickEntryFile(data, files);
  var ext = (entry.title || "").split(".").pop().toLowerCase();
  var baseName = (entry.title || "artifact").replace(/\.[^.]+$/, "");

  if (ext === "svg") {
    var canvas = mountInteractiveCanvas({ name: baseName });
    canvas.content.innerHTML = entry.content || "";
    Frame.reportHeight();
    return;
  }

  if (ext === "mmd" || ext === "mermaid") {
    var mCanvas = mountInteractiveCanvas({ name: baseName });
    function drawMermaid() {
      if (typeof mermaid === "undefined") {
        renderErrorCard("Mermaid unavailable", new Error("Mermaid library was not loaded for this share."));
        return;
      }
      var isDark = UI.themeIsDark();
      mCanvas.content.innerHTML = '<div class="mermaid"></div>';
      var node = mCanvas.content.firstChild;
      node.textContent = entry.content || "";
      mermaid.initialize({ startOnLoad: false, theme: isDark ? "dark" : "default" });
      Promise.resolve(mermaid.run({ nodes: [node] }))
        .then(function () {
          Frame.reportHeight();
        })
        .catch(function (err) {
          reportError(err, "mermaid");
          renderErrorCard("Mermaid render error", err);
        });
    }
    Frame.onSettings = drawMermaid;
    drawMermaid();
    return;
  }

  // React / JSX / TSX artifact path
  var V = window.AgentGateArtifactVendor;
  if (!V || !V.React || !V.createRoot) {
    var missingErr = new Error("React artifact runtime was not loaded for this share.");
    reportError(missingErr, "boot");
    renderErrorCard("Artifact runtime unavailable", missingErr);
    return;
  }

  var React = V.React;

  // Error boundary catches render/lifecycle exceptions inside user components.
  function ErrorBoundary(props) {
    React.Component.call(this, props);
    this.state = { error: null };
  }
  ErrorBoundary.prototype = Object.create(React.Component.prototype);
  ErrorBoundary.prototype.constructor = ErrorBoundary;
  ErrorBoundary.getDerivedStateFromError = function (error) {
    return { error: error };
  };
  ErrorBoundary.prototype.componentDidCatch = function (error, info) {
    var enriched = new Error(error && error.message ? error.message : String(error));
    enriched.stack =
      (error && error.stack ? error.stack : "") +
      (info && info.componentStack ? "\nComponent Stack:" + info.componentStack : "");
    reportError(enriched, "render");
  };
  ErrorBoundary.prototype.render = function () {
    if (this.state.error) {
      var err = this.state.error;
      return React.createElement(
        "div",
        { className: "ag-artifact-error" },
        React.createElement(
          "div",
          { className: "ag-artifact-error-head" },
          React.createElement("span", null, UI.t("artifact.runtimeError", null, "Artifact runtime error"))
        ),
        React.createElement("div", { className: "ag-artifact-error-msg" }, err.message || String(err)),
        err.stack ? React.createElement("pre", { className: "ag-artifact-error-stack" }, String(err.stack)) : null
      );
    }
    return this.props.children;
  };

  function injectStyle(path, css) {
    var style = document.createElement("style");
    style.setAttribute("data-ag-artifact-css", path);
    style.textContent = css;
    document.head.appendChild(style);
  }

  try {
    var mod = compileAndExecute(files, entry.title, window, injectStyle);
    var Comp = mod && (mod.default || mod.App || mod.Component);
    if (!Comp && mod && typeof mod === "object") {
      var keys = Object.keys(mod);
      for (var k = 0; k < keys.length; k++) {
        if (typeof mod[keys[k]] === "function") {
          Comp = mod[keys[k]];
          break;
        }
      }
    }
    if (typeof Comp === "function" || (Comp && typeof Comp === "object" && Comp.$$typeof)) {
      var root = V.createRoot(rootEl);
      root.render(React.createElement(ErrorBoundary, null, React.createElement(Comp, null)));
      requestAnimationFrame(function () {
        Frame.reportHeight();
      });
    } else if (!rootEl.childNodes.length) {
      throw new Error(
        'No React component exported from "' +
          entry.title +
          '". Export a default function component (e.g. `export default function App() { ... }`).'
      );
    }
  } catch (err) {
    reportError(err, "compile");
    renderErrorCard(UI.t("artifact.compileError", null, "Artifact compile/execution error"), err);
  }
})();
