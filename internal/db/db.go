package db

import (
	"database/sql"
	"fmt"

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

	// Run migrations.
	if _, err := db.Exec(migrations); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return db, nil
}
