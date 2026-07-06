import type { Env } from "./bindings";

// Storage has two modes, selected by the USE_R2 env var:
//   - D1-only (default): the encrypted blob is stored in the D1 `encrypted_data`
//     column. Works without a paid R2 subscription.
//   - Hybrid (USE_R2="true" and the BLOBS binding present): metadata in D1, the
//     encrypted blob in R2 (keyed "<kind>/<id>"). Better for very large bundles.
// getShare reads whichever storage a record actually used, so switching modes
// does not orphan or hide existing records (as long as R2 stays reachable for
// blobs already written there).

export type Kind = "diff" | "files";

const TABLE: Record<Kind, string> = { diff: "diffs", files: "file_bundles" };

// Sentinel expiry stored for never-expires rows. The never_expires flag is
// authoritative; this value only fills the NOT NULL column (mirrors the Go server).
export const NEVER_EXPIRES_AT = 253402300800; // 9999-01-01T00:00:00Z in unix seconds

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// useR2 reports whether the R2 hybrid path is active. R2 is used only when
// explicitly enabled AND the binding exists; otherwise everything is D1-only.
export function useR2(env: Env): boolean {
  return env.USE_R2 === "true" && !!env.BLOBS;
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
  encrypted_data: string | null;
  expired_at: number;
  never_expires: number;
  owner_token_hash: string | null;
}

// createShare stores the blob (R2 in hybrid mode, else the D1 column) and the
// metadata row. In hybrid mode, if the D1 write fails the orphaned R2 object is
// removed so the two stores stay in sync.
export async function createShare(
  env: Env,
  kind: Kind,
  id: string,
  encJson: string,
  expiredAtSec: number,
  neverExpires: boolean,
  ownerHash: string,
): Promise<void> {
  const r2 = useR2(env);
  const key = r2 ? r2Key(kind, id) : "";

  if (r2) {
    await env.BLOBS!.put(key, encJson);
  }
  try {
    await env.DB.prepare(
      `INSERT INTO ${TABLE[kind]} (id, r2_key, encrypted_data, expired_at, created_at, never_expires, owner_token_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        key,
        r2 ? null : encJson,
        expiredAtSec,
        nowSeconds(),
        neverExpires ? 1 : 0,
        ownerHash || null,
      )
      .run();
  } catch (err) {
    if (r2) await env.BLOBS!.delete(key).catch(() => {});
    throw err;
  }
}

async function getMeta(env: Env, kind: Kind, id: string): Promise<MetaRow | null> {
  const row = await env.DB.prepare(
    `SELECT r2_key, encrypted_data, expired_at, never_expires, owner_token_hash
     FROM ${TABLE[kind]} WHERE id = ?`,
  )
    .bind(id)
    .first<MetaRow>();
  return row ?? null;
}

function isExpired(row: MetaRow): boolean {
  return row.never_expires === 0 && row.expired_at <= nowSeconds();
}

// getShare returns the full record, reading the blob from wherever it was stored
// (D1 column or R2), or null when missing/expired.
export async function getShare(env: Env, kind: Kind, id: string): Promise<ShareRecord | null> {
  const row = await getMeta(env, kind, id);
  if (!row || isExpired(row)) return null;

  let text: string;
  if (row.encrypted_data != null) {
    // D1-only record.
    text = row.encrypted_data;
  } else if (row.r2_key && env.BLOBS) {
    // Hybrid record: fetch the blob from R2.
    const obj = await env.BLOBS.get(row.r2_key);
    if (!obj) return null; // metadata without blob: treat as not found
    text = await obj.text();
  } else {
    // R2 record but the binding is unavailable — cannot serve it.
    return null;
  }

  let encrypted: unknown;
  try {
    encrypted = JSON.parse(text);
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

// deleteExpired removes expired rows from both tables (and their R2 blobs, for
// rows that have one). Rows with never_expires = 1 are skipped. Returns the
// number of deleted records.
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
    const rows = results ?? [];
    if (rows.length === 0) continue;

    const r2Keys = rows.map((r) => r.r2_key).filter((k) => k && k.length > 0);
    if (r2Keys.length > 0 && env.BLOBS) {
      await env.BLOBS.delete(r2Keys);
    }
    await env.DB.prepare(`DELETE FROM ${table} WHERE never_expires = 0 AND expired_at <= ?`)
      .bind(now)
      .run();
    total += rows.length;
  }
  return total;
}
