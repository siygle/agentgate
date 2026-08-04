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

  // --- feedback notes ----------------------------------------------------------------
  // Local-only review notes, kept on the host: the frame runs in an opaque origin and
  // has no localStorage at all.

  function feedbackKey(shareId) {
    return "agentgate-plan-feedback-" + shareId;
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

  function createFeedbackPanel(shareId, titleText) {
    var items = loadFeedback(shareId);

    var aside = el("aside", "plan-feedback collapsed");
    var header = el("div", "plan-feedback-toggle");
    header.appendChild(el("span", null, "Chat / Feedback"));
    header.appendChild(el("span", "plan-feedback-chevron", "▲"));
    header.addEventListener("click", function () {
      aside.classList.toggle("collapsed");
    });
    aside.appendChild(header);

    var content = el("div", "plan-feedback-content");
    content.appendChild(
      el("p", "plan-feedback-hint", "Local-only notes for now. Copy them back to your agent after review.")
    );

    var list = el("div", "plan-feedback-list");

    function redraw() {
      list.textContent = "";
      items.forEach(function (item, idx) {
        var wrap = el("div", "plan-feedback-item");
        wrap.appendChild(el("div", "plan-feedback-meta", "#" + (idx + 1) + " · " + item.created_at));
        wrap.appendChild(el("div", null, item.text));
        list.appendChild(wrap);
      });
    }

    var ta = el("textarea", "form-input plan-feedback-input");
    ta.placeholder = "Leave feedback, questions, or change requests...";

    var actions = el("div", "plan-feedback-actions");

    var add = el("button", "btn", "Add");
    add.type = "button";
    add.addEventListener("click", function () {
      var text = (ta.value || "").trim();
      if (!text) return;
      items.push({ text: text, created_at: new Date().toLocaleString() });
      saveFeedback(shareId, items);
      ta.value = "";
      redraw();
    });

    var copy = el("button", "btn", "Copy for agent");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var text =
        "Feedback for " + titleText + "\n\n" +
        items
          .map(function (item, i) {
            return i + 1 + ". " + item.text;
          })
          .join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(function () {
        copy.textContent = "Copy for agent";
      }, 1200);
    });

    actions.appendChild(add);
    actions.appendChild(copy);
    content.appendChild(list);
    content.appendChild(ta);
    content.appendChild(actions);
    aside.appendChild(content);
    redraw();
    return aside;
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
    open.title = "Open in a new tab (standalone, no network access)";
    open.setAttribute("aria-label", "Open in a new tab");
    open.addEventListener("click", function () {
      var url = handle.objectURL();
      var win = window.open(url, "_blank");
      // Revoking immediately would race the new tab's load.
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 60000);
      if (!win) open.title = "Popup blocked — allow popups to open standalone";
    });

    var save = el("button", "btn btn-icon", "⤓");
    save.type = "button";
    save.title = "Save as a single self-contained .html file";
    save.setAttribute("aria-label", "Save as HTML");
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
      app.textContent = "Sandbox unavailable — sandbox.js failed to load.";
      return;
    }

    var files = data.files || [];
    var shareId = window.AgentGateShare ? window.AgentGateShare.getShareId() : "unknown";

    // An uploaded webapp keeps a viewport-height frame (see .shell-viewer--fixed);
    // built-in renderers grow to their content instead.
    var viewer = el("div", "shell-viewer" + (config.webapp ? " shell-viewer--fixed" : ""));
    var headerEl = el("header", "file-viewer-header");
    var headerLeft = row();
    var headerRight = row();
    headerRight.style.flexShrink = "0";

    headerLeft.appendChild(el("span", null, config.label));

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

    var frameHost = el("div", "shell-frame-host");
    viewer.appendChild(frameHost);

    var loading = el("div", "app-error", "Preparing…");
    frameHost.appendChild(loading);

    app.textContent = "";
    app.appendChild(viewer);

    var Settings = window.AgentGateSettings;

    // An uploaded webapp brings its own document; a built-in renderer is fetched from the
    // server and handed the payload as inert JSON.
    var assembled = config.webapp
      ? Sandbox.assembleWebapp(files, { allowEval: !!config.allowEval })
      : Sandbox.assembleRenderer(config.renderer, data, {
          features: config.features || {},
          allowEval: !!config.allowEval,
          settings: Settings ? Settings.describe() : null,
          hash: location.hash || "",
          prefs: loadPrefs(config.renderer),
        });

    assembled
      .then(function (result) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);

        if (result.error) {
          frameHost.appendChild(el("div", "app-error", result.error));
          return;
        }

        // autoHeight grows the frame to its reported content height so the host page owns
        // the only scrollbar. Off for uploaded webapps: they were authored against a
        // fixed-size viewport and may use vh units or scroll internally, so growing the
        // frame could change how existing shares look.
        var handle = Sandbox.mount(frameHost, result.html, {
          className: config.webapp ? "app-frame" : "shell-frame",
          autoHeight: !config.webapp,
        });

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
              for (var i = 0; i < files.length; i++) {
                if ((files[i].title || "") === currentFile) return files[i];
              }
              return files[0] || null;
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

        if (config.feedback) {
          viewer.appendChild(createFeedbackPanel(shareId, config.title));
        }
      })
      .catch(function (err) {
        console.error("Failed to prepare renderer:", err);
        loading.textContent = "Failed to render: " + (err && err.message ? err.message : err);
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
          if (P) P.updatePassphraseError("Decryption failed. Please check your passphrase.");
        });
    }

    function init() {
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
