import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// End-to-end admin API tests hitting the whole Worker (index.ts) via SELF.
// The test env sets SESSION_SECRET + OWNER_KEY (see vitest.config.ts).

const BASE = "http://localhost";

async function body(res: Response): Promise<any> {
  return (await res.json()) as any;
}

async function login(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/admin/login/owner-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "hunter2" }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(/agentgate_admin=([^;]+)/);
  expect(m, "login should set the session cookie").not.toBeNull();
  return `agentgate_admin=${m![1]}`;
}

async function createShare(kind: "diff" | "files", ct: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_data: { ciphertext: ct, iv: "iv", salt: "salt" } }),
  });
  expect(res.status).toBe(201);
  return (await body(res)).data.id;
}

async function listAll(cookie: string): Promise<any[]> {
  const res = await SELF.fetch(`${BASE}/api/admin/shares?limit=200`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await body(res)).data.items;
}

describe("admin auth", () => {
  it("session probe reports enabled methods, not authenticated without a cookie", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/session`);
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.authenticated).toBe(false);
    expect(data.enabled).toBe(true);
    expect(data.methods).toContain("owner-key");
  });

  it("protected routes require a session", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/shares`);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong owner key", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/login/owner-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  it("does NOT put permissive CORS on admin endpoints", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/session`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("admin shares lifecycle", () => {
  it("lists, keeps-forever, revokes, re-shares, and deletes", async () => {
    const cookie = await login();
    const diffID = await createShare("diff", "ADMIN-CT-DIFF");
    const filesID = await createShare("files", "ADMIN-CT-FILES");

    // List includes both ids and never leaks ciphertext.
    const listRes = await SELF.fetch(`${BASE}/api/admin/shares?limit=200`, { headers: { Cookie: cookie } });
    const listText = await listRes.text();
    expect(listText).not.toContain("ADMIN-CT-DIFF");
    expect(listText).not.toContain("ADMIN-CT-FILES");
    const items = JSON.parse(listText).data.items as any[];
    const ids = items.map((i) => i.id);
    expect(ids).toContain(diffID);
    expect(ids).toContain(filesID);
    const diffItem = items.find((i) => i.id === diffID);
    expect(diffItem.status).toBe("active");
    expect(diffItem.storage).toBe("inline");
    expect(typeof diffItem.byte_size).toBe("number");

    // Keep-forever the diff.
    let res = await SELF.fetch(`${BASE}/api/admin/diff/${diffID}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ never_expires: true }),
    });
    expect(res.status).toBe(200);
    expect((await body(res)).data.never_expires).toBe(true);

    // Revoke the files bundle -> GET 404, still listed as expired.
    res = await SELF.fetch(`${BASE}/api/admin/files/${filesID}/revoke`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/files/${filesID}`);
    expect(res.status).toBe(404);
    const afterRevoke = (await listAll(cookie)).find((i) => i.id === filesID);
    expect(afterRevoke.status).toBe("expired");

    // Re-share the diff -> new id, same ciphertext.
    res = await SELF.fetch(`${BASE}/api/admin/diff/${diffID}/reshare`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const newID = (await body(res)).data.id;
    expect(newID).not.toBe(diffID);
    res = await SELF.fetch(`${BASE}/api/diff/${newID}`);
    expect(res.status).toBe(200);
    expect((await body(res)).data.encrypted_data.ciphertext).toBe("ADMIN-CT-DIFF");

    // Delete the diff -> gone from GET.
    res = await SELF.fetch(`${BASE}/api/admin/diff/${diffID}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    res = await SELF.fetch(`${BASE}/api/diff/${diffID}`);
    expect(res.status).toBe(404);

    // Unknown kind -> 404.
    res = await SELF.fetch(`${BASE}/api/admin/bogus/x`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});
