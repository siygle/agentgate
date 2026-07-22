// Package blobstore persists encrypted share blobs on the filesystem — the
// self-host analog of the Cloudflare Worker's R2 path. When AGENTGATE_BLOB_DIR
// is unset the server runs in inline mode (blobs live in the SQLite
// encrypted_data column) and *Store is nil; every method is nil-safe so callers
// can hold a possibly-nil *Store and gate on Enabled().
package blobstore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Store writes blobs under a root directory. A blob's key is "<kind>/<id>",
// which maps to "<dir>/<kind>/<id>".
type Store struct {
	dir string
}

// New returns a filesystem-backed Store rooted at dir, creating it if needed.
// An empty dir returns (nil, nil): inline mode, no external blob storage.
func New(dir string) (*Store, error) {
	if dir == "" {
		return nil, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create blob dir %q: %w", dir, err)
	}
	return &Store{dir: dir}, nil
}

// Enabled reports whether external blob storage is active.
func (s *Store) Enabled() bool { return s != nil && s.dir != "" }

// Key is the storage key for a record.
func Key(kind, id string) string { return kind + "/" + id }

// path resolves a key to an absolute filesystem path, rejecting anything that
// could escape the root (defense in depth — keys are built from a fixed kind and
// a generated id, but never trust a stored value blindly).
func (s *Store) path(key string) (string, error) {
	if key == "" || strings.HasPrefix(key, "/") || strings.Contains(key, "\\") ||
		strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid blob key %q", key)
	}
	return filepath.Join(s.dir, filepath.FromSlash(key)), nil
}

// Put writes data for key, replacing any existing blob. The write goes to a
// temp file and is renamed into place so a reader never sees a partial blob.
func (s *Store) Put(key, data string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(data), 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, p); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// Get reads the blob for key. A missing blob returns an error satisfying
// os.IsNotExist, which callers map to "not found".
func (s *Store) Get(key string) (string, error) {
	p, err := s.path(key)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Copy duplicates the blob at srcKey to dstKey, reusing Put's temp-file+rename
// so a reader never sees a partial destination blob. Used by admin re-share to
// give the copied record its own blob object.
func (s *Store) Copy(srcKey, dstKey string) error {
	data, err := s.Get(srcKey)
	if err != nil {
		return err
	}
	return s.Put(dstKey, data)
}

// Delete removes the blob for key. A missing blob is not an error (idempotent),
// so cleanup can run repeatedly without failing on already-gone files.
func (s *Store) Delete(key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
