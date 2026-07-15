package blobstore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNilStoreIsInlineMode(t *testing.T) {
	s, err := New("")
	if err != nil {
		t.Fatalf("New(\"\") error: %v", err)
	}
	if s.Enabled() {
		t.Fatal("empty dir should be inline mode (Enabled() == false)")
	}
}

func TestPutGetDeleteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if !s.Enabled() {
		t.Fatal("store with a dir should be Enabled()")
	}

	key := Key("files", "ABC123")
	if key != "files/ABC123" {
		t.Fatalf("Key = %q, want files/ABC123", key)
	}

	const payload = `{"ciphertext":"ct","iv":"iv","salt":"salt"}`
	if err := s.Put(key, payload); err != nil {
		t.Fatalf("Put: %v", err)
	}

	// The blob lands under <dir>/<kind>/<id>.
	if _, err := os.Stat(filepath.Join(dir, "files", "ABC123")); err != nil {
		t.Fatalf("blob file missing: %v", err)
	}

	got, err := s.Get(key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != payload {
		t.Fatalf("Get = %q, want %q", got, payload)
	}

	// Put overwrites in place (re-key path).
	const payload2 = `{"ciphertext":"ct2","iv":"iv2","salt":"salt2"}`
	if err := s.Put(key, payload2); err != nil {
		t.Fatalf("Put overwrite: %v", err)
	}
	if got, _ := s.Get(key); got != payload2 {
		t.Fatalf("after overwrite Get = %q, want %q", got, payload2)
	}

	if err := s.Delete(key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Get(key); !os.IsNotExist(err) {
		t.Fatalf("Get after delete should be not-exist, got %v", err)
	}
	// Delete is idempotent.
	if err := s.Delete(key); err != nil {
		t.Fatalf("second Delete should be nil, got %v", err)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	s, _ := New(t.TempDir())
	for _, bad := range []string{"", "/etc/passwd", "../escape", "files/../../x", "a\\b"} {
		if err := s.Put(bad, "x"); err == nil {
			t.Fatalf("Put(%q) should have been rejected", bad)
		}
		if _, err := s.Get(bad); err == nil {
			t.Fatalf("Get(%q) should have been rejected", bad)
		}
	}
}
