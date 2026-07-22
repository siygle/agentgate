package db

import (
	"database/sql"
	"time"
)

// Diff represents an encrypted diff stored in the database.
type Diff struct {
	ID             string
	EncryptedData  string // JSON string
	ExpiredAt      time.Time
	CreatedAt      time.Time
	NeverExpires   bool
	OwnerTokenHash sql.NullString
	// BlobKey is non-empty when the encrypted blob lives on the filesystem
	// (AGENTGATE_BLOB_DIR mode) rather than inline in EncryptedData.
	BlobKey string
}

// ShareSummary is one row of the admin listing: metadata only, never the
// ciphertext. ByteSize is valid only for inline records (length of
// encrypted_data); it is NULL for filesystem-blob records to avoid a per-file
// stat on every list.
type ShareSummary struct {
	ID           string
	Kind         string // "diff" | "files"
	CreatedAt    time.Time
	ExpiredAt    time.Time
	NeverExpires bool
	HasBlob      bool // blob_key is non-empty -> storage "blob"
	ByteSize     sql.NullInt64
}

// FileBundle represents an encrypted file bundle stored in the database.
type FileBundle struct {
	ID             string
	EncryptedData  string
	ExpiredAt      time.Time
	CreatedAt      time.Time
	NeverExpires   bool
	OwnerTokenHash sql.NullString
	// BlobKey is non-empty when the encrypted blob lives on the filesystem
	// (AGENTGATE_BLOB_DIR mode) rather than inline in EncryptedData.
	BlobKey string
}
