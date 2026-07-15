package db

import (
	"database/sql"
	"time"
)

// CreateDiff inserts a new diff record. blobKey is empty for inline storage
// (encryptedData holds the blob) or set when the blob lives on the filesystem
// (encryptedData is then empty).
func CreateDiff(db *sql.DB, id, encryptedData, blobKey string, expiredAt time.Time, neverExpires bool, ownerTokenHash string) error {
	_, err := db.Exec(
		`INSERT INTO diffs (id, encrypted_data, expired_at, never_expires, owner_token_hash, blob_key)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, encryptedData, expiredAt.UTC(), boolToInt(neverExpires), nullableString(ownerTokenHash), nullableString(blobKey),
	)
	return err
}

// GetDiff retrieves a diff by ID. Returns nil if not found.
func GetDiff(db *sql.DB, id string) (*Diff, error) {
	row := db.QueryRow(
		`SELECT id, encrypted_data, expired_at, created_at, never_expires, owner_token_hash, COALESCE(blob_key, '')
		 FROM diffs WHERE id = ?`,
		id,
	)

	var d Diff
	var neverExpires int
	err := row.Scan(&d.ID, &d.EncryptedData, &d.ExpiredAt, &d.CreatedAt, &neverExpires, &d.OwnerTokenHash, &d.BlobKey)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.NeverExpires = neverExpires != 0
	return &d, nil
}

// CreateFileBundle inserts a new file bundle record. See CreateDiff for blobKey.
func CreateFileBundle(db *sql.DB, id, encryptedData, blobKey string, expiredAt time.Time, neverExpires bool, ownerTokenHash string) error {
	_, err := db.Exec(
		`INSERT INTO file_bundles (id, encrypted_data, expired_at, never_expires, owner_token_hash, blob_key)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, encryptedData, expiredAt.UTC(), boolToInt(neverExpires), nullableString(ownerTokenHash), nullableString(blobKey),
	)
	return err
}

// GetFileBundle retrieves a file bundle by ID. Returns nil if not found.
func GetFileBundle(db *sql.DB, id string) (*FileBundle, error) {
	row := db.QueryRow(
		`SELECT id, encrypted_data, expired_at, created_at, never_expires, owner_token_hash, COALESCE(blob_key, '')
		 FROM file_bundles WHERE id = ?`,
		id,
	)

	var fb FileBundle
	var neverExpires int
	err := row.Scan(&fb.ID, &fb.EncryptedData, &fb.ExpiredAt, &fb.CreatedAt, &neverExpires, &fb.OwnerTokenHash, &fb.BlobKey)
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
// Records marked never_expires=1 are skipped. It returns the blob keys of any
// deleted records that stored their blob on the filesystem (so the caller can
// delete those files) and the total number of deleted rows.
//
// The delete uses RETURNING so the blob keys come from exactly the rows that
// were deleted, atomically. A prior SELECT-then-DELETE could race a concurrent
// "keep this share" (PATCH never_expires=true) on an about-to-expire record:
// the row would survive the DELETE but its blob key would already be queued for
// unlinking, orphaning a live share. RETURNING closes that window.
func DeleteExpired(db *sql.DB) (blobKeys []string, count int64, err error) {
	now := time.Now().UTC()
	for _, table := range []string{"diffs", "file_bundles"} {
		rows, derr := db.Query(
			"DELETE FROM "+table+" WHERE never_expires = 0 AND expired_at <= ? RETURNING COALESCE(blob_key, '')",
			now,
		)
		if derr != nil {
			return nil, 0, derr
		}
		for rows.Next() {
			var k string
			if serr := rows.Scan(&k); serr != nil {
				rows.Close()
				return nil, 0, serr
			}
			count++
			if k != "" {
				blobKeys = append(blobKeys, k)
			}
		}
		if cerr := rows.Err(); cerr != nil {
			rows.Close()
			return nil, 0, cerr
		}
		rows.Close()
	}
	return blobKeys, count, nil
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
