# Markdown Copy Buttons — Design

**Date:** 2026-05-18
**Scope:** `web/static/js/file-viewer.js`, `web/static/css/style.css`

## Goal

Let recipients of a shared file bundle copy markdown content from the viewer with one click, both the full markdown source and individual code blocks rendered inside the preview.

## Motivation

The current file viewer renders markdown with a Source/Preview tab toggle but offers no way to copy the content. Users who want to reuse a shared markdown doc — or paste a fenced code block from a rendered preview — must hand-select text, which is fragile (especially on mobile and when content spans the visible viewport).

## Behavior

### 1. Top-level copy button (markdown files only)

- Lives in the Source/Preview tab bar, right-aligned (the tab bar becomes a flex row: tabs left, actions right).
- Visible whenever the active file is markdown, in both layouts:
  - Desktop content panel (`renderDesktopContent`)
  - Mobile accordion body (the per-file loop in the mobile branch)
- Always copies `file.content` — the raw markdown source, including frontmatter if present. Tab selection (Source vs Preview) does not change what is copied.
- Label: `Copy`. On success, swap to `Copied!` for 1500 ms, then revert.

### 2. Per-code-block copy buttons (markdown preview only)

- Attached to each `<pre>` element inside `.markdown-body` after preview HTML is injected.
- Position: absolute, top-right corner of the `<pre>`, with a small inset.
- Visibility: hidden by default; revealed on `:hover` of the parent `<pre>`. On touch devices (`@media (hover: none)`), the button is always visible.
- Copies the raw text of the contained `<code>` element (`code.textContent`) — the un-highlighted source, not the syntax-highlighted HTML.
- Same `Copy` → `Copied!` feedback as the top-level button.

### Copy mechanism

Single helper, used by both buttons:

```
copyText(text) → Promise
  try navigator.clipboard.writeText(text)
  on rejection or unavailability → fallback:
    create off-screen <textarea>, set value, select(), document.execCommand("copy"), remove
  resolve true/false
```

The fallback exists because the server may be served over plain HTTP on an internal network, where `navigator.clipboard` is unavailable.

### Feedback

- Success → button label becomes `Copied!`, button gets `.copy-btn--success`, reverts after 1500 ms.
- Failure → button label becomes `Failed`, button gets `.copy-btn--error`, reverts after 1500 ms. (Failure is rare given the fallback; this is a safety net, not a primary path.)

## Implementation outline

### `web/static/js/file-viewer.js`

- Add a module-private `copyText(text)` helper (clipboard API with execCommand fallback).
- Add a `flashCopyState(btn, ok)` helper that swaps label/class and reverts after 1500 ms.
- Add `createCopyButton(getText)` that returns a `<button class="copy-btn">` wired to `copyText(getText())` + `flashCopyState`.
- Add `attachCodeBlockCopyButtons(container)` — queries `container.querySelectorAll("pre")`, for each `pre` finds its `<code>` and appends a `createCopyButton(() => code.textContent)` to the `<pre>`. The `<pre>` already has the structure produced by `marked` + the custom renderer in `markdown.js`.
- Refactor the markdown-rendering branches in `renderDesktopContent` and the mobile accordion loop into a shared helper `renderMarkdownPanel(target, file, lang)`:
  - Builds the tab bar with `Copy` button on the right (passed `() => file.content`).
  - Builds Source `<pre>` and Preview `<div class="markdown-body">`.
  - After preview innerHTML is set, calls `attachCodeBlockCopyButtons(previewPane)`.
  - Wires the Source/Preview tab click handlers.
- The non-markdown branches stay unchanged (no copy button there per scope).

### `web/static/css/style.css`

- `.tab-bar` → switch to `display: flex; align-items: center; justify-content: space-between;`. Group the tabs in an inner container or place the copy button as the last child so it sits on the right.
- `.copy-btn` → compact button matching the existing `.tab` style (small text, subdued border, neutral background, hover state).
- `.copy-btn--success` / `.copy-btn--error` → success/error color tweak.
- `.markdown-body pre { position: relative; }` and `.markdown-body pre .copy-btn` absolute top-right with hidden-by-default. Reveal via `.markdown-body pre:hover .copy-btn`. Always show under `@media (hover: none) { .markdown-body pre .copy-btn { opacity: 1; } }`.

No changes to Go, templates, or the markdown helper module.

## Out of scope

- Copy button on non-markdown code files (e.g., `.ts`, `.go`). User chose markdown-only scope.
- Copy on the diff viewer.
- Copy of rendered HTML (vs raw markdown source).
- Keyboard shortcut for copy.
- Analytics / telemetry on copy actions.

## Testing

Manual verification in a browser against a running dev server:

1. Share a bundle containing one `.md` with a fenced code block. Open the share URL, decrypt.
2. Verify the top-level **Copy** button appears in the tab bar on desktop and inside the mobile accordion body.
3. Click it on the Source tab → clipboard contains raw markdown. Switch to Preview → click again → same clipboard contents.
4. Hover a code block in Preview → copy button appears top-right → click → clipboard contains the raw code (not the highlighted HTML).
5. Touch device / DevTools touch emulation → code-block copy buttons visible without hover.
6. Open the page over plain HTTP (or in a context where `navigator.clipboard` rejects) → buttons still copy via the fallback.
7. Verify non-markdown files (e.g., `.go`) do **not** show a copy button.

No automated tests — the existing frontend has none, and this is a small DOM-side feature.
