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
