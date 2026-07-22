import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./bindings";
import { generateId } from "./id";
import { generateOwnerToken, verifyOwnerToken, extractBearerToken } from "./owner";
import {
  createShare,
  getShare,
  getMetaForUpdate,
  setNeverExpires,
  replaceShareData,
  deleteExpired,
  nowSeconds,
  maxUploadBytes,
  DEFAULT_TTL_SECONDS,
  NEVER_EXPIRES_AT,
  type Kind,
} from "./store";
import { llmsTxt, llmsFullTxt } from "./llms";
import adminApp from "./admin";

type Ctx = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

// Permissive CORS applies ONLY to the public share API — never to the admin
// surface, which is same-origin and cookie-authenticated. (Browsers reject `*`
// with credentials anyway; scoping it removes any ambiguity.)
const publicCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});
app.use("/api/diff", publicCors);
app.use("/api/diff/*", publicCors);
app.use("/api/files", publicCors);
app.use("/api/files/*", publicCors);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(c: Ctx, data: unknown, status: 200 | 201 = 200) {
  return c.json({ success: true, data }, status);
}

function fail(c: Ctx, error: string, status: 400 | 401 | 404 | 413 | 500) {
  return c.json({ success: false, error }, status);
}

// tooLarge reports a payload over the active storage mode's per-share limit.
function tooLarge(c: Ctx, limit: number) {
  return fail(
    c,
    `encrypted payload exceeds the ${limit} byte limit; enable R2 (USE_R2=true) to store larger bundles`,
    413,
  );
}

