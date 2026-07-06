// Port of internal/id/id.go — same alphabet and length for link consistency.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, base32-like (no I, O, 0, 1)
const LENGTH = 6;

// generateId returns a cryptographically random 6-character ID.
export function generateId(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
