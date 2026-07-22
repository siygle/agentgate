// Owner-token generation/verification. Port of handlers_api.go:276-311.
// The token is returned once to the caller; only its SHA-256 hex hash is stored.

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// constantTimeEqual compares two equal-length hex strings without early exit.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// generateOwnerToken returns a 32-byte URL-safe random token and its hex hash.
export async function generateOwnerToken(): Promise<{ token: string; hash: string }> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = toBase64Url(buf);
  const hash = await sha256Hex(token);
  return { token, hash };
}

export async function verifyOwnerToken(token: string, storedHash: string): Promise<boolean> {
  if (!token || !storedHash) return false;
  const got = await sha256Hex(token);
  return constantTimeEqual(got, storedHash);
}

// extractBearerToken parses "Bearer <token>" (scheme is case-insensitive).
export function extractBearerToken(header: string | null): string {
  if (!header) return "";
  const trimmed = header.trim();
  const idx = trimmed.search(/\s/);
  if (idx < 0) return "";
  const scheme = trimmed.slice(0, idx);
  if (scheme.toLowerCase() !== "bearer") return "";
  return trimmed.slice(idx + 1).trim();
}
