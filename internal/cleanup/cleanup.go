package cleanup

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/diffmini/diffmini/internal/db"
)

// Start launches a background goroutine that periodically deletes expired
// records from the database. It stops when the context is cancelled.
func Start(ctx context.Context, database *sql.DB, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("cleanup: shutting down")
				return
			case <-ticker.C:
				count, err := db.DeleteExpired(database)
				if err != nil {
					log.Printf("cleanup: error deleting expired records: %v", err)
					continue
				}
				if count > 0 {
					log.Printf("cleanup: deleted %d expired records", count)
				}
			}
		}
	}()
}
