// web/static/js/i18n.node.test.mjs
// Run: node web/static/js/i18n.node.test.mjs
//
// Verifies dictionary parity between English (en) and Traditional Chinese (zh-TW),
// placeholder variable consistency, locale detection, and live switching.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const src = readFileSync(new URL("./i18n.js", import.meta.url), "utf8");

function loadI18n({ saved = null, navLang = "en-US" } = {}) {
  const store = new Map();
  if (saved !== null) store.set("agentgate-lang", saved);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const win = {};
  const attrs = new Map();
  const doc = {
    documentElement: {
      setAttribute(k, v) { attrs.set(k, v); },
      getAttribute(k) { return attrs.get(k) || null; },
    },
    querySelectorAll() { return []; },
  };
  new Function("window", "document", "localStorage", "navigator", src)(
    win,
    doc,
    localStorage,
    { language: navLang }
  );
  return { I: win.AgentGateI18n, store, doc };
}

let checks = 0;
function check(name, cond) {
  checks++;
  assert.ok(cond, name);
}

// --- dictionary parity ------------------------------------------------------------
{
  const { I } = loadI18n();
  const enKeys = Object.keys(I.messages.en).sort();
  const zhKeys = Object.keys(I.messages["zh-TW"]).sort();
  assert.deepStrictEqual(zhKeys, enKeys, "zh-TW and en must contain the exact same keys");
  checks++;

  const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
  for (const k of enKeys) {
    check(`en[${k}] is non-empty`, String(I.messages.en[k]).trim().length > 0);
    check(`zh-TW[${k}] is non-empty`, String(I.messages["zh-TW"][k]).trim().length > 0);
    assert.deepStrictEqual(
      placeholders(I.messages["zh-TW"][k]),
      placeholders(I.messages.en[k]),
      `placeholder mismatch for key ${k}`
    );
    checks++;
  }
}

// --- detection, switching & interpolation -----------------------------------------
{
  check("detects zh-TW from navigator zh-TW", loadI18n({ navLang: "zh-TW" }).I.getLocale() === "zh-TW");
  check("detects zh-TW from navigator zh-Hant", loadI18n({ navLang: "zh-Hant-TW" }).I.getLocale() === "zh-TW");
  check("defaults to en for en-US", loadI18n({ navLang: "en-US" }).I.getLocale() === "en");
  check("saved localStorage beats navigator", loadI18n({ saved: "en", navLang: "zh-TW" }).I.getLocale() === "en");

  const { I, store, doc } = loadI18n({ navLang: "en-US" });
  const events = [];
  I.onChange((loc) => events.push(loc));

  check("interpolates variables in en", I.t("expiry.hoursRemaining", { h: 3, m: 15 }) === "3h 15m remaining");
  I.setLocale("zh-TW");
  check("switches to zh-TW", I.getLocale() === "zh-TW");
  check("persists to localStorage", store.get("agentgate-lang") === "zh-TW");
  check("updates html lang attribute", doc.documentElement.getAttribute("lang") === "zh-TW");
  check("fires onChange listener", events.length === 1 && events[0] === "zh-TW");
  check("interpolates variables in zh-TW", I.t("expiry.hoursRemaining", { h: 3, m: 15 }) === "剩餘 3 小時 15 分鐘");

  // Sandbox mode (persist: false) must not touch localStorage
  I.setLocale("en", { persist: false });
  check("persist:false keeps storage unchanged", store.get("agentgate-lang") === "zh-TW");
  check("unknown key falls back to key", I.t("no.such.key") === "no.such.key");
}

console.log(`i18n: ${checks} checks passed`);
