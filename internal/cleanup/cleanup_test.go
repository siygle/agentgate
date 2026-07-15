package cleanup

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/siygle/agentgate/internal/blobstore"
	"github.com/siygle/agentgate/internal/db"
)

// TestSweepDeletesExpiredRowsAndBlobs exercises the real GC path end to end:
// expired records (inline and blob-backed) are removed along with their blob
// files, while never-expires and still-live records — and their blobs — survive.
func TestSweepDeletesExpiredRowsAndBlobs(t *testing.T) {
	dir := t.TempDir()
	database, err := db.Open(filepath.Join(dir, "gc.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	blobs, err := blobstore.New(filepath.Join(dir, "blobs"))
	if err != nil {
		t.Fatalf("open blobstore: %v", err)
	}

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	// Expired + blob-backed: row and blob file should both go.
	expKey := blobstore.Key("files", "GCEXP1")
	if err := blobs.Put(expKey, `{"c":"expired"}`); err != nil {
		t.Fatalf("put expired blob: %v", err)
	}
	if err := db.CreateFileBundle(database, "GCEXP1", "", expKey, past, false, "h"); err != nil {
		t.Fatalf("create expired blob record: %v", err)
	}
	// Expired + inline: row should go (no blob involved).
	if err := db.CreateDiff(database, "GCEXP2", `{"c":"inline"}`, "", past, false, "h"); err != nil {
		t.Fatalf("create expired inline record: %v", err)
	}
	// Never-expires + blob-backed: row AND blob must survive.
	keepKey := blobstore.Key("files", "GCKEEP")
	if err := blobs.Put(keepKey, `{"c":"keep"}`); err != nil {
		t.Fatalf("put keep blob: %v", err)
	}
	if err := db.CreateFileBundle(database, "GCKEEP", "", keepKey, past, true, "h"); err != nil {
		t.Fatalf("create never-expires record: %v", err)
	}
	// Still-live + blob-backed: must survive.
	liveKey := blobstore.Key("files", "GCLIVE")
	if err := blobs.Put(liveKey, `{"c":"live"}`); err != nil {
		t.Fatalf("put live blob: %v", err)
	}
	if err := db.CreateFileBundle(database, "GCLIVE", "", liveKey, future, false, "h"); err != nil {
		t.Fatalf("create live record: %v", err)
	}

	sweep(database, blobs)

	// Expired records gone.
	if rec, _ := db.GetFileBundle(database, "GCEXP1"); rec != nil {
		t.Error("expired blob-backed row was not deleted")
	}
	if _, err := blobs.Get(expKey); err == nil {
		t.Error("expired blob file was not deleted")
	}
	if rec, _ := db.GetDiff(database, "GCEXP2"); rec != nil {
		t.Error("expired inline row was not deleted")
	}

	// Survivors intact, blobs preserved.
	if rec, _ := db.GetFileBundle(database, "GCKEEP"); rec == nil {
		t.Error("never-expires row was deleted")
	}
	if _, err := blobs.Get(keepKey); err != nil {
		t.Errorf("never-expires blob was deleted: %v", err)
	}
	if rec, _ := db.GetFileBundle(database, "GCLIVE"); rec == nil {
		t.Error("live row was deleted")
	}
	if _, err := blobs.Get(liveKey); err != nil {
		t.Errorf("live blob was deleted: %v", err)
	}
}
