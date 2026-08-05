// web/static/js/share-kind.node.test.mjs
// Run: node web/static/js/share-kind.node.test.mjs
//
// Two things are tested here, both of which fail in ways that are easy to miss:
//
//   classify()       picks the renderer. Getting it wrong shows a share in the wrong
//                    viewer, and it has to cope with three generations of payload plus
//                    five legacy URL prefixes that must keep working forever.
//   detectFeatures() decides which libraries the sandbox inlines. A false positive only
//                    wastes bytes; a FALSE NEGATIVE silently breaks rendering, so the
//                    negative cases below matter more than the positive ones.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const src = readFileSync(new URL("./share-kind.js", import.meta.url), "utf8");

// load returns AgentGateShareKind as if the page had been opened at /<view>/<id>.
function load(view) {
  const win = { AgentGateShare: { route: view ? { view, id: "ABC123" } : null } };
  new Function("window", src)(win);
  return win.AgentGateShareKind;
}

const K = load("s");
let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- classify ---------------------------------------------------------------------

{
  // A declared kind always wins.
  check("visual-plan by kind", K.classify({ kind: "visual-plan", files: [] }) === "visual-plan");
  check("visual-recap maps to visual-plan", K.classify({ kind: "visual-recap", files: [] }) === "visual-plan");
  check("documents by kind", K.classify({ kind: "documents", files: [] }) === "documents");
  check("webapp by kind", K.classify({ kind: "webapp", files: [] }) === "webapp");
  check("diff by kind", K.classify({ kind: "diff", files: [] }) === "diff");
}

{
  // Unlabelled payloads (the FilesPayload generation) are recognised by shape.
  const webapp = { files: [{ title: "index.html", content: "<html>" }, { title: "app.js", content: "" }] };
  check("root index.html means webapp", K.classify(webapp) === "webapp");
  check("./index.html also counts", K.classify({ files: [{ title: "./index.html", content: "" }] }) === "webapp");
  check(
    "a nested index.html does NOT",
    K.classify({ files: [{ title: "sub/index.html", content: "" }] }) !== "webapp"
  );

  const diff = {
    files: [{ filename: "a.go", patch: "diff --git a/a.go b/a.go\n@@ -1 +1 @@\n-a\n+b\n" }],
  };
  check("patch field means diff", K.classify(diff) === "diff");
  check(
    "unified-diff body means diff",
    K.classify({ files: [{ title: "x", content: "--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n" }] }) === "diff"
  );
  check(
    "ordinary files are files",
    K.classify({ files: [{ title: "go.mod", content: "module x\n" }] }) === "files"
  );
}

{
  // The URL is only a tiebreaker, and only for payloads that say nothing themselves —
  // this is what keeps an old /app/ or /plan/ link opening the way it used to.
  const plain = { files: [{ title: "notes.md", content: "# hi" }] };
  check("/app/ tiebreaks to webapp", load("app").classify(plain) === "webapp");
  check("/plan/ tiebreaks to visual-plan", load("plan").classify(plain) === "visual-plan");
  check("/d/ tiebreaks to documents", load("d").classify(plain) === "documents");
  check("/p/ tiebreaks to diff", load("p").classify(plain) === "diff");
  check("/f/ falls through to files", load("f").classify(plain) === "files");
  check("/s/ falls through to files", load("s").classify(plain) === "files");
  // A declared kind still beats the URL, so a /f/ link to a webapp opens as a webapp.
  check(
    "payload shape beats the URL",
    load("f").classify({ files: [{ title: "index.html", content: "" }] }) === "webapp"
  );
}

// --- detectFeatures: mermaid ------------------------------------------------------

const doc = (content, extra) =>
  K.detectFeatures(Object.assign({ files: [{ title: "a.md", content }] }, extra || {}),
    [{ title: "a.md", content }], "doc");

{
  // Every way a diagram can appear must be detected — a miss means a blank diagram.
  for (const [label, content] of [
    ["``` fence", "# t\n\n```mermaid\nflowchart LR\n A-->B\n```\n"],
    ["fence with spaces", "```  mermaid\ngraph TD\n```"],
    ["longer fence", "````mermaid\ngraph TD\n````"],
    ["~~~ fence", "~~~mermaid\ngraph TD\n~~~"],
    ["indented fence", "  ```mermaid\ngraph TD\n```"],
    ["uppercase fence", "```MERMAID\ngraph TD\n```"],
    ["MDX self-closing tag", '<Mermaid source={`graph TD`} />'],
    ["MDX tag with attrs", '<Mermaid caption="x" source={`a`} />'],
    ["author div", '<div class="mermaid">graph TD</div>'],
    ["author div, extra classes", '<div class="foo mermaid bar">graph TD</div>'],
    ["unquoted class", "<div class=mermaid>graph TD</div>"],
  ]) {
    check(`mermaid detected: ${label}`, doc(content).mermaid === true);
  }

  // And prose that merely mentions the word must NOT drag in 3.3 MB.
  for (const [label, content] of [
    ["plain prose", "# Notes\n\nNothing to see."],
    ["the word in prose", "We considered mermaid diagrams but used prose instead."],
    ["a code fence of another language", "```go\nfunc main() {}\n```"],
    ["mermaid inside an inline span", "Use `mermaid` for diagrams."],
  ]) {
    check(`mermaid NOT pulled in: ${label}`, doc(content).mermaid === false);
  }
}

