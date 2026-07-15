package cleanup

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/siygle/agentgate/internal/blobstore"
	"github.com/siygle/agentgate/internal/db"
)

// Start launches a background goroutine that periodically deletes expired
// records from the database (and their filesystem blobs, if any). It stops when
// the context is cancelled. blobs may be nil (inline storage).
func Start(ctx context.Context, database *sql.DB, blobs *blobstore.Store, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("cleanup: shutting down")
				return
			case <-ticker.C:
				sweep(database, blobs)
			}
		}
	}()
}

// sweep deletes expired records and the on-disk blobs of the rows it just
// deleted. Blob deletion is best effort: a failed unlink only leaves an orphan
// file, never a dangling record. Extracted from the goroutine so it can be
// exercised directly in tests.
func sweep(database *sql.DB, blobs *blobstore.Store) {
	blobKeys, count, err := db.DeleteExpired(database)
	if err != nil {
		log.Printf("cleanup: error deleting expired records: %v", err)
		return
	}
	for _, key := range blobKeys {
		if err := blobs.Delete(key); err != nil {
			log.Printf("cleanup: error deleting blob %q: %v", key, err)
		}
	}
	if count > 0 {
		log.Printf("cleanup: deleted %d expired records", count)
	}
}
