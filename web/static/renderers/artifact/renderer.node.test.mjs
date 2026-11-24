// web/static/renderers/artifact/renderer.node.test.mjs
// Run: node web/static/renderers/artifact/renderer.node.test.mjs
//
// Exercises the artifact renderer's Sucrase TSX/JSX transpilation, virtual module
// resolver, CSS/JSON imports, Lucide fallback proxy, and entry selection against the
// real vendored artifact-runtime.bundle.js.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const runtimeSrc = readFileSync(new URL("../../vendor/artifact-runtime.bundle.js", import.meta.url), "utf8");
const rendererSrc = readFileSync(new URL("./renderer.js", import.meta.url), "utf8");

const win = {};
// Run the real vendored React 18 + Sucrase bundle in an isolated global-like scope.
new Function("globalThis", runtimeSrc)(win);
new Function("window", rendererSrc)(win);

const Core = win.AgentGateArtifactCore;
assert.ok(Core, "AgentGateArtifactCore exported");

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- path helpers -----------------------------------------------------------------
{
  check("normalizePath strips ./ and query", Core.normalizePath("./src/App.tsx?v=1") === "src/App.tsx");
  check("resolveRelativePath sibling", Core.resolveRelativePath("src/App.tsx", "./Button") === "src/Button");
  check("resolveRelativePath parent", Core.resolveRelativePath("src/ui/Card.tsx", "../utils/fmt") === "src/utils/fmt");
  check("resolveRelativePath root-relative", Core.resolveRelativePath("src/a/b.tsx", "/shared") === "shared");

  const lookup = {
    "src/App.tsx": { title: "src/App.tsx", content: "" },
    "src/ui/Button.tsx": { title: "src/ui/Button.tsx", content: "" },
    "src/utils/index.ts": { title: "src/utils/index.ts", content: "" },
  };
  check("resolveLocalFile appends .tsx", Core.resolveLocalFile(lookup, "src/App.tsx", "./ui/Button")?.path === "src/ui/Button.tsx");
  check("resolveLocalFile resolves /index.ts", Core.resolveLocalFile(lookup, "src/App.tsx", "./utils")?.path === "src/utils/index.ts");
  check("resolveLocalFile returns null on miss", Core.resolveLocalFile(lookup, "src/App.tsx", "./missing") === null);
}

// --- entry selection --------------------------------------------------------------
{
  const files = [
    { title: "styles.css", content: "" },
    { title: "helper.ts", content: "" },
    { title: "App.tsx", content: "" },
  ];
  check("pickEntryFile prefers explicit entry", Core.pickEntryFile({ entry: "helper.ts" }, files).title === "helper.ts");
  check("pickEntryFile falls back to App.tsx", Core.pickEntryFile({}, files).title === "App.tsx");
  check("pickEntryFile handles svg", Core.pickEntryFile({}, [{ title: "chart.svg", content: "<svg/>" }]).title === "chart.svg");
  check("pickEntryFile handles mmd", Core.pickEntryFile({}, [{ title: "flow.mmd", content: "graph TD" }]).title === "flow.mmd");
}

// --- compileAndExecute: multi-file TSX + JSON + CSS + Lucide proxy ----------------
{
  const injectedStyles = [];
  const files = [
    {
      title: "App.tsx",
      content: `
        import React, { useState } from "react";
        import { Sparkles, TotallyInventedIcon } from "lucide-react";
        import { Label } from "./components/Label";
        import cfg from "./config.json";
        import "./app.css";

        interface Props { title?: string }
        export default function App(props: Props) {
          return (
            <div className="p-4">
              <Sparkles size={16} />
              <TotallyInventedIcon size={20} />
              <Label text={props.title || cfg.name} />
            </div>
          );
        }
      `,
    },
    {
      title: "components/Label.tsx",
      content: `
        import React from "react";
        export function Label({ text }: { text: string }) {
          return <span>{text}</span>;
        }
      `,
    },
    {
      title: "config.json",
      content: JSON.stringify({ name: "AgentGate Artifact" }),
    },
    {
      title: "app.css",
      content: ".p-4 { padding: 1rem; }",
    },
    {
      title: "extra.css",
      content: "body { color: red; }",
    },
  ];

  const fakeGlobals = Object.assign({}, win, {
    LucideReact: {
      Sparkles: function Sparkles() {
        return win.React.createElement("svg", { "data-icon": "Sparkles" });
      },
    },
  });

  const mod = Core.compileAndExecute(files, "App.tsx", fakeGlobals, (path, css) => {
    injectedStyles.push({ path, css });
  });

  check("default export is a React component function", typeof mod.default === "function");
  const el = mod.default({});
  check("component returns a React element", el && el.type === "div");
  check("explicitly imported CSS was injected", injectedStyles.some((s) => s.path === "app.css"));
  check("standalone unimported CSS was auto-injected", injectedStyles.some((s) => s.path === "extra.css"));

  // Verify Lucide fallback proxy produces an SVG element for unknown icon names.
  const builtins = Core.buildBuiltinModules(fakeGlobals);
  const MissingIcon = builtins["lucide-react"].NonExistentIcon;
  check("lucide proxy returns fallback component", typeof MissingIcon === "function");
  const fallbackSvg = MissingIcon({ size: 24 });
  check("fallback icon renders svg with data-missing-icon", fallbackSvg.type === "svg" && fallbackSvg.props["data-missing-icon"] === "NonExistentIcon");
}

// --- error reporting on bad imports -----------------------------------------------
{
  const badImport = [{ title: "App.jsx", content: 'import foo from "some-unbundled-pkg"; export default () => foo;' }];
  assert.throws(
    () => Core.compileAndExecute(badImport, "App.jsx", win),
    /Unsupported import "some-unbundled-pkg"/,
    "unsupported bare import throws actionable error"
  );
  checks++;

  const missingLocal = [{ title: "App.jsx", content: 'import x from "./does-not-exist"; export default () => x;' }];
  assert.throws(
    () => Core.compileAndExecute(missingLocal, "App.jsx", win),
    /Module not found: "\.\/does-not-exist"/,
    "missing local import throws clear error"
  );
  checks++;
}

console.log(`artifact-renderer: ${checks} checks passed`);
