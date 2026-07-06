/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // D1 holds share metadata (id, r2_key, expiry, owner hash).
  DB: D1Database;
  // R2 holds the encrypted blob (the JSON `{ciphertext, iv, salt}`).
  BLOBS: R2Bucket;
  // Static Assets binding (css/js/vendor, index.html, view shells).
  ASSETS: Fetcher;
  // Public base URL for building preview/manage links.
  BASE_URL: string;
}
