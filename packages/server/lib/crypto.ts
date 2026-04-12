const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(
  plaintext: string,
  passphrase: string,
): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: toBase64(encrypted),
    iv: toBase64(iv.buffer as ArrayBuffer),
    salt: toBase64(salt.buffer as ArrayBuffer),
  };
}

export async function decrypt(
  ciphertext: string,
  iv: string,
  salt: string,
  passphrase: string,
): Promise<string> {
  const saltBytes = fromBase64(salt);
  const ivBytes = fromBase64(iv);
  const key = await deriveKey(passphrase, saltBytes);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource },
    key,
    fromBase64(ciphertext) as BufferSource,
  );

  return new TextDecoder().decode(decrypted);
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
};

export function isEncryptedPayload(
  value: unknown,
): value is EncryptedPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.ciphertext === "string" &&
    typeof obj.iv === "string" &&
    typeof obj.salt === "string"
  );
}
