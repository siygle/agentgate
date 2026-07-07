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
  };

  function normalizeKey(path) {
    return (path || "")
      .replace(/^\.?\//, "")
      .replace(/^\.\//, "")
      .replace(/[?#].*$/, "");
  }

  // buildFileMap indexes files by both their full relative path and basename so
  // references like "css/app.css", "./css/app.css" and "app.css" all resolve.
  function buildFileMap(files) {
    var map = {};
    files.forEach(function (f) {
      var name = f.title || "";
      var content = f.content || "";
      map[normalizeKey(name)] = content;
      var base = name.split("/").pop();
      if (base && !(normalizeKey(base) in map)) {
        map[normalizeKey(base)] = content;
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
    if ("index.html" in map) return map["index.html"];
    for (var i = 0; i < files.length; i++) {
      if (ext(files[i].title) === "html") return files[i].content || "";
    }
    return null;
  }

  function toDataURI(content, name) {
    var mime = MIME[ext(name)] || "text/plain";
    return "data:" + mime + ";charset=utf-8," + encodeURIComponent(content);
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

    var links = doc.querySelectorAll('link[rel~="stylesheet"][href]');
    Array.prototype.forEach.call(links, function (link) {
      var css = lookup(map, link.getAttribute("href"));
      if (css == null) return;
      var style = doc.createElement("style");
      style.textContent = inlineCSSUrls(css, map);
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
      inline.textContent = js;
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

    var html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    return { html: html };
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
      window.AgentGateExport.renderExportControl(headerRight, {
        kind: "app",
        title: data.title || "webapp",
        // The running app is a sandboxed iframe that cannot be re-rendered
        // off-screen, so PDF is a best-effort print of the live page.
        multi: false,
        pdfLive: true,
        sources: files.map(function (f) {
          return { name: f.title, content: f.content };
        }),
      });
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
