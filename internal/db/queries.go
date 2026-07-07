package db

import (
	"database/sql"
	"time"
)

// CreateDiff inserts a new diff record.
func CreateDiff(db *sql.DB, id, encryptedData string, expiredAt time.Time, neverExpires bool, ownerTokenHash string) error {
	_, err := db.Exec(
		`INSERT INTO diffs (id, encrypted_data, expired_at, never_expires, owner_token_hash)
		 VALUES (?, ?, ?, ?, ?)`,
		id, encryptedData, expiredAt.UTC(), boolToInt(neverExpires), nullableString(ownerTokenHash),
	)
	return err
}

// GetDiff retrieves a diff by ID. Returns nil if not found.
func GetDiff(db *sql.DB, id string) (*Diff, error) {
	row := db.QueryRow(
		`SELECT id, encrypted_data, expired_at, created_at, never_expires, owner_token_hash
		 FROM diffs WHERE id = ?`,
		id,
	)

	var d Diff
	var neverExpires int
	err := row.Scan(&d.ID, &d.EncryptedData, &d.ExpiredAt, &d.CreatedAt, &neverExpires, &d.OwnerTokenHash)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.NeverExpires = neverExpires != 0
	return &d, nil
}

// CreateFileBundle inserts a new file bundle record.
func CreateFileBundle(db *sql.DB, id, encryptedData string, expiredAt time.Time, neverExpires bool, ownerTokenHash string) error {
	_, err := db.Exec(
		`INSERT INTO file_bundles (id, encrypted_data, expired_at, never_expires, owner_token_hash)
		 VALUES (?, ?, ?, ?, ?)`,
		id, encryptedData, expiredAt.UTC(), boolToInt(neverExpires), nullableString(ownerTokenHash),
	)
	return err
}

// GetFileBundle retrieves a file bundle by ID. Returns nil if not found.
func GetFileBundle(db *sql.DB, id string) (*FileBundle, error) {
	row := db.QueryRow(
		`SELECT id, encrypted_data, expired_at, created_at, never_expires, owner_token_hash
		 FROM file_bundles WHERE id = ?`,
		id,
	)

	var fb FileBundle
	var neverExpires int
	err := row.Scan(&fb.ID, &fb.EncryptedData, &fb.ExpiredAt, &fb.CreatedAt, &neverExpires, &fb.OwnerTokenHash)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	fb.NeverExpires = neverExpires != 0
	return &fb, nil
}

// SetDiffNeverExpires updates the never_expires flag, and optionally bumps
// expired_at to a fresh deadline (used when re-enabling expiry on a record
// whose original expiry has already passed).
func SetDiffNeverExpires(db *sql.DB, id string, neverExpires bool, newExpiry *time.Time) error {
	if newExpiry != nil {
		_, err := db.Exec(
			`UPDATE diffs SET never_expires = ?, expired_at = ? WHERE id = ?`,
			boolToInt(neverExpires), newExpiry.UTC(), id,
		)
		return err
	}
	_, err := db.Exec(
		`UPDATE diffs SET never_expires = ? WHERE id = ?`,
		boolToInt(neverExpires), id,
	)
	return err
}

// SetFileBundleNeverExpires updates the never_expires flag (with optional
// expired_at bump) on a file bundle record.
func SetFileBundleNeverExpires(db *sql.DB, id string, neverExpires bool, newExpiry *time.Time) error {
	if newExpiry != nil {
		_, err := db.Exec(
			`UPDATE file_bundles SET never_expires = ?, expired_at = ? WHERE id = ?`,
			boolToInt(neverExpires), newExpiry.UTC(), id,
		)
		return err
	}
	_, err := db.Exec(
		`UPDATE file_bundles SET never_expires = ? WHERE id = ?`,
		boolToInt(neverExpires), id,
	)
	return err
}

// UpdateDiffEncryptedData overwrites the encrypted blob of a diff record,
// leaving expiry, never_expires, and owner_token_hash untouched. Used for
// in-place re-keying (changing the passphrase).
func UpdateDiffEncryptedData(db *sql.DB, id, encryptedData string) error {
	_, err := db.Exec(
		`UPDATE diffs SET encrypted_data = ? WHERE id = ?`,
		encryptedData, id,
	)
	return err
}

// UpdateFileBundleEncryptedData overwrites the encrypted blob of a file bundle
// record (in-place re-key).
func UpdateFileBundleEncryptedData(db *sql.DB, id, encryptedData string) error {
	_, err := db.Exec(
		`UPDATE file_bundles SET encrypted_data = ? WHERE id = ?`,
		encryptedData, id,
	)
	return err
}

// DeleteExpired removes expired records from both diffs and file_bundles tables.
// Records marked never_expires=1 are skipped. It returns the total number of
// deleted rows.
func DeleteExpired(db *sql.DB) (int64, error) {
	now := time.Now().UTC()

	res1, err := db.Exec("DELETE FROM diffs WHERE never_expires = 0 AND expired_at <= ?", now)
	if err != nil {
		return 0, err
	}
	count1, err := res1.RowsAffected()
	if err != nil {
		return 0, err
	}

	res2, err := db.Exec("DELETE FROM file_bundles WHERE never_expires = 0 AND expired_at <= ?", now)
	if err != nil {
		return 0, err
	}
	count2, err := res2.RowsAffected()
	if err != nil {
		return 0, err
	}

	return count1 + count2, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullableString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
