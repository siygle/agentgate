package db

import (
	"database/sql"
	"time"
)

// CreateDiff inserts a new diff record.
func CreateDiff(db *sql.DB, id, encryptedData string, expiredAt time.Time) error {
	_, err := db.Exec(
		"INSERT INTO diffs (id, encrypted_data, expired_at) VALUES (?, ?, ?)",
		id, encryptedData, expiredAt.UTC(),
	)
	return err
}

// GetDiff retrieves a diff by ID. Returns nil if not found.
func GetDiff(db *sql.DB, id string) (*Diff, error) {
	row := db.QueryRow(
		"SELECT id, encrypted_data, expired_at, created_at FROM diffs WHERE id = ?",
		id,
	)

	var d Diff
	err := row.Scan(&d.ID, &d.EncryptedData, &d.ExpiredAt, &d.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// CreateFileBundle inserts a new file bundle record.
func CreateFileBundle(db *sql.DB, id, encryptedData string, expiredAt time.Time) error {
	_, err := db.Exec(
		"INSERT INTO file_bundles (id, encrypted_data, expired_at) VALUES (?, ?, ?)",
		id, encryptedData, expiredAt.UTC(),
	)
	return err
}

// GetFileBundle retrieves a file bundle by ID. Returns nil if not found.
func GetFileBundle(db *sql.DB, id string) (*FileBundle, error) {
	row := db.QueryRow(
		"SELECT id, encrypted_data, expired_at, created_at FROM file_bundles WHERE id = ?",
		id,
	)

	var fb FileBundle
	err := row.Scan(&fb.ID, &fb.EncryptedData, &fb.ExpiredAt, &fb.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &fb, nil
}

// DeleteExpired removes expired records from both diffs and file_bundles tables.
// It returns the total number of deleted rows.
func DeleteExpired(db *sql.DB) (int64, error) {
	now := time.Now().UTC()

	res1, err := db.Exec("DELETE FROM diffs WHERE expired_at <= ?", now)
	if err != nil {
		return 0, err
	}
	count1, err := res1.RowsAffected()
	if err != nil {
		return 0, err
	}

	res2, err := db.Exec("DELETE FROM file_bundles WHERE expired_at <= ?", now)
	if err != nil {
		return 0, err
	}
	count2, err := res2.RowsAffected()
	if err != nil {
		return 0, err
	}

	return count1 + count2, nil
}
