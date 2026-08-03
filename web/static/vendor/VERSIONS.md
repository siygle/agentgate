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

## Note on `mermaid.min.js` size

The official mermaid bundle is ~3.3 MB (~1 MB gzipped) because it inlines d3, dagre, and
friends. It is a **server-side static asset**, never part of a per-share encrypted
payload, and `app-viewer.js` only inlines it into a frame whose content actually
references mermaid.
