// web/static/js/passphrase.node.test.mjs
// Run: node web/static/js/passphrase.node.test.mjs
//
// Covers per-share scoping of the remembered passphrase, including the one-time
// migration off the old single global key. Getting this wrong either strands users
// (their remembered passphrase silently stops working) or keeps a cross-share secret
// readable from the page, so both directions are asserted.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const LEGACY = "agentgate-passphrase";
const src = readFileSync(new URL("./passphrase.js", import.meta.url), "utf8");

// A minimal localStorage over a Map — enough for the get/set/remove this module uses.
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
    snapshot: () => Object.fromEntries(map),
  };
}

// load returns a fresh AgentGatePassphrase bound to the given share id and storage.
function load(shareId, initial) {
  const storage = makeStorage(initial);
  const win = {
    AgentGateShare: {
      route: shareId ? { id: shareId } : null,
      getShareId: () => shareId || "unknown",
    },
  };
  const sandbox = {
    window: win,
    localStorage: storage,
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({}) },
  };
  new Function(
    "window",
    "localStorage",
    "document",
    src
  )(sandbox.window, sandbox.localStorage, sandbox.document);
  return { P: win.AgentGatePassphrase, storage };
}

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- scoping ---------------------------------------------------------------------

{
  const { P, storage } = load("ABC123", {});
  P.storePassphrase("pass-for-abc");
  check("stores under the share-scoped key", storage.getItem("agentgate-passphrase:ABC123") === "pass-for-abc");
  check("never writes the global key", storage.getItem(LEGACY) === null);
  check("reads its own passphrase back", P.getStoredPassphrase() === "pass-for-abc");
}

{
  // The core property: one share's remembered passphrase is not visible to another.
  const stored = { "agentgate-passphrase:ABC123": "pass-for-abc" };
  const { P } = load("XYZ789", stored);
  check("a different share does not see it", P.getStoredPassphrase() === null);
}

{
  // No id (landing page) must not fall back to some shared key.
  const { P, storage } = load(null, {});
  check("unknown share id reads nothing", P.getStoredPassphrase() === null);
  P.storePassphrase("should-not-persist");
  check("unknown share id writes nothing", storage.keys().length === 0);
}

// --- migration off the legacy global key -----------------------------------------

{
  const { P } = load("ABC123", { [LEGACY]: "old-global" });
  check("legacy value is still offered when nothing is scoped yet", P.getStoredPassphrase() === "old-global");
}

{
  // Adopting the same value proves it was valid here, so the global copy is retired.
  const { P, storage } = load("ABC123", { [LEGACY]: "old-global" });
  P.storePassphrase("old-global");
  check("legacy value migrates to the scoped key", storage.getItem("agentgate-passphrase:ABC123") === "old-global");
  check("legacy key is dropped once adopted", storage.getItem(LEGACY) === null);
}

{
  // A different passphrase means the legacy value belonged to some other share —
  // dropping it there would strand that share.
  const { P, storage } = load("ABC123", { [LEGACY]: "belongs-to-other-share" });
  P.storePassphrase("pass-for-abc");
  check("legacy key kept when this share used a different passphrase", storage.getItem(LEGACY) === "belongs-to-other-share");
  check("scoped key holds this share's passphrase", storage.getItem("agentgate-passphrase:ABC123") === "pass-for-abc");
}

{
  // Scoped value wins over the legacy fallback.
  const { P } = load("ABC123", { [LEGACY]: "old-global", "agentgate-passphrase:ABC123": "scoped" });
  check("scoped value takes precedence over legacy", P.getStoredPassphrase() === "scoped");
}

// --- explicit clear ---------------------------------------------------------------

{
  const { P, storage } = load("ABC123", { [LEGACY]: "old-global", "agentgate-passphrase:ABC123": "scoped" });
  P.clearStoredPassphrase();
  check("clear removes the scoped key", storage.getItem("agentgate-passphrase:ABC123") === null);
  check("clear also removes the legacy key", storage.getItem(LEGACY) === null);
}

// --- storage failures are non-fatal ----------------------------------------------

{
  // Private-mode browsers throw from localStorage; the viewer must still load.
  const win = { AgentGateShare: { route: { id: "ABC123" }, getShareId: () => "ABC123" } };
  const throwing = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  new Function("window", "localStorage", "document", src)(
    win,
    throwing,
    { addEventListener() {}, getElementById: () => null, createElement: () => ({}) }
  );
  const P = win.AgentGatePassphrase;
  check("read survives a throwing localStorage", P.getStoredPassphrase() === null);
  assert.doesNotThrow(() => P.storePassphrase("x"), "write survives a throwing localStorage");
  assert.doesNotThrow(() => P.clearStoredPassphrase(), "clear survives a throwing localStorage");
  checks += 2;
}

console.log(`passphrase scoping: ${checks} checks passed`);
