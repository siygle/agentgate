package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/siygle/agentgate/internal/db"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	dbc, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { dbc.Close() })
	cfg := AdminConfig{SessionSecret: "test-session-secret", OwnerKey: "hunter2"}
	return New(dbc, "http://localhost:8080", fstest.MapFS{}, nil, cfg)
}

// do issues a request against the server and returns status + decoded envelope.
func do(t *testing.T, srv *Server, method, path, cookie string, body interface{}) (int, map[string]interface{}, []*http.Cookie) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rdr)
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	var env map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env, rec.Result().Cookies()
}

// createShare uses the public API to insert a share and returns its id.
func createShare(t *testing.T, srv *Server, kind string) string {
	t.Helper()
	path := "/api/" + map[string]string{"diff": "diff", "files": "files"}[kind]
	body := map[string]interface{}{
		"encrypted_data": map[string]string{"ciphertext": "ct-" + kind, "iv": "iv", "salt": "salt"},
	}
	code, env, _ := do(t, srv, http.MethodPost, path, "", body)
	if code != http.StatusCreated {
		t.Fatalf("create %s: status %d env %v", kind, code, env)
	}
	data := env["data"].(map[string]interface{})
	return data["id"].(string)
}

func loginCookie(t *testing.T, srv *Server) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/login/owner-key", strings.NewReader(`{"key":"hunter2"}`))
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: status %d body %s", rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == adminCookieName {
			return adminCookieName + "=" + c.Value
		}
	}
	t.Fatal("login did not set session cookie")
	return ""
}

func TestAdminSessionProbe(t *testing.T) {
	srv := newTestServer(t)
	code, env, _ := do(t, srv, http.MethodGet, "/api/admin/session", "", nil)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	data := env["data"].(map[string]interface{})
	if data["authenticated"].(bool) {
		t.Fatal("should not be authenticated without a cookie")
	}
	if !data["enabled"].(bool) {
		t.Fatal("admin should be enabled")
	}
	methods := data["methods"].([]interface{})
	if len(methods) != 1 || methods[0] != "owner-key" {
		t.Fatalf("expected [owner-key], got %v", methods)
	}
}

func TestAdminRequiresAuth(t *testing.T) {
	srv := newTestServer(t)
	code, _, _ := do(t, srv, http.MethodGet, "/api/admin/shares", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d", code)
	}
}

func TestAdminWrongKey(t *testing.T) {
	srv := newTestServer(t)
	code, _, _ := do(t, srv, http.MethodPost, "/api/admin/login/owner-key", "", map[string]string{"key": "wrong"})
	if code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong key, got %d", code)
	}
}

func TestAdminListAndActions(t *testing.T) {
	srv := newTestServer(t)
	cookie := loginCookie(t, srv)
	diffID := createShare(t, srv, "diff")
	filesID := createShare(t, srv, "files")

	// List shows both, with no ciphertext leaked.
	code, env, _ := do(t, srv, http.MethodGet, "/api/admin/shares", cookie, nil)
	if code != http.StatusOK {
		t.Fatalf("list status %d", code)
	}
	raw, _ := json.Marshal(env)
	if strings.Contains(string(raw), "ct-diff") || strings.Contains(string(raw), "ct-files") {
		t.Fatal("list leaked ciphertext")
	}
	data := env["data"].(map[string]interface{})
	if int(data["total"].(float64)) != 2 {
		t.Fatalf("expected total 2, got %v", data["total"])
	}
	items := data["items"].([]interface{})
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	for _, it := range items {
		m := it.(map[string]interface{})
		if m["status"] != "active" {
			t.Fatalf("new share should be active, got %v", m["status"])
		}
	}

	// Keep-forever the diff.
	code, env, _ = do(t, srv, http.MethodPatch, "/api/admin/diff/"+diffID, cookie, map[string]bool{"never_expires": true})
	if code != http.StatusOK {
		t.Fatalf("keep-forever status %d env %v", code, env)
	}

	// Revoke the files bundle -> its GET should 404, but it stays in the list as expired.
	code, _, _ = do(t, srv, http.MethodPost, "/api/admin/files/"+filesID+"/revoke", cookie, nil)
	if code != http.StatusOK {
		t.Fatalf("revoke status %d", code)
	}
	code, _, _ = do(t, srv, http.MethodGet, "/api/files/"+filesID, "", nil)
	if code != http.StatusNotFound {
		t.Fatalf("revoked share GET should be 404, got %d", code)
	}

	// Re-share the diff -> new id, GET returns the same ciphertext.
	code, env, _ = do(t, srv, http.MethodPost, "/api/admin/diff/"+diffID+"/reshare", cookie, nil)
	if code != http.StatusOK {
		t.Fatalf("reshare status %d env %v", code, env)
	}
	newID := env["data"].(map[string]interface{})["id"].(string)
	if newID == diffID {
		t.Fatal("reshare should mint a new id")
	}
	code, env, _ = do(t, srv, http.MethodGet, "/api/diff/"+newID, "", nil)
	if code != http.StatusOK {
		t.Fatalf("reshared GET status %d", code)
	}
	ed := env["data"].(map[string]interface{})["encrypted_data"].(map[string]interface{})
	if ed["ciphertext"] != "ct-diff" {
		t.Fatalf("reshared ciphertext mismatch: %v", ed["ciphertext"])
	}

	// Delete the diff -> gone from GET.
	code, _, _ = do(t, srv, http.MethodDelete, "/api/admin/diff/"+diffID, cookie, nil)
	if code != http.StatusOK {
		t.Fatalf("delete status %d", code)
	}
	code, _, _ = do(t, srv, http.MethodGet, "/api/diff/"+diffID, "", nil)
	if code != http.StatusNotFound {
		t.Fatalf("deleted share GET should be 404, got %d", code)
	}

	// Unknown kind -> 404.
	code, _, _ = do(t, srv, http.MethodDelete, "/api/admin/bogus/x", cookie, nil)
	if code != http.StatusNotFound {
		t.Fatalf("bad kind should 404, got %d", code)
	}
}
