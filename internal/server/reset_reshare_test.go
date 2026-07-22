package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// These endpoints are behind requireAdmin. Reuse this package's existing
// admin-session helpers (newTestServer + loginCookie from admin_test.go, and
// the do()/postJSON() request helpers) rather than the newAdminTestServer /
// adminReq names sketched in the task brief, which this package doesn't
// define.

func TestRecoveryDekAndResetReshare(t *testing.T) {
	srv := newTestServer(t)
	cookie := loginCookie(t, srv)

	// Create a v2-shaped share (server is opaque; values need only be non-empty).
	v2 := `{"encrypted_data":{"v":2,"ciphertext":"Y3Q=","iv":"aXY=","salt":"c2E=","iv_p":"aXZw","wrap_pass":"d3A=","wrap_recov":{"epk":"ZQ==","iv":"aQ==","ct":"Yw=="}}}`
	rec, body := postJSON(t, srv, http.MethodPost, "/api/diff", v2, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	id := body["data"].(map[string]any)["id"].(string)

	// recovery-dek returns wrap_recov.
	code, env, _ := do(t, srv, http.MethodGet, "/api/admin/diff/"+id+"/recovery-dek", cookie, nil)
	if code != http.StatusOK {
		t.Fatalf("recovery-dek: %d %v", code, env)
	}
	wr := env["data"].(map[string]interface{})["wrap_recov"].(map[string]interface{})
	if wr["epk"] != "ZQ==" {
		t.Fatalf("wrong wrap_recov: %v", wr)
	}

	// Unauthenticated caller must still be rejected (requireAdmin stays intact).
	code, _, _ = do(t, srv, http.MethodGet, "/api/admin/diff/"+id+"/recovery-dek", "", nil)
	if code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d", code)
	}

	// reset-reshare swaps the passphrase wrap, keeps ciphertext+wrap_recov, revokes source.
	rbody := json.RawMessage(`{"salt":"bmV3cw==","iv_p":"bmV3aXZw","wrap_pass":"bmV3d3A="}`)
	code, env, _ = do(t, srv, http.MethodPost, "/api/admin/diff/"+id+"/reset-reshare", cookie, rbody)
	if code != http.StatusOK {
		t.Fatalf("reset-reshare: %d %v", code, env)
	}
	newID := env["data"].(map[string]interface{})["id"].(string)
	if newID == id {
		t.Fatalf("reset-reshare must mint a new id")
	}

	// New share: new wrap_pass, same ciphertext + wrap_recov.
	grec := httptest.NewRecorder()
	srv.ServeHTTP(grec, httptest.NewRequest(http.MethodGet, "/api/diff/"+newID, nil))
	var g map[string]any
	_ = json.Unmarshal(grec.Body.Bytes(), &g)
	ned := g["data"].(map[string]any)["encrypted_data"].(map[string]any)
	if ned["wrap_pass"] != "bmV3d3A=" || ned["ciphertext"] != "Y3Q=" {
		t.Fatalf("new share wraps wrong: %v", ned)
	}
	if ned["wrap_recov"].(map[string]any)["epk"] != "ZQ==" {
		t.Fatalf("wrap_recov must be preserved on the new share: %v", ned)
	}

	// Source is revoked (404).
	srec := httptest.NewRecorder()
	srv.ServeHTTP(srec, httptest.NewRequest(http.MethodGet, "/api/diff/"+id, nil))
	if srec.Code != http.StatusNotFound {
		t.Fatalf("source should be revoked: got %d", srec.Code)
	}
}

func TestResetReshareRejectsV1(t *testing.T) {
	srv := newTestServer(t)
	cookie := loginCookie(t, srv)

	v1 := `{"encrypted_data":{"ciphertext":"Y3Q=","iv":"aXY=","salt":"c2E="}}`
	_, body := postJSON(t, srv, http.MethodPost, "/api/diff", v1, "")
	id := body["data"].(map[string]any)["id"].(string)

	code, _, _ := do(t, srv, http.MethodGet, "/api/admin/diff/"+id+"/recovery-dek", cookie, nil)
	if code != http.StatusConflict {
		t.Fatalf("v1 recovery-dek should be 409, got %d", code)
	}

	code, _, _ = do(t, srv, http.MethodPost, "/api/admin/diff/"+id+"/reset-reshare", cookie,
		json.RawMessage(`{"salt":"a","iv_p":"b","wrap_pass":"c"}`))
	if code != http.StatusConflict {
		t.Fatalf("v1 reset-reshare should be 409, got %d", code)
	}
}
