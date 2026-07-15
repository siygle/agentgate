package db

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

const migrations = `
CREATE TABLE IF NOT EXISTS diffs (
    id             TEXT PRIMARY KEY,
    encrypted_data TEXT NOT NULL,
    expired_at     DATETIME NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS file_bundles (
    id             TEXT PRIMARY KEY,
    encrypted_data TEXT NOT NULL,
    expired_at     DATETIME NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_diffs_expired ON diffs(expired_at);
CREATE INDEX IF NOT EXISTS idx_bundles_expired ON file_bundles(expired_at);
`

// addColumnMigrations are run after the base migrations. Each statement is
// expected to be idempotent: a "duplicate column" error is treated as success
// so existing databases pick up new columns on next startup.
var addColumnMigrations = []string{
	`ALTER TABLE diffs ADD COLUMN never_expires INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE diffs ADD COLUMN owner_token_hash TEXT`,
	`ALTER TABLE file_bundles ADD COLUMN never_expires INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE file_bundles ADD COLUMN owner_token_hash TEXT`,
	// blob_key points at an external filesystem blob (AGENTGATE_BLOB_DIR mode).
	// NULL/empty means the blob is stored inline in encrypted_data (the default
	// and the only mode before this migration), so existing rows keep working.
	`ALTER TABLE diffs ADD COLUMN blob_key TEXT`,
	`ALTER TABLE file_bundles ADD COLUMN blob_key TEXT`,
}

// Open opens a SQLite database at the given path, enables WAL mode,
// and runs migrations. It returns a ready-to-use *sql.DB.
func Open(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Enable WAL mode for better concurrent read/write performance.
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}

	// Run base migrations.
	if _, err := db.Exec(migrations); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	for _, stmt := range addColumnMigrations {
		if _, err := db.Exec(stmt); err != nil {
			// SQLite reports "duplicate column name" when the column already
			// exists. Treat that as a no-op so migrations are idempotent.
			if !strings.Contains(err.Error(), "duplicate column name") {
				db.Close()
				return nil, fmt.Errorf("add-column migration %q: %w", stmt, err)
			}
		}
	}

	return db, nil
}
