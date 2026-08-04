# Using AgentGate from a coding agent

AgentGate works well as a small tool an agent calls when it needs to hand a human an
encrypted preview link. The agent needs the CLI, a server URL, and a passphrase — nothing
else.

## 1. Install the CLI where the agent runs

```bash
go install github.com/siygle/agentgate/cmd/agentgate@latest
```

Or drop a [prebuilt binary](self-host.md#prebuilt-binaries) somewhere on the agent's `PATH`.

## 2. Configure non-interactive environment variables

Set these in the agent runtime, shell profile, `.envrc`, systemd unit, or secret manager:

```bash
export AGENTGATE_SERVER=https://your-domain.com
export AGENTGATE_PASSPHRASE="use-a-long-random-shared-passphrase"
```

Prefer an explicit secrets mechanism over an interactive shell profile for unattended
agents.

## 3. Add a skill or tool instruction

Example `SKILL.md` for agents that support filesystem-based skills:

```markdown
---
name: agentgate-share
description: Share encrypted code diffs, files, docs, plans, or static webapps with AgentGate. Use when the user asks for a secure preview/share link.
---

# AgentGate sharing

Use `agentgate` to create encrypted AgentGate links.

Before sharing:
1. Confirm `agentgate` is installed: `agentgate key-get`.
2. Confirm `AGENTGATE_SERVER` and `AGENTGATE_PASSPHRASE` are available.
3. Never print or commit the passphrase.
4. Keep the Manage URL private unless the user explicitly needs ownership controls.

Commands:
- `agentgate git-staged` — share staged changes.
- `agentgate git-latest` — share the latest commit diff.
- `agentgate files <paths...>` — share selected files.
- `agentgate docs <file|dir>` — share rendered Markdown/MDX documents.
- `agentgate plan <file|dir>` — share a visual plan bundle.
- `agentgate webapp <dir>` — share a runnable static prototype with `index.html`.

TTL:
- Default server TTL is 7 days.
- Use `-t 24h`, `-t 7d`, or `--no-expiry` when the user requests a different lifetime.

After upload, return the public Preview URL to the user. Do not expose
AGENTGATE_PASSPHRASE in chat; share it out-of-band if needed.
```

For pi, one possible location is `~/.pi/agent/skills/agentgate-share/SKILL.md`. Other
agents can use the same text as a tool instruction or custom skill.

## 4. Optional: point the agent at the machine-readable reference

A running server exposes:

- `/llms.txt` — short integration index
- `/llms-full.txt` — complete CLI/API/encryption reference

Add `https://your-domain.com/llms-full.txt` to the agent's project docs or retrieval
sources when it supports URL-based documentation.

## Built-in libraries

Webapps run in a sandbox with `connect-src 'none'` — the framed app **cannot make any
network request**, so every library it uses has to be present locally. Instead of bundling
megabytes into each encrypted upload, reference a built-in with an `agentgate:` URL; the
viewer inlines the server's own vendored copy into the sandbox at render time, so it costs
nothing in the payload.

| Reference | Global | Library |
|-----------|--------|---------|
| `agentgate:marked` | `marked` | Markdown rendering |
| `agentgate:highlight` | `hljs` | Syntax highlighting |
| `agentgate:mermaid` | `mermaid` | Diagrams (flowchart, sequence, ER, …) |
| `agentgate:diff2html` | `Diff2Html` | Unified-diff parsing |
| `agentgate:lightweight-charts` | `LightweightCharts` | TradingView financial charts |

Stylesheets work the same way through `<link rel="stylesheet">`:

| Reference | Pairs with |
|-----------|-----------|
| `agentgate:highlight-css` | `agentgate:highlight` (light theme) |
| `agentgate:highlight-dark-css` | `agentgate:highlight` (dark theme) |
| `agentgate:diff2html-css` | `agentgate:diff2html` |
| `agentgate:tokens` | AgentGate's design tokens (colours, fonts, light/dark) |
| `agentgate:renderer` | AgentGate's content styles (`.markdown-body`, tables, code blocks) |

```html
<link rel="stylesheet" href="agentgate:highlight-css">
<script src="agentgate:marked"></script>
<script src="agentgate:highlight"></script>
<script src="agentgate:lightweight-charts"></script>

<div id="chart" style="height: 420px"></div>
<script>
  document.body.insertAdjacentHTML("afterbegin", marked.parse("# Report"));
  const chart = LightweightCharts.createChart(document.getElementById("chart"));
  const candles = chart.addSeries(LightweightCharts.CandlestickSeries, {});
  candles.setData([
    { time: "2026-07-20", open: 53.6, high: 57.3, low: 51.7, close: 53.2 },
  ]);
  chart.timeScale().fitContent();
</script>
```

Each reference also accepts `agentgate://vendor/<name>.js` and
`/static/vendor/<real-filename>`. Anything not listed above is left alone: a bundle-local
path resolves from your uploaded files, and a remote URL stays remote — which means the
sandbox blocks it.

### Only pay for what you use

A built-in is inlined into the frame on every view, so a large one costs the reader time
each time — mermaid alone is 3.3 MB. Add `data-agentgate-when="<global>"` and it is
dropped unless something else in the bundle mentions that global by name:

```html
<script src="agentgate:mermaid" data-agentgate-when="mermaid"></script>
```

It is opt-in and never silently removes a library you asked for unconditionally: leave the
attribute off and the library is always inlined. Mentions inside HTML comments do not
count, and neither does the gated tag itself — so deleting a feature from a copy of the
template stops that feature's library being shipped too.

AgentGate's own renderers do this automatically: a document with no diagram never loads
mermaid, one with no code never loads highlight.js.

### Starting point

[`docs/webapp-template/`](webapp-template/) is ready to upload — markdown, a diagram, and a
chart, with no network access and the gating attributes already in place:

```bash
agentgate webapp ./docs/webapp-template
```

The vendored files and their pinned versions are listed in
[`web/static/vendor/VERSIONS.md`](../web/static/vendor/VERSIONS.md). They are committed
rather than loaded from a CDN because the viewer page holds the decryption key and the
remembered passphrase — third-party JS on that origin could read both.