// --- detectFeatures: highlight ----------------------------------------------------

{
  check("code fence needs highlight", doc("```go\nx\n```").highlight === true);
  check("~~~ fence needs highlight", doc("~~~\nx\n~~~").highlight === true);
  check("<pre> needs highlight", doc("<pre>x</pre>").highlight === true);
  check("<code> needs highlight", doc("<code>x</code>").highlight === true);
  check("prose does not", doc("# Just words\n\nAnd more words.").highlight === false);
  // A mermaid fence becomes a diagram container, not a <pre><code>, so a diagram-only
  // document does not need hljs — 127 KB it would otherwise carry for nothing.
  check("a mermaid-only doc does not need highlight", doc("```mermaid\ngraph TD\n```").highlight === false);
  check("a mermaid-only doc still needs mermaid", doc("```mermaid\ngraph TD\n```").mermaid === true);
  check(
    "mermaid plus real code still needs highlight",
    doc("```mermaid\ngraph TD\n```\n\n```go\nx\n```").highlight === true
  );

  // MDX counts regardless of visible fences: Endpoint/AnnotatedCode/Diff emit their own
  // <pre><code>, so gating on fences alone would leave those unstyled.
  const mdxFiles = [{ title: "plan.mdx", content: "<Endpoint method=\"GET\" path=\"/x\" />" }];
  const mdxFeatures = K.detectFeatures({ files: mdxFiles, entry: "plan.mdx" }, mdxFiles, "doc");
  check("mdx implies highlight", mdxFeatures.highlight === true);
  check("mdx implies mdx", mdxFeatures.mdx === true);
}

// --- detectFeatures: mdx ----------------------------------------------------------

{
  const byName = [{ title: "plan.mdx", content: "# x" }];
  check("an .mdx file enables mdx", K.detectFeatures({ files: byName }, byName, "doc").mdx === true);
  const byEntry = [{ title: "a.md", content: "# x" }];
  check(
    "an .mdx entry enables mdx",
    K.detectFeatures({ files: byEntry, entry: "plan.mdx" }, byEntry, "doc").mdx === true
  );
  check(
    "legacy plan_mdx enables mdx",
    K.detectFeatures({ files: [], plan_mdx: "# x" }, [], "doc").mdx === true
  );
  check("plain markdown does not", K.detectFeatures({ files: byEntry }, byEntry, "doc").mdx === false);
}

// --- detectFeatures: the files renderer -------------------------------------------

{
  const md = [{ title: "README.md", content: "# hi" }];
  const code = [{ title: "main.go", content: "package main" }];
  const both = md.concat(code);

  check("markdown-only bundle wants marked", K.detectFeatures({ files: md }, md, "files").markdown === true);
  check("code-only bundle does not", K.detectFeatures({ files: code }, code, "files").markdown === false);
  check("mixed bundle wants marked", K.detectFeatures({ files: both }, both, "files").markdown === true);
  // Not gated: the Source tab highlights every file including markdown, so withholding
  // hljs would leave source panes unstyled.
  check("code bundle wants highlight", K.detectFeatures({ files: code }, code, "files").highlight === true);
  check("markdown-only bundle still wants highlight", K.detectFeatures({ files: md }, md, "files").highlight === true);
  check("files never wants mermaid", K.detectFeatures({ files: md }, md, "files").mermaid === false);
  check("files never wants mdx", K.detectFeatures({ files: md }, md, "files").mdx === false);
}

// --- detectFeatures: robustness ---------------------------------------------------

{
  // Binary assets are base64; scanning them for source patterns would only misfire.
  const withBinary = [
    { title: "notes.md", content: "# prose only" },
    { title: "logo.png", content: "bWVybWFpZAo=", encoding: "base64" },
  ];
  check(
    "base64 assets are not scanned",
    K.detectFeatures({ files: withBinary }, withBinary, "doc").mermaid === false
  );

  assert.doesNotThrow(() => K.detectFeatures({}, [], "doc"), "empty payload");
  assert.doesNotThrow(() => K.detectFeatures({ files: [{}] }, [{}], "doc"), "file with no fields");
  checks += 2;

  // plan() must always hand the shell a features object, or the sandbox drops everything.
  for (const payload of [
    { kind: "documents", files: [{ title: "a.md", content: "# x" }] },
    { kind: "visual-plan", files: [{ title: "a.mdx", content: "# x" }] },
    { kind: "diff", files: [{ filename: "a", patch: "@@ -1 +1 @@" }] },
    { files: [{ title: "a.go", content: "package a" }] },
  ]) {
    const cfg = K.plan(payload);
    check(`plan() returns features for ${K.classify(payload)}`, !!cfg.features);
  }
  // A webapp brings its own document, so gating does not apply to it.
  check("webapp config needs no features", K.plan({ kind: "webapp", files: [] }).webapp === true);
  // allowEval must track mdx exactly — it is a CSP relaxation.
  check(
    "allowEval only for mdx",
    K.plan({ kind: "documents", files: [{ title: "a.mdx", content: "# x" }] }).allowEval === true &&
      K.plan({ kind: "documents", files: [{ title: "a.md", content: "# x" }] }).allowEval === false
  );
}

console.log(`share-kind: ${checks} checks passed`);
