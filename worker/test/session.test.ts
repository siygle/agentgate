import { describe, it, expect } from "vitest";
import {
  newSessionToken,
  verifySession,
  sessionCookie,
  clearSessionCookie,
  parseCookie,
  ADMIN_COOKIE_NAME,
} from "../src/session";

const SECRET = "test-secret-0123456789";
const NOW = 1_700_000_000;

describe("admin session", () => {
  it("round-trips a freshly signed token", async () => {
    const tok = await newSessionToken(SECRET, "owner-key", 3600, NOW);
    const claims = await verifySession(SECRET, tok, NOW);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("owner");
    expect(claims!.m).toBe("owner-key");
    expect(claims!.exp).toBe(NOW + 3600);
  });

  it("rejects tampering, wrong secret, and malformed input", async () => {
    const tok = await newSessionToken(SECRET, "owner-key", 3600, NOW);
    expect(await verifySession("other-secret", tok, NOW)).toBeNull();
    const mutated = tok.slice(0, -1) + (tok.endsWith("A") ? "B" : "A");
    expect(await verifySession(SECRET, mutated, NOW)).toBeNull();
    expect(await verifySession(SECRET, "", NOW)).toBeNull();
    expect(await verifySession(SECRET, "v1.only-two", NOW)).toBeNull();
    expect(await verifySession("", tok, NOW)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const tok = await newSessionToken(SECRET, "passkey", 3600, NOW);
    expect(await verifySession(SECRET, tok, NOW + 3601)).toBeNull();
  });

  it("builds and parses cookies", () => {
    const c = sessionCookie("abc.def.ghi", 3600, true);
    expect(c).toContain(`${ADMIN_COOKIE_NAME}=abc.def.ghi`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Secure");
    expect(sessionCookie("x", 3600, false)).not.toContain("Secure");
    expect(clearSessionCookie(true)).toContain("Max-Age=0");

    const header = `foo=bar; ${ADMIN_COOKIE_NAME}=my.session.tok; baz=qux`;
    expect(parseCookie(header, ADMIN_COOKIE_NAME)).toBe("my.session.tok");
    expect(parseCookie(null, ADMIN_COOKIE_NAME)).toBe("");
    expect(parseCookie("nope=1", ADMIN_COOKIE_NAME)).toBe("");
  });
});
