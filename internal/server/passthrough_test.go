package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// postJSON issues a JSON request against srv and returns the raw response
// recorder plus the decoded envelope body.
func postJSON(t *testing.T, srv http.Handler, method, path, body, bearer string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return rec, parsed
}

func TestCreatePreservesExtraEncryptedDataFields(t *testing.T) {
	srv := newTestServer(t) // helper: construct Server like the other tests do
	v2 := `{"encrypted_data":{"v":2,"ciphertext":"Y3Q=","iv":"aXY=","salt":"c2E=","iv_p":"aXZw","wrap_pass":"d3A=","wrap_recov":{"epk":"ZQ==","iv":"aQ==","ct":"Yw=="}}}`
	rec, body := postJSON(t, srv, http.MethodPost, "/api/files", v2, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, body %s", rec.Code, rec.Body.String())
	}
	id := body["data"].(map[string]any)["id"].(string)

	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/files/"+id, nil))
	var got map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &got); err != nil {
		t.Fatalf("get parse: %v", err)
	}
	ed := got["data"].(map[string]any)["encrypted_data"].(map[string]any)
	if ed["wrap_pass"] != "d3A=" || ed["v"].(float64) != 2 {
		t.Fatalf("v2 fields not preserved: %v", ed)
	}
	if _, ok := ed["wrap_recov"].(map[string]any); !ok {
		t.Fatalf("wrap_recov not preserved: %v", ed)
	}
}

func TestCreateStillRejectsMissingCoreFields(t *testing.T) {
	srv := newTestServer(t)
	rec, _ := postJSON(t, srv, http.MethodPost, "/api/files",
		`{"encrypted_data":{"ciphertext":"","iv":"x","salt":"y"}}`, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// TestReplacePreservesExtraEncryptedDataFields covers the PUT/replace path:
// a v1 share re-keyed with a v2 envelope payload must round-trip the extra
// fields verbatim, and the replace validation must still reject missing core
// fields.
func TestReplacePreservesExtraEncryptedDataFields(t *testing.T) {
	srv := newTestServer(t)
	v1 := `{"encrypted_data":{"ciphertext":"Y3Qx","iv":"aXYx","salt":"c2Ex"}}`
	rec, body := postJSON(t, srv, http.MethodPost, "/api/files", v1, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, body %s", rec.Code, rec.Body.String())
	}
	data := body["data"].(map[string]any)
	id := data["id"].(string)
	ownerToken := data["owner_token"].(string)

	v2 := `{"encrypted_data":{"v":2,"ciphertext":"Y3Qy","iv":"aXYy","salt":"c2Ey","iv_p":"aXZw","wrap_pass":"d3Ay","wrap_recov":{"epk":"ZQ==","iv":"aQ==","ct":"Yw=="}}}`
	recPut, putBody := postJSON(t, srv, http.MethodPut, "/api/files/"+id, v2, ownerToken)
	if recPut.Code != http.StatusOK {
		t.Fatalf("replace: got %d, body %s", recPut.Code, recPut.Body.String())
	}
	_ = putBody

	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/api/files/"+id, nil))
	var got map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &got); err != nil {
		t.Fatalf("get parse: %v", err)
	}
	ed := got["data"].(map[string]any)["encrypted_data"].(map[string]any)
	if ed["wrap_pass"] != "d3Ay" || ed["v"].(float64) != 2 {
		t.Fatalf("v2 fields not preserved after replace: %v", ed)
	}
	if _, ok := ed["wrap_recov"].(map[string]any); !ok {
		t.Fatalf("wrap_recov not preserved after replace: %v", ed)
	}

	recBad, _ := postJSON(t, srv, http.MethodPut, "/api/files/"+id,
		`{"encrypted_data":{"ciphertext":"","iv":"x","salt":"y"}}`, ownerToken)
	if recBad.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for replace with missing core fields, got %d", recBad.Code)
	}
}
