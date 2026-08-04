(function () {
  "use strict";

  // Decides which built-in renderer a decrypted payload should be shown with, and how the
  // shell should label it.
  //
  // This is the one place the taxonomy lives. It has to cope with three generations of
  // payload at once, because shares can be created with --no-expiry and never go away:
  //
  //   1. DiffPayload   { title, files: [{ filename, patch, ... }] }
  //   2. FilesPayload  { files: [{ title, content, encoding? }] }   — no `kind` field
  //   3. PlanPayload   { kind, title, entry, files, generated_at }
  //
  // Only the third says what it is, so the first two are recognised by shape. The URL
  // prefix is used only as a tiebreaker: an old /app/ link should keep opening as a
  // webapp even though nothing in the payload marks it as one.

  function hasRootIndexHtml(files) {
    return files.some(function (f) {
      return (f.title || "").replace(/^\.?\//, "") === "index.html";
    });
  }

  // A diff payload's entries carry `patch` instead of `content`; that, or a body that
  // starts with a unified-diff header, is enough to tell them apart.
  function looksLikeDiff(files) {
    if (!files.length) return false;
    return files.every(function (f) {
      if (typeof f.patch === "string") return true;
      var body = String(f.content || "");
      return /^(diff --git |--- |\+\+\+ |@@ )/m.test(body.slice(0, 400));
    });
  }

  function hasMdx(data, files) {
    return (
      !!data.plan_mdx ||
      /\.mdx$/i.test(data.entry || "") ||
      files.some(function (f) {
        return /\.mdx$/i.test(f.title || "");
      })
    );
  }

  function isMarkdownName(name) {
    return /\.(md|mdx|markdown)$/i.test(name || "");
  }

  // payloadText concatenates every text file in the bundle. Binary assets carry
  // encoding "base64" and are skipped — scanning base64 for source patterns would only
  // produce false positives.
  function payloadText(data, files) {
    var parts = files
      .filter(function (f) {
        return f.encoding !== "base64";
      })
      .map(function (f) {
        return String(f.content || "");
      });
    if (data.plan_mdx) parts.push(String(data.plan_mdx));
    return parts.join("\n");
  }

  // detectFeatures decides which built-in libraries a payload actually needs, so the
  // sandbox can leave the rest out. This matters a lot: mermaid alone is 3.3 MB, and
  // before this every document frame carried it whether or not it contained a diagram.
  //
  // Detection is deliberately over-inclusive. Including a library that turns out to be
  // unused only costs bytes; leaving out one that IS used breaks rendering, so every rule
  // here errs toward including. The renderers also say so out loud when they find content
  // needing a library that was not inlined, rather than degrading quietly.
  function detectFeatures(data, files, type) {
    var text = payloadText(data, files);
    var mdx = hasMdx(data, files);

    // A ```mermaid / ~~~mermaid fence, the MDX <Mermaid> component, or an author-written
    // .mermaid container.
    var mermaid = /(^|\n)\s*(```+|~~~+)\s*mermaid\b/i.test(text) ||
      /<Mermaid[\s/>]/.test(text) ||
      /class\s*=\s*["']?[^"'>]*\bmermaid\b/i.test(text);

    // Fenced or inline code needs highlighting. Mermaid fences are excluded because the
    // doc renderer turns them into diagram containers, leaving no <pre><code> behind — so
    // a diagram-only document does not need hljs. MDX always counts: several of its
    // components (Endpoint, AnnotatedCode, Diff) emit <pre><code> of their own.
    var withoutMermaidFences = text.replace(/(^|\n)\s*(```+|~~~+)\s*mermaid\b[\s\S]*?\2/gi, "\n");
    var code =
      /(^|\n)\s*(```+|~~~+)/.test(withoutMermaidFences) ||
      /<pre[\s>]|<code[\s>]/i.test(withoutMermaidFences) ||
      mdx;

    var hasMarkdown = files.some(function (f) {
      return isMarkdownName(f.title);
    });

    if (type === "files") {
      // The files renderer displays every file's source through hljs, markdown included
      // (its Source tab highlights the raw markdown), so highlighting is not gated here —
      // gating it would leave source panes unstyled. `marked` is, since a bundle with no
      // markdown never renders a preview.
      return { markdown: hasMarkdown, highlight: true, mermaid: false, mdx: false };
    }
    // doc renderer: it always renders markdown, so `marked` is not gated.
    return { markdown: true, highlight: code, mermaid: mermaid, mdx: mdx };
  }

  function routeView() {
    var route = window.AgentGateShare && window.AgentGateShare.route;
    return (route && route.view) || "";
  }

  // classify returns "diff" | "webapp" | "documents" | "visual-plan" | "files".
  function classify(data) {
    var files = data.files || [];
    var kind = data.kind || "";

    if (kind === "visual-plan" || kind === "visual-recap") return "visual-plan";
    if (kind === "documents") return "documents";
    if (kind === "webapp") return "webapp";
    if (kind === "diff") return "diff";

    // Unlabelled payloads: shape first, then the URL the visitor arrived on.
    if (hasRootIndexHtml(files)) return "webapp";
    if (looksLikeDiff(files)) return "diff";

    var view = routeView();
    if (view === "app") return "webapp";
    if (view === "plan") return "visual-plan";
    if (view === "d") return "documents";
    if (view === "p") return "diff";
    return "files";
  }

  // plan maps a decrypted payload to the render config AgentGateShell.render expects.
  function plan(data) {
    var files = data.files || [];
    var type = classify(data);
    var title =
      data.title ||
      (data.entry || "").replace(/\.[^.]+$/, "") ||
      (files.length === 1 ? files[0].title : "");

    if (type === "webapp") {
      return {
        webapp: true,
        label: "webapp — " + files.length + " file" + (files.length === 1 ? "" : "s"),
        title: title || "webapp",
        exportKind: "app",
      };
    }

    if (type === "diff") {
      return {
        renderer: "diff",
        label: "diff — " + (title || "untitled"),
        // A diff always needs diff2html to parse it and hljs to colour it, so there is
        // nothing to gate here.
        features: { highlight: true },
        title: title || "diff",
        exportKind: "diff",
      };
    }

    if (type === "visual-plan" || type === "documents") {
      var isPlan = type === "visual-plan";
      var features = detectFeatures(data, files, "doc");
      return {
        renderer: "doc",
        label: (isPlan ? "visual plan" : "documents") + " — " + (title || "untitled"),
        title: title || (isPlan ? "Visual plan" : "Documents"),
        features: features,
        // MDX compilation evaluates the compiled document body, so its frame needs
        // 'unsafe-eval'. Granted only when the bundle actually contains MDX.
        allowEval: features.mdx,
        feedback: isPlan,
        exportKind: isPlan ? "plan" : "docs",
      };
    }

    return {
      renderer: "files",
      label: files.length + " file" + (files.length === 1 ? "" : "s"),
      title: title || "files",
      features: detectFeatures(data, files, "files"),
      exportKind: "files",
    };
  }

  window.AgentGateShareKind = { classify: classify, plan: plan, detectFeatures: detectFeatures };
})();
