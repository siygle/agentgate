// Framework-agnostic HTTP contract test for AgentGate.
// Runs the same assertions against ANY backend (Go self-host or wrangler dev)
// so the two implementations cannot drift. See docs/api-contract.md.
//
// Usage: BASE_URL=http://localhost:8787 node test/contract/run.mjs
//        node test/contract/run.mjs http://localhost:18080

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:8787").replace(/\/$/, "");

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// The server never decrypts, so any non-empty strings are valid ciphertext.
const sample = () => ({
  encrypted_data: {
    ciphertext: "Y2lwaGVydGV4dA==",
    iv: "aXYtdmFsdWU=",
    salt: "c2FsdC12YWx1ZQ==",
  },
});

async function main() {
  console.log(`Contract test against ${BASE}\n`);

  // --- create (files) ---
  let r = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample()),
  });
  check("POST /api/files -> 201", r.status === 201, `got ${r.status}`);
  let body = await r.json();
  check("create envelope success", body.success === true);
  const fileId = body.data?.id;
  const fileToken = body.data?.owner_token;
  check("create returns id", !!fileId);
  check("create returns owner_token", !!fileToken);
  check("preview_url uses /f/", (body.data?.preview_url || "").includes(`/f/${fileId}`));
  check("manage_url has #owner=", (body.data?.manage_url || "").includes("#owner="));

  // --- get (files) ---
  r = await fetch(`${BASE}/api/files/${fileId}`);
  check("GET /api/files/{id} -> 200", r.status === 200, `got ${r.status}`);
  body = await r.json();
  check("get returns nested encrypted_data.ciphertext", body.data?.encrypted_data?.ciphertext === sample().encrypted_data.ciphertext);
  check("get kind = files", body.data?.kind === "files");
  check("get never_expires = false", body.data?.never_expires === false);
  check("get has expires_at", typeof body.data?.expires_at === "string" && body.data.expires_at.length > 0);

  // --- get missing -> 404 ---
  r = await fetch(`${BASE}/api/files/ZZZZZZ`);
  check("GET missing -> 404", r.status === 404, `got ${r.status}`);

  // --- create (diff) ---
  r = await fetch(`${BASE}/api/diff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample()),
  });
  check("POST /api/diff -> 201", r.status === 201, `got ${r.status}`);
  body = await r.json();
  const diffId = body.data?.id;
  check("diff preview_url uses /p/", (body.data?.preview_url || "").includes(`/p/${diffId}`));
  r = await fetch(`${BASE}/api/diff/${diffId}`);
  body = await r.json();
  check("GET diff kind = diff", body.data?.kind === "diff");

  // --- validation ---
  r = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_data: { ciphertext: "", iv: "x", salt: "y" } }),
  });
  check("POST missing ciphertext -> 400", r.status === 400, `got ${r.status}`);

  // --- patch auth ---
  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
    body: JSON.stringify({ never_expires: true }),
  });
  check("PATCH wrong token -> 401", r.status === 401, `got ${r.status}`);

  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ never_expires: true }),
  });
  check("PATCH no token -> 401", r.status === 401, `got ${r.status}`);

  // --- patch never_expires on/off ---
  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileToken}` },
    body: JSON.stringify({ never_expires: true }),
  });
  check("PATCH valid token -> 200", r.status === 200, `got ${r.status}`);
  body = await r.json();
  check("PATCH never_expires = true", body.data?.never_expires === true);

  r = await fetch(`${BASE}/api/files/${fileId}`);
  body = await r.json();
  check("GET after patch: never_expires true", body.data?.never_expires === true);
  check("GET after patch: no expires_at", !body.data?.expires_at);

  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileToken}` },
    body: JSON.stringify({ never_expires: false }),
  });
  body = await r.json();
  check("PATCH back to expiring -> 200 with reset expires_at", r.status === 200 && typeof body.data?.expires_at === "string" && body.data.expires_at.length > 0);

  // --- put (re-key: replace ciphertext) ---
  const rekeyed = {
    encrypted_data: { ciphertext: "cmVrZXllZA==", iv: "bmV3LWl2AAAA", salt: "bmV3LXNhbHQ=" },
  };
  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
    body: JSON.stringify(rekeyed),
  });
  check("PUT wrong token -> 401", r.status === 401, `got ${r.status}`);

  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rekeyed),
  });
  check("PUT no token -> 401", r.status === 401, `got ${r.status}`);

  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileToken}` },
    body: JSON.stringify({ encrypted_data: { ciphertext: "abc", iv: "", salt: "y" } }),
  });
  check("PUT missing ciphertext fields -> 400", r.status === 400, `got ${r.status}`);

  r = await fetch(`${BASE}/api/files/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fileToken}` },
    body: JSON.stringify(rekeyed),
  });
  check("PUT valid token -> 200", r.status === 200, `got ${r.status}`);

  r = await fetch(`${BASE}/api/files/${fileId}`);
  body = await r.json();
  check("GET after put: ciphertext replaced", body.data?.encrypted_data?.ciphertext === rekeyed.encrypted_data.ciphertext);

  // --- pages ---
  r = await fetch(`${BASE}/`);
  check("GET / -> 200 html", r.status === 200 && (r.headers.get("content-type") || "").includes("text/html"));
  r = await fetch(`${BASE}/f/${fileId}`);
  check("GET /f/{id} -> 200 html shell", r.status === 200 && (r.headers.get("content-type") || "").includes("text/html"));

  // --- llms ---
  r = await fetch(`${BASE}/llms.txt`);
  const txt = await r.text();
  check("GET /llms.txt -> 200 with base url", r.status === 200 && txt.includes(BASE));

  // --- admin dashboard ---
  // Always: the protected surface must be gated on both backends.
  r = await fetch(`${BASE}/api/admin/shares`);
  check("GET /api/admin/shares without session -> 401", r.status === 401, `got ${r.status}`);
  r = await fetch(`${BASE}/api/admin/session`);
  body = await r.json();
  check("GET /api/admin/session -> 200 status probe", r.status === 200 && body.success === true);

  // Full CRUD assertions run only when a session is available. Provide the owner
  // key via ADMIN_OWNER_KEY (the runner logs in itself) or a ready cookie via
  // ADMIN_SESSION (e.g. "agentgate_admin=...").
  let adminCookie = process.env.ADMIN_SESSION || "";
  const ownerKey = process.env.ADMIN_OWNER_KEY;
  if (ownerKey && !adminCookie) {
    const lr = await fetch(`${BASE}/api/admin/login/owner-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: ownerKey }),
    });
    if (lr.status === 200) {
      const m = (lr.headers.get("set-cookie") || "").match(/agentgate_admin=([^;]+)/);
      if (m) adminCookie = `agentgate_admin=${m[1]}`;
      check("admin owner-key login -> 200 + cookie", !!adminCookie);
    } else {
      check("admin owner-key login -> 200 + cookie", false, `got ${lr.status}`);
    }
  }

  if (!adminCookie) {
    console.log("  · admin CRUD assertions skipped (set ADMIN_OWNER_KEY or ADMIN_SESSION)");
  } else {
    const H = { Cookie: adminCookie };
    const CT_DIFF = "Y29udHJhY3QtYWRtaW4tZGlmZg==";
    const CT_FILES = "Y29udHJhY3QtYWRtaW4tZmlsZXM=";
    const mk = async (kind, ct) => {
      const rr = await fetch(`${BASE}/api/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_data: { ciphertext: ct, iv: "aXY=", salt: "c2E=" } }),
      });
      return (await rr.json()).data?.id;
    };
    const adDiff = await mk("diff", CT_DIFF);
    const adFiles = await mk("files", CT_FILES);

    r = await fetch(`${BASE}/api/admin/shares?limit=200`, { headers: H });
    check("admin list -> 200", r.status === 200, `got ${r.status}`);
    const listText = await r.text();
    check("admin list never leaks ciphertext", !listText.includes(CT_DIFF) && !listText.includes(CT_FILES));
    const listBody = JSON.parse(listText);
    const items = listBody.data?.items || [];
    const ids = items.map((i) => i.id);
    check("admin list includes created ids", ids.includes(adDiff) && ids.includes(adFiles));
    const di = items.find((i) => i.id === adDiff);
    check("admin list item status active", di?.status === "active");
    check("admin list created_at is RFC3339", typeof di?.created_at === "string" && /\dT\d/.test(di.created_at));
    check("admin list has byte_size field", di && Object.prototype.hasOwnProperty.call(di, "byte_size"));

    r = await fetch(`${BASE}/api/admin/diff/${adDiff}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ never_expires: true }),
    });
    body = await r.json();
    check("admin keep-forever -> 200 never_expires", r.status === 200 && body.data?.never_expires === true);

    r = await fetch(`${BASE}/api/admin/files/${adFiles}/revoke`, { method: "POST", headers: H });
    check("admin revoke -> 200", r.status === 200, `got ${r.status}`);
    r = await fetch(`${BASE}/api/files/${adFiles}`);
    check("revoked share GET -> 404", r.status === 404, `got ${r.status}`);
    r = await fetch(`${BASE}/api/admin/shares?limit=200&status=expired`, { headers: H });
    const exIds = ((await r.json()).data?.items || []).map((i) => i.id);
    check("revoked share listed as expired", exIds.includes(adFiles));

    r = await fetch(`${BASE}/api/admin/diff/${adDiff}/reshare`, { method: "POST", headers: H });
    body = await r.json();
    const reshareId = body.data?.id;
    check("admin reshare -> 200 new id", r.status === 200 && !!reshareId && reshareId !== adDiff);
    r = await fetch(`${BASE}/api/diff/${reshareId}`);
    body = await r.json();
    check("reshared GET returns same ciphertext", body.data?.encrypted_data?.ciphertext === CT_DIFF);

    r = await fetch(`${BASE}/api/admin/diff/${adDiff}`, { method: "DELETE", headers: H });
    check("admin delete -> 200", r.status === 200, `got ${r.status}`);
    r = await fetch(`${BASE}/api/diff/${adDiff}`);
    check("deleted share GET -> 404", r.status === 404, `got ${r.status}`);

    r = await fetch(`${BASE}/api/admin/bogus/x`, { method: "DELETE", headers: H });
    check("admin unknown kind -> 404", r.status === 404, `got ${r.status}`);

    r = await fetch(`${BASE}/api/admin/logout`, { method: "POST", headers: H });
    check("admin logout -> 200", r.status === 200, `got ${r.status}`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Contract test crashed:", e);
  process.exit(1);
});
