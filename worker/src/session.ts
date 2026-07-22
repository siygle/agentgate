// Admin session: a compact HMAC-signed stateless token stored in an HttpOnly
// cookie. It authenticates the instance operator for the /admin dashboard and
// is entirely separate from the per-share owner tokens in owner.ts.
//
// This is a byte-for-byte port of the Go server's admin_session.go so both
// backends accept sessions issued by either.
// Format: "v1.<base64url(payload_json)>.<base64url(hmac_sha256(secret, "v1."+b64payload))>"
// payload_json: {"sub":"owner","m":"owner-key|passkey","iat":<unix>,"exp":<unix>}

export const ADMIN_COOKIE_NAME = "agentgate_admin";
const SESSION_VERSION = "v1";

export type AuthMethod = "owner-key" | "passkey" | "cf-access";

export interface SessionClaims {
  sub: string;
  m: AuthMethod;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(secret: string, signing: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signing));
  return toBase64Url(new Uint8Array(sig));
}

export async function signSession(secret: string, c: SessionClaims): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(c)));
  const signing = SESSION_VERSION + "." + payload;
  return signing + "." + (await sign(secret, signing));
}

// newSessionToken mints a token for method, valid for ttlSec seconds from now.
export async function newSessionToken(
  secret: string,
  method: AuthMethod,
  ttlSec: number,
  nowSec: number,
): Promise<string> {
  return signSession(secret, { sub: "owner", m: method, iat: nowSec, exp: nowSec + ttlSec });
}

// verifySession validates a token's signature (constant time) and expiry.
// Returns null on any tampering, malformed input, missing secret, or expiry.
export async function verifySession(
  secret: string,
  token: string,
  nowSec: number,
): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;
  const signing = parts[0] + "." + parts[1];
  const expected = await sign(secret, signing);
  if (!constantTimeEqual(expected, parts[2])) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
  } catch {
    return null;
  }
  if (!claims || typeof claims.exp !== "number" || claims.exp <= nowSec) return null;
  return claims;
}

// sessionCookie builds the Set-Cookie value for the admin session. secure
// controls the Secure attribute (off for plain-http localhost dev).
export function sessionCookie(token: string, ttlSec: number, secure: boolean): string {
  const attrs = [
    `${ADMIN_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${ttlSec}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [`${ADMIN_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

// parseCookie extracts a single cookie value from a Cookie header.
export function parseCookie(header: string | null, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return "";
}
