// Owner (instance-admin) dashboard API for the Cloudflare Worker. Mounted at
// /api/admin by index.ts. Auth is separate from per-share owner tokens: an
// HMAC session cookie (session.ts) or a Cloudflare Access JWT (cf-access.ts).
//
// This sub-app is NOT wrapped by the permissive `*` CORS the public share API
// uses — admin is same-origin, with an Origin check on state-changing POSTs as
// CSRF defense-in-depth.

import { Hono, type Context, type Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "./bindings";
import { generateId } from "./id";
import { generateOwnerToken, sha256Hex, constantTimeEqual } from "./owner";
import {
  createShare,
  getMetaForUpdate,
  setNeverExpires,
  deleteShareById,
  listAllShares,
  getShareCiphertext,
  nowSeconds,
  DEFAULT_TTL_SECONDS,
  NEVER_EXPIRES_AT,
  type Kind,
} from "./store";
import {
  ADMIN_COOKIE_NAME,
  newSessionToken,
  verifySession,
  sessionCookie,
  clearSessionCookie,
  parseCookie,
} from "./session";
import { cfAccessEnabled, getCfAccessVerifier } from "./cf-access";

type Ctx = Context<{ Bindings: Env }>;

function ok(c: Ctx, data: unknown, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}
function fail(c: Ctx, error: string, status: ContentfulStatusCode) {
  return c.json({ success: false, error }, status);
}

// --- config accessors (Worker has no persistent server object) ---
function sessionSecret(env: Env): string {
  return env.SESSION_SECRET ?? "";
}
function adminEnabled(env: Env): boolean {
  return sessionSecret(env) !== "";
}
function sessionTTL(env: Env): number {
  const n = parseInt(env.SESSION_TTL ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 12 * 3600;
}
function secureCookies(env: Env): boolean {
  return (env.BASE_URL ?? "").startsWith("https://");
}
function enabledMethods(env: Env): string[] {
  const m: string[] = [];
  if (env.OWNER_KEY) m.push("owner-key");
  if (cfAccessEnabled(env)) m.push("cf-access");
  return m;
}

// authenticateAdmin returns the auth method used, or null. CF Access JWT is
// checked before the session cookie.
async function authenticateAdmin(c: Ctx): Promise<string | null> {
  if (cfAccessEnabled(c.env)) {
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt) {
      const verify = getCfAccessVerifier(c.env);
      if (verify && (await verify(jwt))) return "cf-access";
    }
  }
  const cookie = parseCookie(c.req.header("Cookie") ?? null, ADMIN_COOKIE_NAME);
  if (cookie) {
    const claims = await verifySession(sessionSecret(c.env), cookie, nowSeconds());
    if (claims) return claims.m;
  }
  return null;
}

function checkOrigin(c: Ctx): boolean {
  const origin = c.req.header("Origin");
  if (!origin) return true;
  try {
    const ou = new URL(origin);
    const bu = new URL(c.env.BASE_URL);
    return ou.protocol === bu.protocol && ou.host === bu.host;
  } catch {
    return false;
  }
}

// Best-effort per-isolate login rate limiter. Not shared across isolates —
// Cloudflare WAF/Access in front is the real control; this just slows trivial
// brute force within one isolate.
const loginHits = new Map<string, number[]>();
function rateLimitAllow(ip: string, limit = 5, windowSec = 60): boolean {
  const now = nowSeconds();
  const cutoff = now - windowSec;
  const kept = (loginHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (kept.length >= limit) {
    loginHits.set(ip, kept);
    return false;
  }
  kept.push(now);
  loginHits.set(ip, kept);
  return true;
}

const requireAdmin = async (c: Ctx, next: Next) => {
  c.header("Cache-Control", "no-store");
  if (!adminEnabled(c.env)) return fail(c, "admin disabled", 503);
  if (await authenticateAdmin(c)) {
    await next();
    return;
  }
  return fail(c, "unauthorized", 401);
};

function kindParam(c: Ctx): Kind | null {
  const k = c.req.param("kind");
  return k === "diff" || k === "files" ? k : null;
}

const admin = new Hono<{ Bindings: Env }>();

// --- Auth: probe, login, logout (public) ---

admin.get("/session", async (c) => {
  c.header("Cache-Control", "no-store");
  const enabled = adminEnabled(c.env);
  const info: Record<string, unknown> = {
    authenticated: false,
    enabled,
    methods: enabled ? enabledMethods(c.env) : [],
  };
  if (enabled) {
    const method = await authenticateAdmin(c);
    if (method) {
      info.authenticated = true;
      info.method = method;
      const cookie = parseCookie(c.req.header("Cookie") ?? null, ADMIN_COOKIE_NAME);
      if (cookie) {
        const claims = await verifySession(sessionSecret(c.env), cookie, nowSeconds());
        if (claims) info.exp = claims.exp;
      }
    }
  }
  return ok(c, info);
});

admin.post("/logout", (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Set-Cookie", clearSessionCookie(secureCookies(c.env)));
  return ok(c, { ok: true });
});

admin.post("/login/owner-key", async (c) => {
  c.header("Cache-Control", "no-store");
  const key = c.env.OWNER_KEY ?? "";
  if (!adminEnabled(c.env) || !key) return fail(c, "owner-key login disabled", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const ip = c.req.header("CF-Connecting-IP") ?? "anon";
  if (!rateLimitAllow(ip)) return fail(c, "too many attempts, try again later", 429);

  let body: { key?: string };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }
  if (!body.key) return fail(c, "key required", 400);

  const got = await sha256Hex(body.key);
  const want = await sha256Hex(key);
  if (!constantTimeEqual(got, want)) return fail(c, "invalid key", 401);

  const tok = await newSessionToken(sessionSecret(c.env), "owner-key", sessionTTL(c.env), nowSeconds());
  c.header("Set-Cookie", sessionCookie(tok, sessionTTL(c.env), secureCookies(c.env)));
  return ok(c, { method: "owner-key" });
});

// --- Shares: list, keep-forever, revoke, delete, re-share (protected) ---

admin.get("/shares", requireAdmin, async (c) => {
  const q = c.req.query();
  const limit = Math.min(Math.max(parseInt(q.limit ?? "", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset ?? "", 10) || 0, 0);
  const res = await listAllShares(c.env, {
    limit,
    offset,
    sort: q.sort,
    order: q.order,
    status: q.status,
    kind: q.kind,
  });
  const now = nowSeconds();
  const items = res.items.map((s) => {
    const neverExpires = s.never_expires !== 0;
    const item: Record<string, unknown> = {
      id: s.id,
      kind: s.kind,
      created_at: new Date(s.created_at * 1000).toISOString(),
      never_expires: neverExpires,
      storage: s.storage,
      byte_size: s.byte_size ?? null,
    };
    if (neverExpires) {
      item.status = "active";
    } else {
      item.expired_at = new Date(s.expired_at * 1000).toISOString();
      item.status = s.expired_at > now ? "active" : "expired";
    }
    return item;
  });
  return ok(c, { items, total: res.total, limit, offset });
});

admin.patch("/:kind/:id", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const id = c.req.param("id") ?? "";

  let body: { never_expires?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }
  if (typeof body.never_expires !== "boolean") return fail(c, "never_expires required", 400);

  const row = await getMetaForUpdate(c.env, kind, id);
  if (!row) return fail(c, "not found", 404);

  const neverExpires = body.never_expires;
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
  return ok(c, data);
});

admin.post("/:kind/:id/revoke", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const id = c.req.param("id") ?? "";

  const row = await getMetaForUpdate(c.env, kind, id);
  if (!row) return fail(c, "not found", 404);

  await setNeverExpires(c.env, kind, id, false, nowSeconds());
  return ok(c, { id, kind, status: "expired" });
});

admin.delete("/:kind/:id", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const id = c.req.param("id") ?? "";

  const deleted = await deleteShareById(c.env, kind, id);
  if (!deleted) return fail(c, "not found", 404);
  return ok(c, { id, kind, deleted: true });
});

admin.post("/:kind/:id/reshare", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const id = c.req.param("id") ?? "";

  const text = await getShareCiphertext(c.env, kind, id);
  if (text === null) return fail(c, "not found", 404);

  let body: { never_expires?: boolean; expires_in_seconds?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is fine — defaults to a fresh 7-day TTL.
  }

  const newId = generateId();
  const { token, hash } = await generateOwnerToken();
  const neverExpires = !!body.never_expires;
  const expiredAt = neverExpires
    ? NEVER_EXPIRES_AT
    : nowSeconds() +
      (body.expires_in_seconds && body.expires_in_seconds > 0
        ? body.expires_in_seconds
        : DEFAULT_TTL_SECONDS);

  try {
    await createShare(c.env, kind, newId, text, expiredAt, neverExpires, hash);
  } catch {
    return fail(c, "internal server error", 500);
  }

  const previewURL = c.env.BASE_URL + (kind === "diff" ? "/p/" : "/f/") + newId;
  return ok(c, {
    preview_url: previewURL,
    manage_url: previewURL + "#owner=" + token,
    id: newId,
    owner_token: token,
  });
});

export default admin;
