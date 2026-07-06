import { describe, it, expect } from "vitest";
import { generateOwnerToken, verifyOwnerToken, extractBearerToken } from "../src/owner";

describe("owner token", () => {
  it("verifies a freshly generated token against its stored hash", async () => {
    const { token, hash } = await generateOwnerToken();
    expect(token.length).toBeGreaterThan(0);
    expect(await verifyOwnerToken(token, hash)).toBe(true);
  });

  it("rejects a wrong token and empty inputs", async () => {
    const { hash } = await generateOwnerToken();
    expect(await verifyOwnerToken("not-the-token", hash)).toBe(false);
    expect(await verifyOwnerToken("", hash)).toBe(false);
    expect(await verifyOwnerToken("x", "")).toBe(false);
  });

  it("parses Bearer headers case-insensitively", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer xyz")).toBe("xyz");
    expect(extractBearerToken("Basic nope")).toBe("");
    expect(extractBearerToken(null)).toBe("");
    expect(extractBearerToken("Bearer")).toBe("");
  });
});
