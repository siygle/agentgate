import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "../src/bindings";
import {
  createShare,
  getShare,
  setNeverExpires,
  replaceShareData,
  deleteExpired,
  nowSeconds,
  useR2,
  NEVER_EXPIRES_AT,
} from "../src/store";

const enc = JSON.stringify({ ciphertext: "ct", iv: "iv", salt: "salt" });

// Two env variants over the same D1 + R2 bindings, toggling the storage mode.
const d1Env: Env = { ...(env as unknown as Env), USE_R2: "false" };
const r2Env: Env = { ...(env as unknown as Env), USE_R2: "true" };

describe("useR2 flag", () => {
  it("is off unless USE_R2 is exactly 'true' with a binding", () => {
    expect(useR2(d1Env)).toBe(false);
    expect(useR2(r2Env)).toBe(true);
    expect(useR2({ ...(env as unknown as Env), USE_R2: "true", BLOBS: undefined })).toBe(false);
    expect(useR2({ ...(env as unknown as Env), USE_R2: undefined })).toBe(false);
  });
});

describe("D1-only mode (default, no R2 subscription)", () => {
  it("stores the blob in D1 and does NOT write to R2", async () => {
    await createShare(d1Env, "files", "D1A001", enc, nowSeconds() + 3600, false, "hash1");
    const rec = await getShare(d1Env, "files", "D1A001");
    expect(rec).not.toBeNull();
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct", iv: "iv", salt: "salt" });
    // No R2 object was created for a D1-only record.
    expect(await env.BLOBS!.get("files/D1A001")).toBeNull();
  });

  it("deleteExpired removes expired D1-only rows, keeps never_expires", async () => {
    await createShare(d1Env, "files", "D1OLD1", enc, nowSeconds() - 10, false, "h");
    await createShare(d1Env, "files", "D1KEEP", enc, NEVER_EXPIRES_AT, true, "h");
    const removed = await deleteExpired(d1Env);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await getShare(d1Env, "files", "D1OLD1")).toBeNull();
    expect(await getShare(d1Env, "files", "D1KEEP")).not.toBeNull();
  });
});

describe("hybrid mode (USE_R2=true)", () => {
  it("stores the blob in R2 and round-trips", async () => {
    await createShare(r2Env, "files", "R2A001", enc, nowSeconds() + 3600, false, "hash1");
    const rec = await getShare(r2Env, "files", "R2A001");
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct", iv: "iv", salt: "salt" });
    expect(await env.BLOBS!.get("files/R2A001")).not.toBeNull();
  });

  it("deleteExpired removes expired rows + their R2 blobs, keeps never_expires", async () => {
    await createShare(r2Env, "files", "R2OLD1", enc, nowSeconds() - 10, false, "h");
    await createShare(r2Env, "files", "R2KEEP", enc, NEVER_EXPIRES_AT, true, "h");
    await deleteExpired(r2Env);
    expect(await env.BLOBS!.get("files/R2OLD1")).toBeNull();
    expect(await env.BLOBS!.get("files/R2KEEP")).not.toBeNull();
  });
});

describe("cross-mode reads", () => {
  it("a record written via R2 is still readable when the R2 binding is available", async () => {
    await createShare(r2Env, "diff", "XMODE1", enc, nowSeconds() + 3600, false, "h");
    // Reading with D1-only env still works because getShare falls back to R2
    // whenever the row has no inline blob and the binding is present.
    const rec = await getShare(d1Env, "diff", "XMODE1");
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct", iv: "iv", salt: "salt" });
  });
});

describe("replaceShareData (re-key)", () => {
  const enc2 = JSON.stringify({ ciphertext: "ct2", iv: "iv2", salt: "salt2" });

  it("overwrites the D1 blob, keeping metadata (D1-only mode)", async () => {
    await createShare(d1Env, "files", "RK1D01", enc, nowSeconds() + 3600, false, "h");
    await replaceShareData(d1Env, "files", "RK1D01", enc2);
    const rec = await getShare(d1Env, "files", "RK1D01");
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct2", iv: "iv2", salt: "salt2" });
    expect(rec!.never_expires).toBe(false);
    // No stray R2 object for a D1-only record.
    expect(await env.BLOBS!.get("files/RK1D01")).toBeNull();
  });

  it("overwrites the R2 blob in place (hybrid mode)", async () => {
    await createShare(r2Env, "files", "RK1R01", enc, nowSeconds() + 3600, false, "h");
    await replaceShareData(r2Env, "files", "RK1R01", enc2);
    const rec = await getShare(r2Env, "files", "RK1R01");
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct2", iv: "iv2", salt: "salt2" });
    const obj = await env.BLOBS!.get("files/RK1R01");
    expect(obj).not.toBeNull();
    expect(await obj!.text()).toBe(enc2);
  });
});

describe("setNeverExpires", () => {
  it("updates D1 only; the blob is untouched (D1-only mode)", async () => {
    await createShare(d1Env, "files", "TOG001", enc, nowSeconds() + 3600, false, "h");
    await setNeverExpires(d1Env, "files", "TOG001", true, null);
    const rec = await getShare(d1Env, "files", "TOG001");
    expect(rec!.never_expires).toBe(true);
    expect(rec!.expires_at).toBe("");
    expect(rec!.encrypted_data).toEqual({ ciphertext: "ct", iv: "iv", salt: "salt" });
  });
});
