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
}
