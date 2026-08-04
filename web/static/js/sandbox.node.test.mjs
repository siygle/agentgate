// web/static/js/sandbox.node.test.mjs
// Run: node web/static/js/sandbox.node.test.mjs
//
// sandbox.js is the single rendering path for share content, so its escaping, payload
// embedding, CSP construction, and builtin resolution are all security-relevant. DOM
// assembly needs a real DOMParser and is covered by the browser-level checks instead.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert";

const win = {};
const src = readFileSync(new URL("./sandbox.js", import.meta.url), "utf8");
new Function("window", "document", "fetch", "URL", "Blob", src)(
  win,
  { addEventListener() {} },
  () => Promise.reject(new Error("unused")),
  globalThis.URL,
  globalThis.Blob
);
const S = win.AgentGateSandbox;
const I = S._internals;

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- the injected bridge must be valid JS ----------------------------------------
// It is assembled from string fragments, so nothing else would catch a syntax error.
{
  assert.doesNotThrow(() => new Function(I.BRIDGE_SOURCE), "BRIDGE_SOURCE parses as JS");
  checks++;
  // The bridge must define the hook renderers subscribe through, and must not leak the
  // parent reference to anything but postMessage.
  check("bridge defines window.AgentGateFrame", /window\.AgentGateFrame\s*=/.test(I.BRIDGE_SOURCE));
  check("bridge only touches parent via postMessage", (I.BRIDGE_SOURCE.match(/parent\./g) || []).every(() => true) &&
    !/parent\.(?!postMessage)/.test(I.BRIDGE_SOURCE));
}

// --- payload embedding ------------------------------------------------------------
{
  // A payload that contains markup must not be able to break out of the JSON block.
  // Escaping only "</script" would leave "<!--" as a way to truncate it.
  const hostile = { a: "</script><img src=x onerror=alert(1)>", b: "<!--", c: "<script>" };
  const out = I.jsonForScriptTag(hostile);
  check("no literal < survives", !out.includes("<"));
  check("round-trips to the original", JSON.stringify(JSON.parse(out)) === JSON.stringify(hostile));
  check("unicode-escapes the angle bracket", out.includes("\\u003c"));
}

{
  // Non-ASCII and lone surrogates must not corrupt the block.
  const data = { t: "日本語 — em dash", emoji: "🔐" };
  check("unicode round-trips", JSON.parse(I.jsonForScriptTag(data)).emoji === "🔐");
}

// --- escaping ---------------------------------------------------------------------
{
  check("script escape is case-insensitive", I.escapeScriptText("a</SCRIPT>b") === "a<\\/SCRIPT>b");
  check("style escape is case-insensitive", I.escapeStyleText("a</StYlE>b") === "a<\\/StYlE>b");
  check("script escape leaves ordinary text alone", I.escapeScriptText("var x = a < b;") === "var x = a < b;");
  check("escapes handle null", I.escapeScriptText(null) === "" && I.escapeStyleText(undefined) === "");
}

// --- CSP --------------------------------------------------------------------------
{
  const tight = S.frameCSP(false);
  const loose = S.frameCSP(true);
  // These four are the actual security boundary; a regression here is the whole point.
  for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
    check(`tight CSP has ${directive}`, tight.includes(directive));
    check(`eval CSP still has ${directive}`, loose.includes(directive));
  }
  check("tight CSP withholds unsafe-eval", !tight.includes("unsafe-eval"));
  check("eval CSP grants unsafe-eval", loose.includes("'unsafe-eval'"));
  check("no scheme is allowed to connect", !/connect-src[^;]*(https?:|\*)/.test(loose));
  check("images limited to data:/blob:", /img-src data: blob:/.test(tight));
}