// servePage returns a static HTML shell (Plan B). The shell's client JS fetches
// GET /api/{kind}/{id}, so view routes always return 200 for an existing shell.
async function servePage(c: Ctx, assetPath: string): Promise<Response> {
  const headers = { "content-type": "text/html; charset=utf-8" };
  if (c.req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  const res = await c.env.ASSETS.fetch(new Request(new URL(assetPath, c.req.url)));
  return new Response(res.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Pages (static shells; / and /static are served by Static Assets directly)
// ---------------------------------------------------------------------------

app.on(["GET", "HEAD"], "/", (c) => servePage(c, "/index.html"));
app.on(["GET", "HEAD"], "/p/:id", (c) => servePage(c, "/views/diff.html"));
app.on(["GET", "HEAD"], "/f/:id", (c) => servePage(c, "/views/files.html"));
app.on(["GET", "HEAD"], "/app/:id", (c) => servePage(c, "/views/app.html"));
app.on(["GET", "HEAD"], "/plan/:id", (c) => servePage(c, "/views/plan.html"));
app.on(["GET", "HEAD"], "/d/:id", (c) => servePage(c, "/views/plan.html"));

app.get("/llms.txt", (c) =>
  c.text(llmsTxt(c.env.BASE_URL), 200, { "content-type": "text/plain; charset=utf-8" }),
);
app.get("/llms-full.txt", (c) =>
  c.text(llmsFullTxt(c.env.BASE_URL), 200, { "content-type": "text/plain; charset=utf-8" }),
);

// Owner dashboard: static shell + admin API sub-app (same-origin, no `*` CORS).
app.on(["GET", "HEAD"], "/admin", (c) => servePage(c, "/views/admin.html"));
app.route("/api/admin", adminApp);

// ---------------------------------------------------------------------------
// API: create
// ---------------------------------------------------------------------------

interface CreateBody {
  encrypted_data?: { ciphertext?: string; iv?: string; salt?: string };
  expires_in_seconds?: number;
  never_expires?: boolean;
}

async function handleCreate(c: Ctx, kind: Kind): Promise<Response> {
  let body: CreateBody;
  try {
    body = await c.req.json<CreateBody>();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }

  const ed = body.encrypted_data;
  if (!ed || !ed.ciphertext || !ed.iv || !ed.salt) {
    return fail(c, "encrypted_data must include non-empty ciphertext, iv, and salt", 400);
  }

  const encJson = JSON.stringify({ ciphertext: ed.ciphertext, iv: ed.iv, salt: ed.salt });
  const limit = maxUploadBytes(c.env);
  if (encJson.length > limit) return tooLarge(c, limit);
  const id = generateId();
  const neverExpires = !!body.never_expires;
  const expiredAt = neverExpires
    ? NEVER_EXPIRES_AT
    : nowSeconds() +
      (body.expires_in_seconds && body.expires_in_seconds > 0
        ? body.expires_in_seconds
        : DEFAULT_TTL_SECONDS);

  const { token, hash } = await generateOwnerToken();
  try {
    await createShare(c.env, kind, id, encJson, expiredAt, neverExpires, hash);
  } catch {
    return fail(c, "internal server error", 500);
  }

  const previewURL = c.env.BASE_URL + (kind === "diff" ? "/p/" : "/f/") + id;
  return ok(
    c,
    {
      preview_url: previewURL,
      manage_url: previewURL + "#owner=" + token,
      id,
      owner_token: token,
    },
    201,
  );
}

app.post("/api/diff", (c) => handleCreate(c, "diff"));
app.post("/api/files", (c) => handleCreate(c, "files"));

// ---------------------------------------------------------------------------
// API: get
// ---------------------------------------------------------------------------

async function handleGet(c: Ctx, kind: Kind): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const rec = await getShare(c.env, kind, id);
  if (!rec) return fail(c, "not found", 404);

  const data: Record<string, unknown> = {
    encrypted_data: rec.encrypted_data,
    never_expires: rec.never_expires,
    id: rec.id,
    kind: rec.kind,
  };
  if (!rec.never_expires && rec.expires_at) data.expires_at = rec.expires_at;
  return ok(c, data, 200);
}

app.get("/api/diff/:id", (c) => handleGet(c, "diff"));
app.get("/api/files/:id", (c) => handleGet(c, "files"));

// ---------------------------------------------------------------------------
// API: patch (toggle never_expires)
// ---------------------------------------------------------------------------

interface UpdateBody {
  never_expires?: boolean;
}

async function handleUpdate(c: Ctx, kind: Kind): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const token = extractBearerToken(c.req.header("Authorization") ?? null);
  if (!token) return fail(c, "missing bearer token", 401);

  let body: UpdateBody;
  try {
    body = await c.req.json<UpdateBody>();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }
  if (typeof body.never_expires !== "boolean") return fail(c, "never_expires required", 400);

  const row = await getMetaForUpdate(c.env, kind, id);
  if (!row) return fail(c, "not found", 404);

  const storedHash = row.owner_token_hash ?? "";
  if (!storedHash || !(await verifyOwnerToken(token, storedHash))) {
    return fail(c, "invalid token", 401);
  }

  const neverExpires = body.never_expires;
  // If turning expiry back on and the stored deadline is already past (or the
  // never-expires sentinel), reset it so the share doesn't immediately vanish.
  let newExpiry: number | null = null;
  if (!neverExpires) {
    const now = nowSeconds();
    if (row.expired_at <= now || row.expired_at === NEVER_EXPIRES_AT) {
      newExpiry = now + DEFAULT_TTL_SECONDS;
    }
  }
  await setNeverExpires(c.env, kind, id, neverExpires, newExpiry);

  const data: Record<string, unknown> = { id, never_expires: neverExpires };
  if (!neverExpires) {
    const eff = newExpiry ?? row.expired_at;
    data.expires_at = new Date(eff * 1000).toISOString();
  }
  return ok(c, data, 200);
}

app.patch("/api/diff/:id", (c) => handleUpdate(c, "diff"));
app.patch("/api/files/:id", (c) => handleUpdate(c, "files"));

// ---------------------------------------------------------------------------
// API: put (replace ciphertext — "reset passphrase" / re-key)
// ---------------------------------------------------------------------------

async function handleReplace(c: Ctx, kind: Kind): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const token = extractBearerToken(c.req.header("Authorization") ?? null);
  if (!token) return fail(c, "missing bearer token", 401);

  let body: CreateBody;
  try {
    body = await c.req.json<CreateBody>();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }
  const ed = body.encrypted_data;
  if (!ed || !ed.ciphertext || !ed.iv || !ed.salt) {
    return fail(c, "encrypted_data must include non-empty ciphertext, iv, and salt", 400);
  }

  const encJson = JSON.stringify({ ciphertext: ed.ciphertext, iv: ed.iv, salt: ed.salt });
  const limit = maxUploadBytes(c.env);
  if (encJson.length > limit) return tooLarge(c, limit);

  const row = await getMetaForUpdate(c.env, kind, id);
  if (!row) return fail(c, "not found", 404);

  const storedHash = row.owner_token_hash ?? "";
  if (!storedHash || !(await verifyOwnerToken(token, storedHash))) {
    return fail(c, "invalid token", 401);
  }

  try {
    await replaceShareData(c.env, kind, id, encJson);
  } catch {
    return fail(c, "internal server error", 500);
  }
  return ok(c, { id }, 200);
}

app.put("/api/diff/:id", (c) => handleReplace(c, "diff"));
app.put("/api/files/:id", (c) => handleReplace(c, "files"));

// ---------------------------------------------------------------------------
// Entry point + scheduled cleanup
// ---------------------------------------------------------------------------

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const n = await deleteExpired(env);
    if (n > 0) console.log(`cleanup: deleted ${n} expired records`);
  },
};
