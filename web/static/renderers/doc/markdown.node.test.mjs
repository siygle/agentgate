// web/static/renderers/doc/markdown.node.test.mjs
// Run: node web/static/renderers/doc/markdown.node.test.mjs
//
// Verifies KaTeX math protection and rendering markers in doc/markdown.js so
// LaTeX underscores/asterisks survive marked.parse without mangling and code
// blocks / currency amounts remain untouched.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const markedSrc = readFileSync(new URL("../../vendor/marked.min.js", import.meta.url), "utf8");
const mdSrc = readFileSync(new URL("./markdown.js", import.meta.url), "utf8");

const win = {};
new Function("globalThis", markedSrc)(win);
new Function("window", "marked", mdSrc)(win, win.marked);

const MD = win.AgentGateMarkdown;
assert.ok(MD, "AgentGateMarkdown exported");

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- inline math preserves underscores & emits span marker ------------------------
{
  const html = MD.renderMarkdown("Energy $E = m_0 c^2 + x_i$ end.");
  check("inline math produces .ag-math-inline", html.includes('class="ag-math-inline"'));
  check("inline math does not turn _ into <em>", !html.includes("<em>"));
  check("inline math encodes raw tex", html.includes(encodeURIComponent("E = m_0 c^2 + x_i")));
}

// --- display math ($$...$$, \[...\], ```math) -------------------------------------
{
  const html = MD.renderMarkdown("Before\n\n$$\n\\sum_{i=1}^{n} x_i\n$$\n\nAfter");
  check("display $$ produces .ag-math-block", html.includes('class="ag-math-block"'));
  check("display math is not wrapped in <p><div>", !html.includes("<p><div class=\"ag-math-block\""));

  const fenced = MD.renderMarkdown("```math\na^2 + b^2 = c^2\n```");
  check("```math fence produces .ag-math-block", fenced.includes('class="ag-math-block"'));
  check("```math fence encodes formula", fenced.includes(encodeURIComponent("a^2 + b^2 = c^2")));
}

// --- code blocks, inline code, and currency stay untouched ------------------------
{
  const code = MD.renderMarkdown("Inline `$x + y$` and\n\n```js\nconst s = \"$a_b$\";\n```");
  check("math inside inline code is untouched", !code.includes("ag-math-"));
  check("math inside js fence is untouched", code.includes("$a_b$"));

  const currency = MD.renderMarkdown("Prices are $5 and $10, total $15.");
  check("currency amounts are not treated as math", !currency.includes("ag-math-"));
}

console.log(`doc-markdown: ${checks} checks passed`);
