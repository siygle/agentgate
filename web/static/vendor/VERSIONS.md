# Vendored frontend libraries

These are committed rather than pulled from a CDN for two reasons:

1. **The webapp sandbox cannot reach the network.** Share content renders inside an
   opaque-origin `<iframe>` with `default-src 'none'; connect-src 'none'`, so a
   `<script src="https://cdn...">` inside it is blocked by design. Libraries must be
   inlined from local files (see `BUILTIN_LIBS` in `web/static/js/app-viewer.js`).
2. **Supply chain.** AgentGate's viewer page holds the decryption key and the
   remembered passphrase. A CDN able to swap in different JS on that origin would be
   able to read them, which defeats the point of end-to-end encryption.

| File | Library | Version | Source |
|------|---------|---------|--------|
| `mermaid.min.js` | mermaid | 10.9.6 | `https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js` |
| `mdx-runtime.bundle.js` | react + react-dom + @mdx-js/mdx | 18.3.1 / 18.3.1 / 3.1.0 | **built** — see `tools/mdx-bundle` |
| `highlight.min.js` | highlight.js | 11.11.1 | `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets/highlight.min.js` |
| `highlight-github.min.css` | highlight.js github theme | 11.11.1 | `.../styles/github.min.css` |
| `highlight-github-dark.min.css` | highlight.js github-dark theme | 11.11.1 | `.../styles/github-dark.min.css` |
| `lightweight-charts.standalone.production.js` | TradingView Lightweight Charts | 5.0.8 | `https://cdn.jsdelivr.net/npm/lightweight-charts/dist/lightweight-charts.standalone.production.js` |
| `marked.min.js` | marked | *unverified (predates this file)* | `https://cdn.jsdelivr.net/npm/marked/marked.min.js` |
| `diff2html.min.js` | diff2html | *unverified (predates this file)* | `https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html.min.js` |
| `diff2html.min.css` | diff2html | *unverified (predates this file)* | `.../bundles/css/diff2html.min.css` |

## Refreshing

Download the pinned URL, overwrite the file, update the version above, then re-run the
end-to-end checks (`node test/contract/run.mjs <base>` plus opening one share of each
kind) — these libraries render share content, so a regression is a rendering regression.

Every library here must be a **classic script** (UMD/IIFE that assigns a global), not an
ES module. The sandbox allows `script-src 'unsafe-inline' blob:` only; a bare
`import` from a URL cannot resolve inside it.

## `mdx-runtime.bundle.js` is generated, not downloaded

It is the only built artifact here. Rebuild it only when bumping the pinned versions:

```bash
cd tools/mdx-bundle && npm install && npm run build
```

The bundle exposes `AgentGateMDXVendor = { React, createRoot, compile, run, jsxRuntime }` and
contains **only third-party code**. AgentGate's own MDX components and rendering glue live
outside it, in `web/static/renderers/doc/`, so editing a component needs no rebuild.

It replaced a `mdx-runtime.js` that imported React and `@mdx-js/mdx` from esm.sh — four
imports that fanned out to roughly 200 third-party requests, on the origin holding the
decryption key and the remembered passphrase, and that could never work inside the render
sandbox at all.

**A frame that renders MDX needs `'unsafe-eval'`** in its CSP, because `@mdx-js/mdx`'s
`run()` evaluates the compiled document body with `new AsyncFunction`. `sandbox.js`
therefore adds `'unsafe-eval'` only to frames whose payload actually contains an `.mdx`
file. This grants nothing extra in practice — the frame already has `'unsafe-inline'`, so
it can run arbitrary code it authored either way — and the guarantees that matter (opaque
origin, `connect-src 'none'`) are untouched. Uploaded webapps stay on the tighter policy.

## Note on `mermaid.min.js` size

The official mermaid bundle is ~3.3 MB (~1 MB gzipped) because it inlines d3, dagre, and
friends. It is a **server-side static asset**, never part of a per-share encrypted
payload, and `app-viewer.js` only inlines it into a frame whose content actually
references mermaid.
