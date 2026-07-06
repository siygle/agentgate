import type { Env } from "./bindings";

// Hybrid storage: metadata rows in D1, encrypted blobs in R2.
// R2 key layout: "<kind>/<id>" (e.g. "diff/ABC123", "files/ABC123").

export type Kind = "diff" | "files";

const TABLE: Record<Kind, string> = { diff: "diffs", files: "file_bundles" };

// Sentinel expiry stored for never-expires rows. The never_expires flag is
// authoritative; this value only fills the NOT NULL column (mirrors the Go server).
export const NEVER_EXPIRES_AT = 253402300800; // 9999-01-01T00:00:00Z in unix seconds

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function r2Key(kind: Kind, id: string): string {
  return `${kind}/${id}`;
}

export interface ShareRecord {
  encrypted_data: unknown; // { ciphertext, iv, salt }
  expires_at: string; // RFC3339; "" when never_expires
  never_expires: boolean;
  id: string;
  kind: Kind;
}

export interface MetaRow {
  r2_key: string;
  expired_at: number;
  never_expires: number;
  owner_token_hash: string | null;
}

// createShare writes the blob to R2, then the metadata row to D1. If the D1
// write fails, the orphaned R2 object is removed so the two stores stay in sync.
export async function createShare(
  env: Env,
  kind: Kind,
  id: string,
  encJson: string,
  expiredAtSec: number,
  neverExpires: boolean,
  ownerHash: string,
): Promise<void> {
  const key = r2Key(kind, id);
  await env.BLOBS.put(key, encJson);
  try {
    await env.DB.prepare(
      `INSERT INTO ${TABLE[kind]} (id, r2_key, expired_at, created_at, never_expires, owner_token_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, key, expiredAtSec, nowSeconds(), neverExpires ? 1 : 0, ownerHash || null)
      .run();
  } catch (err) {
    await env.BLOBS.delete(key).catch(() => {});
    throw err;
  }
}

async function getMeta(env: Env, kind: Kind, id: string): Promise<MetaRow | null> {
  const row = await env.DB.prepare(
    `SELECT r2_key, expired_at, never_expires, owner_token_hash FROM ${TABLE[kind]} WHERE id = ?`,
  )
    .bind(id)
    .first<MetaRow>();
  return row ?? null;
}

function isExpired(row: MetaRow): boolean {
  return row.never_expires === 0 && row.expired_at <= nowSeconds();
}

// getShare returns the full record (metadata + decrypted-from-R2 ciphertext blob),
// or null when missing or expired.
export async function getShare(env: Env, kind: Kind, id: string): Promise<ShareRecord | null> {
  const row = await getMeta(env, kind, id);
  if (!row || isExpired(row)) return null;

  const obj = await env.BLOBS.get(row.r2_key);
  if (!obj) return null; // metadata without blob: treat as not found
  let encrypted: unknown;
  try {
    encrypted = JSON.parse(await obj.text());
  } catch {
    return null;
  }

  const neverExpires = row.never_expires !== 0;
  return {
    encrypted_data: encrypted,
    expires_at: neverExpires ? "" : new Date(row.expired_at * 1000).toISOString(),
    never_expires: neverExpires,
    id,
    kind,
  };
}

// getMetaForUpdate returns the metadata row (regardless of expiry) for PATCH auth.
export async function getMetaForUpdate(env: Env, kind: Kind, id: string): Promise<MetaRow | null> {
  return getMeta(env, kind, id);
}

export async function setNeverExpires(
  env: Env,
  kind: Kind,
  id: string,
  neverExpires: boolean,
  newExpirySec: number | null,
): Promise<void> {
  if (newExpirySec !== null) {
    await env.DB.prepare(`UPDATE ${TABLE[kind]} SET never_expires = ?, expired_at = ? WHERE id = ?`)
      .bind(neverExpires ? 1 : 0, newExpirySec, id)
      .run();
    return;
  }
  await env.DB.prepare(`UPDATE ${TABLE[kind]} SET never_expires = ? WHERE id = ?`)
    .bind(neverExpires ? 1 : 0, id)
    .run();
}

// deleteExpired removes expired rows from both tables and their R2 blobs.
// Rows with never_expires = 1 are skipped. Returns the number of deleted records.
export async function deleteExpired(env: Env): Promise<number> {
  const now = nowSeconds();
  let total = 0;
  for (const kind of ["diff", "files"] as Kind[]) {
    const table = TABLE[kind];
    const { results } = await env.DB.prepare(
      `SELECT r2_key FROM ${table} WHERE never_expires = 0 AND expired_at <= ?`,
    )
      .bind(now)
      .all<{ r2_key: string }>();
    const keys = (results ?? []).map((r) => r.r2_key);
    if (keys.length === 0) continue;
    await env.BLOBS.delete(keys);
    await env.DB.prepare(`DELETE FROM ${table} WHERE never_expires = 0 AND expired_at <= ?`)
      .bind(now)
      .run();
    total += keys.length;
  }
  return total;
}
