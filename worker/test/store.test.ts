import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  createShare,
  getShare,
  setNeverExpires,
  deleteExpired,
  nowSeconds,
  NEVER_EXPIRES_AT,
} from "../src/store";

const enc = JSON.stringify({ ciphertext: "ct", iv: "iv", salt: "salt" });

describe("hybrid store (D1 metadata + R2 blob)", () => {
  it("create + get round-trips through D1 and R2", async () => {
    await createShare(env, "files", "AAA111", enc, nowSeconds() + 3600, false, "hash1");
    const rec = await getShare(env, "files", "AAA111");
    expect(rec).not.toBeNull();
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct", iv: "iv", salt: "salt" });
    expect(rec!.kind).toBe("files");
    expect(rec!.never_expires).toBe(false);
    expect(rec!.expires_at).not.toBe("");
    // Blob physically present in R2.
    expect(await env.BLOBS.get("files/AAA111")).not.toBeNull();
  });

  it("getShare returns null for an expired record", async () => {
    await createShare(env, "diff", "EXP001", enc, nowSeconds() - 10, false, "h");
    expect(await getShare(env, "diff", "EXP001")).toBeNull();
  });

  it("deleteExpired removes expired rows + blobs but keeps never_expires", async () => {
    await createShare(env, "files", "OLD001", enc, nowSeconds() - 10, false, "h");
    await createShare(env, "files", "KEEP01", enc, NEVER_EXPIRES_AT, true, "h");

    const removed = await deleteExpired(env);
    expect(removed).toBeGreaterThanOrEqual(1);

    expect(await env.BLOBS.get("files/OLD001")).toBeNull();
    expect(await env.BLOBS.get("files/KEEP01")).not.toBeNull();
    expect(await getShare(env, "files", "KEEP01")).not.toBeNull();
  });

  it("setNeverExpires updates D1 only; blob is untouched", async () => {
    await createShare(env, "files", "TOG001", enc, nowSeconds() + 3600, false, "h");
    const before = await env.BLOBS.get("files/TOG001");
    const beforeText = await before!.text();

    await setNeverExpires(env, "files", "TOG001", true, null);

    const rec = await getShare(env, "files", "TOG001");
    expect(rec!.never_expires).toBe(true);
    expect(rec!.expires_at).toBe("");

    const after = await env.BLOBS.get("files/TOG001");
    expect(await after!.text()).toBe(beforeText);
  });
});
