-- AgentGate D1 schema (metadata only; encrypted blobs live in R2).
-- Timestamps are stored as INTEGER unix seconds for simple expiry comparisons.

CREATE TABLE IF NOT EXISTS diffs (
    id               TEXT PRIMARY KEY,
    r2_key           TEXT NOT NULL,
    expired_at       INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    never_expires    INTEGER NOT NULL DEFAULT 0,
    owner_token_hash TEXT
);

CREATE TABLE IF NOT EXISTS file_bundles (
    id               TEXT PRIMARY KEY,
    r2_key           TEXT NOT NULL,
    expired_at       INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    never_expires    INTEGER NOT NULL DEFAULT 0,
    owner_token_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_diffs_expired ON diffs(expired_at);
CREATE INDEX IF NOT EXISTS idx_bundles_expired ON file_bundles(expired_at);
