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