// --- builtin aliases --------------------------------------------------------------
{
  for (const [name, lib] of Object.entries(S.builtinLibs)) {
    // Most builtins are third-party libraries under /static/vendor; AgentGate's own
    // stylesheets declare dir: "css". A wrong dir or filename degrades to "the alias
    // silently does nothing", so both are asserted against the filesystem.
    const dir = lib.dir || "vendor";
    check(
      `${name} -> ${dir}/${lib.file} exists`,
      existsSync(new URL(`../${dir}/${lib.file}`, import.meta.url))
    );
    check(`${name} extension matches type`, lib.file.endsWith("." + lib.type));
    const expected = `/static/${dir}/${lib.file}`;
    for (const spelling of [
      `agentgate:${name}`,
      `agentgate://${dir}/${name}.${lib.type}`,
      `agentgate://${dir}/${lib.file}`,
      expected,
    ]) {
      const got = S.resolveBuiltin(spelling, lib.type);
      check(`${spelling} resolves`, got && got.url === expected);
    }
  }
  check("mdx builtin is present", "mdx" in S.builtinLibs);
  check("script ref cannot resolve css", S.resolveBuiltin("agentgate:highlight-css", "js") === null);
  check("style ref cannot resolve js", S.resolveBuiltin("agentgate:mermaid", "css") === null);
  check("query string ignored", S.resolveBuiltin("agentgate:marked?v=2", "js") !== null);
  for (const ref of ["", null, "./renderer.js", "https://cdn.example.com/x.js", "agentgate:nope"]) {
    check(`unknown ref ${JSON.stringify(ref)} -> null`, S.resolveBuiltin(ref, "js") === null);
  }
  // Back-compat: spellings documented before the table was generalised.
  for (const legacy of [
    "agentgate:lightweight-charts",
    "agentgate://vendor/lightweight-charts.js",
    "agentgate://vendor/lightweight-charts.standalone.production.js",
    "/static/vendor/lightweight-charts.standalone.production.js",
  ]) {
    const got = S.resolveBuiltin(legacy, "js");
    check(`legacy ${legacy} resolves`, got && got.url.endsWith("lightweight-charts.standalone.production.js"));
  }
}

// --- webapp feature gating --------------------------------------------------------
// Opt-in, and gated on the bundle mentioning the library elsewhere. Getting this wrong in
// the "drop it" direction breaks an uploaded webapp, so the false cases below are the
// important ones.
{
  const gatedTag = '<script src="agentgate:mermaid" data-agentgate-when="mermaid"></script>';

  // The gated tag must not count as evidence for itself, or gating would never drop
  // anything.
  const selfOnly = [{ title: "index.html", content: gatedTag + "<div>hello</div>" }];
  check("a gated tag is not its own evidence", !/agentgate:mermaid/.test(I.webappHaystack(selfOnly)));
  check("unused library is dropped", I.mentionsFeature(I.webappHaystack(selfOnly), "mermaid") === false);

  // Mentioned anywhere else in the bundle — inline script, separate file, or markup.
  for (const [label, extra] of [
    ["inline script", { title: "index.html", content: gatedTag + "<script>mermaid.run()</script>" }],
    ["separate file", { title: "app.js", content: "mermaid.initialize({})" }],
    ["a class in markup", { title: "index.html", content: gatedTag + '<div class="mermaid">g</div>' }],
  ]) {
    const bundle = extra.title === "index.html" ? [extra] : [selfOnly[0], extra];
    check(`used library kept: ${label}`, I.mentionsFeature(I.webappHaystack(bundle), "mermaid") === true);
  }

  // A comment cannot call anything. This matters in practice: a bundle that documents the
  // available libraries (docs/webapp-template/index.html does) would otherwise look like
  // it used every one of them.
  const commentOnly = [
    { title: "index.html", content: gatedTag + "<!-- mermaid is available if you need it -->" },
  ];
  check("a mention in an HTML comment does not count",
    I.mentionsFeature(I.webappHaystack(commentOnly), "mermaid") === false);
  const commentPlusUse = [
    { title: "index.html", content: gatedTag + "<!-- about mermaid --><script>mermaid.run()</script>" },
  ];
  check("a real use alongside a comment still counts",
    I.mentionsFeature(I.webappHaystack(commentPlusUse), "mermaid") === true);

  // Whole-word only, so a lookalike identifier does not drag 3.3 MB in.
  const lookalike = [selfOnly[0], { title: "app.js", content: "var mermaidish = 1; notmermaid();" }];
  check("substring is not a mention", I.mentionsFeature(I.webappHaystack(lookalike), "mermaid") === false);

  // Binary assets are base64 and could contain anything; they are not scanned.
  const binary = [selfOnly[0], { title: "img.png", content: "bWVybWFpZA==", encoding: "base64" }];
  check("base64 assets are not scanned", I.mentionsFeature(I.webappHaystack(binary), "mermaid") === false);

  // The attribute value goes into a RegExp, so it must not be able to change its meaning.
  const hostile = [{ title: "index.html", content: "anything at all" }];
  assert.doesNotThrow(
    () => I.mentionsFeature(I.webappHaystack(hostile), "a)|(.*"),
    "a hostile feature name cannot break the matcher"
  );
  check("empty feature name matches nothing", I.mentionsFeature("mermaid", "") === false);
  checks++;
}

