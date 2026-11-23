// web/static/renderers/common/frame-ui.node.test.mjs
// Run: node web/static/renderers/common/frame-ui.node.test.mjs
//
// Tests link classification, DOM preparation, and click interception inside built-in
// renderers. A regression here causes clicking links in a post to navigate the
// <iframe srcdoc> itself and replace the post with a browser error page.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const src = readFileSync(new URL("./frame-ui.js", import.meta.url), "utf8");

function makeAnchor(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    getAttribute(k) { return map.has(k) ? map.get(k) : null; },
    setAttribute(k, v) { map.set(k, String(v)); },
    removeAttribute(k) { map.delete(k); },
    closest(sel) {
      if (sel === "a[href]" && map.has("href")) return this;
      return null;
    },
  };
}

const opened = [];
const reportedHashes = [];
const scrolledTo = [];

const win = {
  AgentGateFrame: {
    reportHeight() {},
    reportHash(h) { reportedHashes.push(h); },
    reportCurrentFile() {},
    savePref() {},
  },
  open(url, target, features) {
    opened.push({ url, target, features });
  },
};

const doc = {
  documentElement: { getAttribute() { return null; } },
  getElementById(id) {
    if (id === "sec-1" || id === "zh section") {
      return { scrollIntoView() { scrolledTo.push(id); } };
    }
    return null;
  },
  addEventListener() {},
};

new Function("window", "document", "navigator", src)(win, doc, {});
const UI = win.AgentGateFrameUI;

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- classifyLink -----------------------------------------------------------------
{
  check("hash link", UI.classifyLink("#sec-1").kind === "hash");
  check("https external", UI.classifyLink("https://example.com/a").kind === "external");
  check("http external", UI.classifyLink("http://example.com").kind === "external");
  check("protocol-relative external upgrades to https", UI.classifyLink("//example.com/x").href === "https://example.com/x");
  check("mailto protocol", UI.classifyLink("mailto:a@b.com").kind === "protocol");
  check("tel protocol", UI.classifyLink("tel:+123456").kind === "protocol");
  check("javascript unsafe", UI.classifyLink("javascript:alert(1)").kind === "unsafe");
  check("data unsafe", UI.classifyLink("data:text/html,hi").kind === "unsafe");
  check("unknown scheme unsafe", UI.classifyLink("file:///etc/passwd").kind === "unsafe");
  const rel = UI.classifyLink("./other.md?x=1#heading");
  check("relative kind", rel.kind === "relative");
  check("relative path stripped of query+hash", rel.path === "./other.md");
  check("relative hash extracted", rel.hash === "#heading");
  check("empty link", UI.classifyLink("   ").kind === "empty");
}

// --- prepareLinks -----------------------------------------------------------------
{
  const ext = makeAnchor({ href: "https://github.com/siygle/agentgate" });
  const protoRel = makeAnchor({ href: "//example.com/page" });
  const mail = makeAnchor({ href: "mailto:hi@example.com" });
  const goodRel = makeAnchor({ href: "./other.md#sec" });
  const badRel = makeAnchor({ href: "./missing.md" });
  const hash = makeAnchor({ href: "#sec-1" });

  const root = {
    querySelectorAll(sel) {
      assert.strictEqual(sel, "a[href]");
      return [ext, protoRel, mail, goodRel, badRel, hash];
    },
  };

  UI.prepareLinks(root, { canResolveFile: (p) => p === "./other.md" });

  check("external gets target=_blank", ext.getAttribute("target") === "_blank");
  check("external gets rel noopener noreferrer", ext.getAttribute("rel") === "noopener noreferrer");
  check("protocol-relative href normalized", protoRel.getAttribute("href") === "https://example.com/page");
  check("protocol-relative gets target=_blank", protoRel.getAttribute("target") === "_blank");
  check("mailto gets target=_blank", mail.getAttribute("target") === "_blank");
  check("resolvable relative link is not marked unresolved", goodRel.getAttribute("data-ag-unresolved-link") === null);
  check("unresolvable relative link marked unresolved", badRel.getAttribute("data-ag-unresolved-link") === "1");
  check("unresolvable relative link gets helpful title", !!badRel.getAttribute("title"));
  check("hash link left without target", hash.getAttribute("target") === null);
}

// --- wireAnchors click handling ---------------------------------------------------
{
  let clickHandler = null;
  const root = {
    addEventListener(ev, fn) {
      if (ev === "click") clickHandler = fn;
    },
  };
  const fileClicks = [];
  UI.wireAnchors(root, {
    onFileLink(path, hash) {
      fileClicks.push({ path, hash });
    },
  });

  function dispatchClick(anchor) {
    let prevented = false;
    clickHandler({
      target: anchor,
      preventDefault() { prevented = true; },
    });
    return prevented;
  }

  // 1) External link WITHOUT target="_blank" (the core reported bug) -> must NOT navigate iframe!
  opened.length = 0;
  const bareExt = makeAnchor({ href: "https://example.com/post" });
  check("bare external click prevented", dispatchClick(bareExt) === true);
  check("bare external opens in new tab", opened.length === 1 && opened[0].url === "https://example.com/post" && opened[0].target === "_blank");

  // 2) External link with explicit target="_self" -> overridden to open externally
  opened.length = 0;
  const selfExt = makeAnchor({ href: "https://example.com/self", target: "_self" });
  check("_self external click prevented", dispatchClick(selfExt) === true);
  check("_self external opens in new tab", opened.length === 1 && opened[0].url === "https://example.com/self");

  // 3) External link already having target="_blank" -> native open allowed, rel ensured
  opened.length = 0;
  const blankExt = makeAnchor({ href: "https://example.com/blank", target: "_blank" });
  check("_blank external allows native click", dispatchClick(blankExt) === false);
  check("_blank external ensures noopener", blankExt.getAttribute("rel").includes("noopener"));

  // 4) Hash link -> prevented, scrolls and reports hash
  reportedHashes.length = 0;
  scrolledTo.length = 0;
  const hashLink = makeAnchor({ href: "#sec-1" });
  check("hash click prevented", dispatchClick(hashLink) === true);
  check("hash scrolled", scrolledTo[0] === "sec-1");
  check("hash reported to host", reportedHashes[0] === "#sec-1");

  // 5) Relative link -> prevented (never navigates about:srcdoc), invokes onFileLink
  const relLink = makeAnchor({ href: "./other.md#sec-1" });
  check("relative click prevented", dispatchClick(relLink) === true);
  check("relative link forwarded to onFileLink", fileClicks.length === 1 && fileClicks[0].path === "./other.md" && fileClicks[0].hash === "#sec-1");

  // 6) javascript: link -> prevented and never passed to window.open
  opened.length = 0;
  const jsLink = makeAnchor({ href: "javascript:alert(1)" });
  check("javascript: click prevented", dispatchClick(jsLink) === true);
  check("javascript: never opened", opened.length === 0);
}

console.log(`frame-ui: ${checks} checks passed`);
