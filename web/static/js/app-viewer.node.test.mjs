// web/static/js/app-viewer.node.test.mjs
// Run: node web/static/js/app-viewer.node.test.mjs
//
// Covers the agentgate: builtin-library alias table. A broken alias fails silently
// in the browser (the <script src="agentgate:…"> is simply left unresolved and the
// framed app hits an undefined global), so it is worth asserting here. DOM assembly
// itself is verified by opening a real share — Node has no DOMParser.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert";

// Shim the handful of browser globals app-viewer.js touches at load time, then run
// the IIFE to populate window.AgentGateApp.
globalThis.window = {};
globalThis.document = { addEventListener() {} };
const src = readFileSync(new URL("./app-viewer.js", import.meta.url), "utf8");
new Function(src)();
const App = globalThis.window.AgentGateApp;

const libs = App.builtinLibs;
const resolve = App.resolveBuiltin;
const vendorDir = new URL("../vendor/", import.meta.url);

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// 1. Every alias must point at a file that actually ships. A filename typo would
//    otherwise degrade to "alias silently does nothing".
for (const [name, lib] of Object.entries(libs)) {
  check(`${name} -> vendor/${lib.file} exists`, existsSync(new URL(lib.file, vendorDir)));
  check(`${name} declares a known type`, lib.type === "js" || lib.type === "css");
  check(`${name} file extension matches its type`, lib.file.endsWith("." + lib.type));
}

// 2. All four accepted spellings resolve to the same vendored URL.
for (const [name, lib] of Object.entries(libs)) {
  const expected = "/static/vendor/" + lib.file;
  for (const spelling of [
    `agentgate:${name}`,
    `agentgate://vendor/${name}.${lib.type}`,
    `agentgate://vendor/${lib.file}`,
    expected,
  ]) {
    const got = resolve(spelling, lib.type);
    check(`${spelling} resolves`, got && got.url === expected);
  }
}

// 3. Type is enforced: a <script src> must not pull in a stylesheet, and a
//    <link rel=stylesheet> must not pull in a script.
check("script ref cannot resolve a css builtin", resolve("agentgate:highlight-css", "js") === null);
check("style ref cannot resolve a js builtin", resolve("agentgate:mermaid", "css") === null);

// 4. Query strings and fragments are stripped (cache-busting refs still resolve).
check("query string ignored", resolve("agentgate:marked?v=2", "js") !== null);
check("fragment ignored", resolve("agentgate:marked#x", "js") !== null);

// 5. Anything unknown resolves to null, so bundle-local and remote refs are untouched.
for (const ref of ["", null, undefined, "./app.js", "https://cdn.example.com/x.js", "agentgate:nope"]) {
  check(`unknown ref ${JSON.stringify(ref)} -> null`, resolve(ref, "js") === null);
}

// 6. Back-compat: the spellings documented before the alias table was generalised
//    must keep working, or existing uploaded webapps break.
for (const legacy of [
  "agentgate:lightweight-charts",
  "agentgate://vendor/lightweight-charts.js",
  "agentgate://vendor/lightweight-charts.standalone.production.js",
  "/static/vendor/lightweight-charts.standalone.production.js",
]) {
  const got = resolve(legacy, "js");
  check(
    `legacy spelling ${legacy} still resolves`,
    got && got.url === "/static/vendor/lightweight-charts.standalone.production.js"
  );
}

console.log(`app-viewer builtin aliases: ${checks} checks passed`);