// --- sanitising frame-reported values ---------------------------------------------
// Framed code can postMessage anything. It has nothing to exfiltrate, but the host must
// not hand a frame-supplied value to history.replaceState or to a layout property.
{
  // The attack these exist for: a hostile frame reporting a "deep link" that is really a
  // path, so replaceState rewrites the visible URL of a page the visitor trusts.
  for (const hostile of [
    "/admin",
    "//evil.example.com",
    "https://evil.example.com",
    "#/../admin",
    "#a b",
    "#a\nb",
    "#<script>",
    "#" + "x".repeat(300),
    "",
    null,
    undefined,
    {},
  ]) {
    check(`fragment rejected: ${JSON.stringify(hostile)}`, I.safeFragment(hostile) === "");
  }
  check("plain id accepted", I.safeFragment("#some-heading") === "#some-heading");
  check("missing hash is added", I.safeFragment("some-heading") === "#some-heading");
  check("duplicate hashes collapse", I.safeFragment("###top") === "#top");
  check("percent escapes survive", I.safeFragment("#a%20b") === "#a%20b");
  check("a returned fragment always starts with #", I.safeFragment("x").charAt(0) === "#");

  check("height clamped to the ceiling", I.clampHeight(1e12) === I.MAX_FRAME_HEIGHT);
  check("height floored", I.clampHeight(1) === 80);
  check("negative height floored", I.clampHeight(-5000) === 80);
  check("NaN height rejected", I.clampHeight("nope") === null);
  check("Infinity height rejected", I.clampHeight(Infinity) === null);
  check("ordinary height passes through", I.clampHeight(1353) === 1353);

  check("name passes through", I.safeName("plan.mdx") === "plan.mdx");
  check("absurdly long name rejected", I.safeName("x".repeat(600)) === "");
  check("null name becomes empty", I.safeName(null) === "");
}

// --- bundle file map --------------------------------------------------------------
{
  const map = I.buildFileMap([
    { title: "index.html", content: "<html>" },
    { title: "css/app.css", content: "body{}" },
    { title: "img/logo.png", content: "AAA", encoding: "base64" },
  ]);
  check("full path resolves", I.lookup(map, "css/app.css").content === "body{}");
  check("./-prefixed path resolves", I.lookup(map, "./css/app.css").content === "body{}");
  check("basename resolves", I.lookup(map, "app.css").content === "body{}");
  check("query stripped", I.lookup(map, "css/app.css?v=1").content === "body{}");
  check("absolute urls are not bundle refs", I.lookup(map, "https://x/app.css") === null);
  check("data urls are not bundle refs", I.lookup(map, "data:text/css,a") === null);
  check("missing ref is null", I.lookup(map, "nope.css") === null);
  check("base64 entry becomes a base64 data uri",
    I.toDataURI(map["img/logo.png"], "logo.png") === "data:image/png;base64,AAA");
  check("text entry is percent-encoded",
    I.toDataURI(map["css/app.css"], "app.css").startsWith("data:text/css;charset=utf-8,"));
}

console.log(`sandbox: ${checks} checks passed`);
