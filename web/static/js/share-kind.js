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
        title: title || "diff",
        exportKind: "diff",
      };
    }

    if (type === "visual-plan" || type === "documents") {
      var isPlan = type === "visual-plan";
      var mdx = hasMdx(data, files);
      return {
        renderer: "doc",
        label: (isPlan ? "visual plan" : "documents") + " — " + (title || "untitled"),
        title: title || (isPlan ? "Visual plan" : "Documents"),
        // MDX pulls in a 584 KB React bundle and needs 'unsafe-eval' in the frame's CSP,
        // so it is enabled only when the bundle actually contains an .mdx file.
        features: { mdx: mdx },
        allowEval: mdx,
        feedback: isPlan,
        exportKind: isPlan ? "plan" : "docs",
      };
    }

    return {
      renderer: "files",
      label: files.length + " file" + (files.length === 1 ? "" : "s"),
      title: title || "files",
      exportKind: "files",
    };
  }

  window.AgentGateShareKind = { classify: classify, plan: plan };
})();
