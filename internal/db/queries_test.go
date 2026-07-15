package db

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDeleteExpiredReturnsBlobKeys(t *testing.T) {
	d, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer d.Close()

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	// Expired, filesystem-backed → its blob key should come back for unlinking.
	if err := CreateFileBundle(d, "EXP001", "", "files/EXP001", past, false, "h"); err != nil {
		t.Fatalf("create expired blob record: %v", err)
	}
	// Expired, inline → deleted but no blob key.
	if err := CreateFileBundle(d, "EXP002", `{"c":"x"}`, "", past, false, "h"); err != nil {
		t.Fatalf("create expired inline record: %v", err)
	}
	// Expired timestamp but never_expires → must survive.
	if err := CreateDiff(d, "KEEP01", "", "diff/KEEP01", past, true, "h"); err != nil {
		t.Fatalf("create never-expires record: %v", err)
	}
	// Not expired → must survive.
	if err := CreateFileBundle(d, "KEEP02", `{"c":"y"}`, "", future, false, "h"); err != nil {
		t.Fatalf("create live record: %v", err)
	}

	blobKeys, count, err := DeleteExpired(d)
	if err != nil {
		t.Fatalf("DeleteExpired: %v", err)
	}
	if count != 2 {
		t.Fatalf("deleted count = %d, want 2 (EXP001 + EXP002)", count)
	}
	if len(blobKeys) != 1 || blobKeys[0] != "files/EXP001" {
		t.Fatalf("blobKeys = %v, want [files/EXP001] (only expired blob-backed rows)", blobKeys)
	}

	// Survivors are still readable.
	if rec, _ := GetDiff(d, "KEEP01"); rec == nil {
		t.Fatal("never-expires record was deleted")
	}
	if rec, _ := GetFileBundle(d, "KEEP02"); rec == nil {
		t.Fatal("live record was deleted")
	}
	if rec, _ := GetFileBundle(d, "EXP001"); rec != nil {
		t.Fatal("expired record was not deleted")
	}
}
