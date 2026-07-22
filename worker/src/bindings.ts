/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // D1 holds share metadata, and (when R2 is disabled) the encrypted blob too.
  DB: D1Database;
  // R2 holds the encrypted blob (the JSON `{ciphertext, iv, salt}`).
  // Optional: absent when the deployment runs D1-only (no R2 subscription).
  BLOBS?: R2Bucket;
  // Static Assets binding (css/js/vendor, index.html, view shells).
  ASSETS: Fetcher;
  // Public base URL for building preview/manage links.
  BASE_URL: string;
  // "true" enables the D1 + R2 hybrid (blobs in R2). Anything else (default)
  // uses D1-only storage so the system works without a paid R2 subscription.
  USE_R2?: string;

  // --- Owner dashboard (admin) ---
  // Secrets (set via `wrangler secret put`). An empty SESSION_SECRET disables
  // the admin subsystem entirely (fail closed).
  SESSION_SECRET?: string;
  OWNER_KEY?: string;
  // Session lifetime in seconds (default 43200 = 12h).
  SESSION_TTL?: string;
  // Cloudflare Access: team domain ("<team>.cloudflareaccess.com") + AUD tag.
  // When both are set, CF Access login is enabled.
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  // Optional comma-separated email allowlist for CF Access identities.
  CF_ACCESS_EMAILS?: string;
}
