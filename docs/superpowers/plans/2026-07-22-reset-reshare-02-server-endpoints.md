# Reset & Re-share — Plan 2: Server passthrough + admin endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make both backends store `encrypted_data` verbatim (so v2 envelope fields survive) and add the two admin endpoints that drive owner reset & re-share: `GET .../recovery-dek` and `POST .../reset-reshare`.

**Architecture:** The server stays zero-knowledge — it treats `encrypted_data` as an opaque JSON object, validating only that `ciphertext`/`iv`/`salt` are present & non-empty. `reset-reshare` copies a source share's content verbatim, swaps in a new passphrase-wrap (fields supplied by the browser after it recovered the DEK offline), and revokes the source. Keep-DEK: the server never decrypts and never touches `ciphertext`/`iv`/`wrap_recov`.

**Tech Stack:** Go (`internal/server`, chi router, database/sql, `internal/blobstore`); TypeScript Worker (`worker/src`, Hono, D1 + optional R2); Node contract tests (`test/contract/run.mjs`).

## Global Constraints

- The server is content-agnostic: it MUST persist the entire `encrypted_data` object as received (all keys, including `v`, `iv_p`, `wrap_pass`, `wrap_recov`), not a reconstructed `{ciphertext,iv,salt}` subset. Validation is unchanged: 400 unless `ciphertext`, `iv`, `salt` are all present & non-empty.
- v1 shares (`{ciphertext,iv,salt}` only) must round-trip byte-identically — no regression to existing behavior or the existing contract tests.
- A share is "reset-capable" iff its stored `encrypted_data` contains a non-empty `wrap_recov`. Endpoints that require it return **409** otherwise.
- `reset-reshare` keeps `ciphertext`, `iv`, and `wrap_recov` from the source unchanged; it replaces only `salt`, `iv_p`, `wrap_pass` (from the request body) and issues a new id + new owner token, then revokes the source (sets `never_expires=0, expired_at=now`, matching `revoke`).
- Both backends implement identical behavior; `docs/api-contract.md` is the single source of truth and must be updated. Admin endpoints are same-origin, require an admin session, and Origin-check state-changing POSTs (return 403 on mismatch) — reuse the existing `requireAdmin`/`checkOrigin`.
- Response envelope: `{success:true,data:...}` / `{success:false,error:...}`. New-record success payload matches create: `{preview_url, manage_url, id, owner_token}`.

---

### Task 1: Go — opaque `encrypted_data` passthrough (create + PUT replace)

**Files:**
- Modify: `internal/server/handlers_api.go` (`createRequest` struct ~77-85; `encodeAndCheckSize` ~47-58; create validation ~225; the PUT/replace handler + its validation ~445 and its store call ~513)
- Test: `internal/server/passthrough_test.go`

**Interfaces:**
- Produces: `func validateEncryptedData(raw json.RawMessage) bool` — true iff the JSON object has non-empty string `ciphertext`, `iv`, `salt`.
- `createRequest.EncryptedData` becomes `json.RawMessage` (opaque). `encodeAndCheckSize` marshals it verbatim.

- [ ] **Step 1: Write the failing test**

```go
// internal/server/passthrough_test.go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestServer spins up a Server backed by an in-memory SQLite DB and inline
// storage. Follow the setup already used by the other _test.go files in this
// package (see admin_test.go / handlers_*_test.go for the exact constructor
// args to New(...)); if a shared test helper exists, reuse it instead of
// duplicating setup here.
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
```

If no `newTestServer` helper exists in the package, add a minimal one in this test file mirroring the construction in the existing `_test.go` files (in-memory DB via `db.Open`, `blobstore.New("")`, an empty `staticFS`, and an `AdminConfig{}`). Do not change production code to accommodate tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run TestCreatePreservesExtra -v`
Expected: FAIL — extra fields (`v`, `wrap_pass`, `wrap_recov`) are dropped because `createRequest.EncryptedData` is a typed 3-field struct.

- [ ] **Step 3: Write minimal implementation**

In `internal/server/handlers_api.go`:

1. Change the struct field:
```go
type createRequest struct {
	EncryptedData json.RawMessage `json:"encrypted_data"`
	ExpiresInSeconds int64        `json:"expires_in_seconds,omitempty"`
	NeverExpires     bool         `json:"never_expires,omitempty"`
}
```

2. Add the validator:
```go
// validateEncryptedData reports whether the opaque encrypted_data object has
// non-empty ciphertext, iv, and salt. Extra keys (v2 envelope fields) are
// allowed and preserved verbatim.
func validateEncryptedData(raw json.RawMessage) bool {
	var core struct {
		Ciphertext string `json:"ciphertext"`
		IV         string `json:"iv"`
		Salt       string `json:"salt"`
	}
	if err := json.Unmarshal(raw, &core); err != nil {
		return false
	}
	return core.Ciphertext != "" && core.IV != "" && core.Salt != ""
}
```

3. Replace the create validation (`~225`):
```go
	if !validateEncryptedData(req.EncryptedData) {
		writeJSON(w, http.StatusBadRequest, apiResponse{
			Success: false,
			Error:   "encrypted_data must include non-empty ciphertext, iv, and salt",
		})
		return
	}
```
`encodeAndCheckSize` already does `json.Marshal(req.EncryptedData)`; with a `json.RawMessage` this emits the bytes verbatim (passthrough) — no change needed there beyond it compiling.

4. The PUT/replace handler (around line 445) decodes into the same/typed shape and validates `ciphertext/iv/salt`. Read that handler; switch its request struct's `EncryptedData` to `json.RawMessage`, replace its validation with `validateEncryptedData(...)`, and ensure the value it passes to `UpdateDiffEncryptedData`/`UpdateFileBundleEncryptedData` (and the blob path) is the verbatim JSON string (`string(req.EncryptedData)` or the marshaled bytes). Do not alter the owner-token auth.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server/ -run 'TestCreatePreservesExtra|TestCreateStillRejects' -v && go test ./internal/server/ -count=1`
Expected: new tests PASS and the full package (existing api/admin tests) still PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/handlers_api.go internal/server/passthrough_test.go
git commit -m "feat(server): store encrypted_data verbatim (preserve v2 envelope fields)"
```

---

### Task 2: Worker — opaque `encrypted_data` passthrough (create + PUT replace)

**Files:**
- Modify: `worker/src/index.ts` (`CreateBody` ~97-101; `handleCreate` validation+store ~111-118; the PUT/replace handler and its validation)
- Test: covered by the contract test in Task 5 (Worker has no Go-style unit harness here).

**Interfaces:**
- `handleCreate` stores `JSON.stringify(ed)` (the whole object) after validating the three core fields.

- [ ] **Step 1: Update `CreateBody` to allow extra fields**

```ts
interface CreateBody {
  encrypted_data?: Record<string, unknown> & {
    ciphertext?: string;
    iv?: string;
    salt?: string;
  };
  expires_in_seconds?: number;
  never_expires?: boolean;
}
```

- [ ] **Step 2: Store the whole object verbatim**

In `handleCreate`, keep the validation but change the stored JSON (`index.ts:116`) from the reconstructed subset to the full object:
```ts
  const ed = body.encrypted_data;
  if (!ed || !ed.ciphertext || !ed.iv || !ed.salt) {
    return fail(c, "encrypted_data must include non-empty ciphertext, iv, and salt", 400);
  }
  const encJson = JSON.stringify(ed); // verbatim: preserves v2 fields (v, iv_p, wrap_pass, wrap_recov)
```

- [ ] **Step 3: Update the PUT/replace handler**

Find the PUT/replace route in `worker/src/index.ts` (it currently validates `ciphertext/iv/salt` and calls `replaceShareData`). Change it the same way: validate the three core fields, then persist `JSON.stringify(ed)` (the whole object) via `replaceShareData`. Do not change the owner-token auth.

- [ ] **Step 4: Typecheck / build**

Run: `cd worker && npm run build` (or `npx tsc --noEmit` — match whatever the repo uses; check `worker/package.json` scripts).
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): store encrypted_data verbatim (preserve v2 envelope fields)"
```

---

### Task 3: Go — `recovery-dek` + `reset-reshare` endpoints

**Files:**
- Modify: `internal/server/handlers_admin.go` (add two handlers + a small JSON helper), `internal/server/server.go` (register two routes ~109-113)
- Test: `internal/server/reset_reshare_test.go`

**Interfaces:**
- `GET /api/admin/{kind}/{id}/recovery-dek` → `200 {success,data:{v:2,wrap_recov:{...}}}`; `409` if not reset-capable; `404` unknown id.
- `POST /api/admin/{kind}/{id}/reset-reshare` body `{salt,iv_p,wrap_pass,expires_in_seconds?,never_expires?}` → create-shaped `200`; `409` not reset-capable; `400` bad body; `404` unknown id.

- [ ] **Step 1: Write the failing test**

```go
// internal/server/reset_reshare_test.go
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// These endpoints are behind requireAdmin. Use the same admin-session helper the
// existing admin_test.go uses to build an authenticated request (cookie or the
// test's login helper). Name it here as adminGet/adminPost mirroring that file.

func TestRecoveryDekAndResetReshare(t *testing.T) {
	srv, adminCookie := newAdminTestServer(t) // mirror admin_test.go's authed setup

	// Create a v2-shaped share (server is opaque; values need only be non-empty).
	v2 := `{"encrypted_data":{"v":2,"ciphertext":"Y3Q=","iv":"aXY=","salt":"c2E=","iv_p":"aXZw","wrap_pass":"d3A=","wrap_recov":{"epk":"ZQ==","iv":"aQ==","ct":"Yw=="}}}`
	rec, body := postJSON(t, srv, http.MethodPost, "/api/diff", v2, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	id := body["data"].(map[string]any)["id"].(string)

	// recovery-dek returns wrap_recov.
	rrec := adminReq(t, srv, http.MethodGet, "/api/admin/diff/"+id+"/recovery-dek", "", adminCookie)
	if rrec.Code != http.StatusOK {
		t.Fatalf("recovery-dek: %d %s", rrec.Code, rrec.Body.String())
	}
	var rdek map[string]any
	_ = json.Unmarshal(rrec.Body.Bytes(), &rdek)
	wr := rdek["data"].(map[string]any)["wrap_recov"].(map[string]any)
	if wr["epk"] != "ZQ==" {
		t.Fatalf("wrong wrap_recov: %v", wr)
	}

	// reset-reshare swaps the passphrase wrap, keeps ciphertext+wrap_recov, revokes source.
	rbody := `{"salt":"bmV3cw==","iv_p":"bmV3aXZw","wrap_pass":"bmV3d3A="}`
	prec := adminReq(t, srv, http.MethodPost, "/api/admin/diff/"+id+"/reset-reshare", rbody, adminCookie)
	if prec.Code != http.StatusOK {
		t.Fatalf("reset-reshare: %d %s", prec.Code, prec.Body.String())
	}
	var pr map[string]any
	_ = json.Unmarshal(prec.Body.Bytes(), &pr)
	newID := pr["data"].(map[string]any)["id"].(string)
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
	srv, adminCookie := newAdminTestServer(t)
	v1 := `{"encrypted_data":{"ciphertext":"Y3Q=","iv":"aXY=","salt":"c2E="}}`
	_, body := postJSON(t, srv, http.MethodPost, "/api/diff", v1, "")
	id := body["data"].(map[string]any)["id"].(string)
	rrec := adminReq(t, srv, http.MethodGet, "/api/admin/diff/"+id+"/recovery-dek", "", adminCookie)
	if rrec.Code != http.StatusConflict {
		t.Fatalf("v1 recovery-dek should be 409, got %d", rrec.Code)
	}
	prec := adminReq(t, srv, http.MethodPost, "/api/admin/diff/"+id+"/reset-reshare",
		`{"salt":"a","iv_p":"b","wrap_pass":"c"}`, adminCookie)
	if prec.Code != http.StatusConflict {
		t.Fatalf("v1 reset-reshare should be 409, got %d", prec.Code)
	}
}
```

Reuse whatever authenticated-admin request helper `admin_test.go` already defines; if it exposes something equivalent to `adminReq(t, srv, method, path, body, cookie)` and `newAdminTestServer(t)`, use those names, otherwise adapt these two helpers to the existing pattern (do not weaken auth — the endpoints must stay behind `requireAdmin`).

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/server/ -run 'TestRecoveryDek|TestResetReshareRejects' -v`
Expected: FAIL — routes/handlers not defined (404 from the router).

- [ ] **Step 3: Write minimal implementation**

Add to `internal/server/handlers_admin.go`:

```go
// loadEncryptedData returns a share's full encrypted_data JSON (from inline
// storage or the filesystem blob), or found=false when absent.
func (s *Server) loadEncryptedData(kind, recordID string) (encJSON string, found bool, err error) {
	enc, blobKey, _, _, ok, e := s.loadShare(kind, recordID)
	if e != nil || !ok {
		return "", ok, e
	}
	if blobKey != "" {
		data, ge := s.blobs.Get(blobKey)
		if ge != nil {
			return "", true, ge
		}
		return data, true, nil
	}
	return enc, true, nil
}

// handleAdminRecoveryDek returns the recovery-wrapped DEK (wrap_recov) so the
// operator can unwrap it offline. Safe to expose to an authenticated admin —
// useless without the offline recovery private key. 409 when the share has no
// recovery wrap (v1 or uploaded without a recovery key).
func (s *Server) handleAdminRecoveryDek(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind := chi.URLParam(r, "kind")
	if _, _, ok := kindFromParam(kind); !ok {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	recordID := chi.URLParam(r, "id")
	encJSON, found, err := s.loadEncryptedData(kind, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal([]byte(encJSON), &env); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	wrapRecov, ok := env["wrap_recov"]
	if !ok || len(wrapRecov) == 0 || string(wrapRecov) == "null" {
		writeJSON(w, http.StatusConflict, apiResponse{Success: false, Error: "share is not reset-capable (no recovery key)"})
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]any{
		"v": 2, "wrap_recov": wrapRecov,
	}})
}

type resetReshareRequest struct {
	Salt             string `json:"salt"`
	IVP              string `json:"iv_p"`
	WrapPass         string `json:"wrap_pass"`
	NeverExpires     bool   `json:"never_expires,omitempty"`
	ExpiresInSeconds int64  `json:"expires_in_seconds,omitempty"`
}

// handleAdminResetReshare mints a new share for the same content under a NEW
// passphrase wrap (supplied by the browser after it recovered the DEK offline),
// keeping ciphertext + wrap_recov, then revokes the source. The server never
// decrypts.
func (s *Server) handleAdminResetReshare(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind := chi.URLParam(r, "kind")
	_, prefix, ok := kindFromParam(kind)
	if !ok {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if !s.checkOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Error: "bad origin"})
		return
	}
	recordID := chi.URLParam(r, "id")

	var req resetReshareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return
	}
	if req.Salt == "" || req.IVP == "" || req.WrapPass == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "salt, iv_p, and wrap_pass are required"})
		return
	}

	encJSON, found, err := s.loadEncryptedData(kind, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal([]byte(encJSON), &env); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if wr, ok := env["wrap_recov"]; !ok || len(wr) == 0 || string(wr) == "null" {
		writeJSON(w, http.StatusConflict, apiResponse{Success: false, Error: "share is not reset-capable (no recovery key)"})
		return
	}
	// Swap ONLY the passphrase wrap; keep ciphertext, iv, wrap_recov, v.
	env["salt"], _ = json.Marshal(req.Salt)
	env["iv_p"], _ = json.Marshal(req.IVP)
	env["wrap_pass"], _ = json.Marshal(req.WrapPass)
	newEnc, err := json.Marshal(env)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	newID := id.Generate()
	inlineData := string(newEnc)
	newBlobKey := ""
	if s.blobs.Enabled() {
		newBlobKey = blobstore.Key(kind, newID)
		if perr := s.blobs.Put(newBlobKey, string(newEnc)); perr != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		inlineData = ""
	}

	var expiry time.Time
	if req.NeverExpires {
		expiry = sentinelNeverExpiry
	} else {
		expiry = time.Now().Add(resolveExpiry(req.ExpiresInSeconds))
	}
	ownerToken, ownerHash, err := generateOwnerToken()
	if err != nil {
		if newBlobKey != "" {
			_ = s.blobs.Delete(newBlobKey)
		}
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	var createErr error
	switch kind {
	case "diff":
		createErr = db.CreateDiff(s.db, newID, inlineData, newBlobKey, expiry, req.NeverExpires, ownerHash)
	case "files":
		createErr = db.CreateFileBundle(s.db, newID, inlineData, newBlobKey, expiry, req.NeverExpires, ownerHash)
	}
	if createErr != nil {
		if newBlobKey != "" {
			_ = s.blobs.Delete(newBlobKey)
		}
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	// Revoke the source (mirrors handleAdminRevoke).
	now := time.Now().UTC()
	if err := s.setNeverExpires(kind, recordID, false, &now); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	previewURL := s.baseURL + prefix + newID
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: createResponseData{
		PreviewURL: previewURL,
		ManageURL:  previewURL + "#owner=" + ownerToken,
		ID:         newID,
		OwnerToken: ownerToken,
	}})
}
```

Register the routes in `internal/server/server.go` inside the protected admin group (next to `reshare`/`revoke`, ~line 111-113):
```go
			r.Get("/api/admin/{kind}/{id}/recovery-dek", s.handleAdminRecoveryDek)
			r.Post("/api/admin/{kind}/{id}/reset-reshare", s.handleAdminResetReshare)
```
Ensure imports in `handlers_admin.go` include `blobstore` and `id` and `db` and `time` (they are already used elsewhere in the file — confirm, don't duplicate).

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/server/ -run 'TestRecoveryDek|TestResetReshare' -v && go test ./internal/server/ -count=1`
Expected: new tests PASS, full package PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/server/handlers_admin.go internal/server/server.go internal/server/reset_reshare_test.go
git commit -m "feat(server): admin recovery-dek + reset-reshare endpoints"
```

---

### Task 4: Worker — `recovery-dek` + `reset-reshare` endpoints

**Files:**
- Modify: `worker/src/admin.ts` (add two handlers + routes; reuse `ok`, `fail`, `checkOrigin`, `requireAdmin`, `kindParam`, `getShareCiphertext`, `createShare`, `generateOwnerToken`, `generateId`, `nowSeconds`, `NEVER_EXPIRES_AT`, `DEFAULT_TTL_SECONDS`, `setNeverExpires`)
- Test: contract test (Task 5).

- [ ] **Step 1: Add the handlers + routes**

In `worker/src/admin.ts`, mirror the Go behavior. `getShareCiphertext(env, kind, id)` returns the raw stored `encrypted_data` JSON (or null) regardless of expiry — use it for both endpoints.

```ts
// GET /api/admin/:kind/:id/recovery-dek — return wrap_recov for offline unwrap.
admin.get("/:kind/:id/recovery-dek", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  const id = c.req.param("id") ?? "";
  const text = await getShareCiphertext(c.env, kind, id);
  if (text === null) return fail(c, "not found", 404);
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(text);
  } catch {
    return fail(c, "internal server error", 500);
  }
  if (env.wrap_recov == null) {
    return fail(c, "share is not reset-capable (no recovery key)", 409);
  }
  return ok(c, { v: 2, wrap_recov: env.wrap_recov });
});

// POST /api/admin/:kind/:id/reset-reshare — new share, new passphrase wrap,
// keep ciphertext + wrap_recov, revoke source.
admin.post("/:kind/:id/reset-reshare", requireAdmin, async (c) => {
  const kind = kindParam(c);
  if (!kind) return fail(c, "not found", 404);
  if (!checkOrigin(c)) return fail(c, "bad origin", 403);
  const id = c.req.param("id") ?? "";

  let body: { salt?: string; iv_p?: string; wrap_pass?: string; never_expires?: boolean; expires_in_seconds?: number };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "invalid JSON body", 400);
  }
  if (!body.salt || !body.iv_p || !body.wrap_pass) {
    return fail(c, "salt, iv_p, and wrap_pass are required", 400);
  }

  const text = await getShareCiphertext(c.env, kind, id);
  if (text === null) return fail(c, "not found", 404);
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(text);
  } catch {
    return fail(c, "internal server error", 500);
  }
  if (env.wrap_recov == null) {
    return fail(c, "share is not reset-capable (no recovery key)", 409);
  }
  // Swap ONLY the passphrase wrap; keep ciphertext, iv, wrap_recov, v.
  env.salt = body.salt;
  env.iv_p = body.iv_p;
  env.wrap_pass = body.wrap_pass;

  const newId = generateId();
  const { token, hash } = await generateOwnerToken();
  const neverExpires = !!body.never_expires;
  const expiredAt = neverExpires
    ? NEVER_EXPIRES_AT
    : nowSeconds() + (body.expires_in_seconds && body.expires_in_seconds > 0 ? body.expires_in_seconds : DEFAULT_TTL_SECONDS);
  try {
    await createShare(c.env, kind, newId, JSON.stringify(env), expiredAt, neverExpires, hash);
  } catch {
    return fail(c, "internal server error", 500);
  }
  // Revoke the source (mirror the revoke handler: never_expires=0, expired_at=now).
  await setNeverExpires(c.env, kind, id, false, nowSeconds());

  const previewURL = c.env.BASE_URL + (kind === "diff" ? "/p/" : "/f/") + newId;
  return ok(c, {
    preview_url: previewURL,
    manage_url: previewURL + "#owner=" + token,
    id: newId,
    owner_token: token,
  });
});
```

Add any missing imports at the top of `admin.ts` (`getShareCiphertext`, `NEVER_EXPIRES_AT`, `DEFAULT_TTL_SECONDS`, `setNeverExpires`, `generateId` — several are already imported; confirm and add only the missing ones).

- [ ] **Step 2: Typecheck / build**

Run: `cd worker && npm run build` (or the repo's typecheck script).
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add worker/src/admin.ts
git commit -m "feat(worker): admin recovery-dek + reset-reshare endpoints"
```

---

### Task 5: Contract tests + API contract docs

**Files:**
- Modify: `test/contract/run.mjs` (add v2 passthrough + reset-reshare assertions)
- Modify: `docs/api-contract.md` (document v2 `encrypted_data` + the two new endpoints)

- [ ] **Step 1: Add contract assertions**

In `test/contract/run.mjs`, after the existing public-API section add a v2 passthrough check (no admin session needed):
```js
  // --- v2 envelope passthrough (server stores encrypted_data verbatim) ---
  const v2ed = {
    v: 2, ciphertext: "djJjdA==", iv: "djJpdg==", salt: "djJzYWx0",
    iv_p: "djJpdnA=", wrap_pass: "djJ3cA==",
    wrap_recov: { epk: "ZXBr", iv: "cml2", ct: "cmN0" },
  };
  r = await fetch(`${BASE}/api/files`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_data: v2ed }),
  });
  check("POST v2 envelope -> 201", r.status === 201, `got ${r.status}`);
  const v2id = (await r.json()).data?.id;
  r = await fetch(`${BASE}/api/files/${v2id}`);
  body = await r.json();
  check("v2 get preserves wrap_pass", body.data?.encrypted_data?.wrap_pass === v2ed.wrap_pass);
  check("v2 get preserves wrap_recov.epk", body.data?.encrypted_data?.wrap_recov?.epk === "ZXBr");
  check("v2 get preserves version", body.data?.encrypted_data?.v === 2);
```

Inside the `if (adminCookie)` block, after the existing reshare assertions, add:
```js
    // --- reset-reshare (v2) + recovery-dek ---
    const RCT = "cmVzZXQtY3Q=";
    const rr = await fetch(`${BASE}/api/diff`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypted_data: {
        v: 2, ciphertext: RCT, iv: "aXY=", salt: "c2E=",
        iv_p: "aXZw", wrap_pass: "d3A=", wrap_recov: { epk: "ZQ==", iv: "aQ==", ct: "Yw==" },
      } }),
    });
    const rsSrc = (await rr.json()).data?.id;

    r = await fetch(`${BASE}/api/admin/diff/${rsSrc}/recovery-dek`, { headers: H });
    body = await r.json();
    check("recovery-dek -> 200 wrap_recov", r.status === 200 && body.data?.wrap_recov?.epk === "ZQ==");

    r = await fetch(`${BASE}/api/admin/diff/${rsSrc}/reset-reshare`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ salt: "bmV3cw==", iv_p: "bmV3aXZw", wrap_pass: "bmV3d3A=" }),
    });
    body = await r.json();
    const rsNew = body.data?.id;
    check("reset-reshare -> 200 new id", r.status === 200 && !!rsNew && rsNew !== rsSrc);

    r = await fetch(`${BASE}/api/diff/${rsNew}`);
    body = await r.json();
    check("reset-reshare new share: new wrap_pass", body.data?.encrypted_data?.wrap_pass === "bmV3d3A=");
    check("reset-reshare new share: same ciphertext", body.data?.encrypted_data?.ciphertext === RCT);
    check("reset-reshare new share: wrap_recov preserved", body.data?.encrypted_data?.wrap_recov?.epk === "ZQ==");

    r = await fetch(`${BASE}/api/diff/${rsSrc}`);
    check("reset-reshare source revoked -> 404", r.status === 404, `got ${r.status}`);

    // v1 share is not reset-capable.
    const v1r = await fetch(`${BASE}/api/diff`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypted_data: { ciphertext: "djE=", iv: "aXY=", salt: "c2E=" } }),
    });
    const v1id = (await v1r.json()).data?.id;
    r = await fetch(`${BASE}/api/admin/diff/${v1id}/recovery-dek`, { headers: H });
    check("recovery-dek on v1 -> 409", r.status === 409, `got ${r.status}`);
    r = await fetch(`${BASE}/api/admin/diff/${v1id}/reset-reshare`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ salt: "a", iv_p: "b", wrap_pass: "c" }),
    });
    check("reset-reshare on v1 -> 409", r.status === 409, `got ${r.status}`);
```

- [ ] **Step 2: Run the contract test against the Go backend**

Start the Go server on a test port with an admin owner key, then run the contract test with the admin session enabled. Example:
```bash
AGENTGATE_SESSION_SECRET=testsecret AGENTGATE_OWNER_KEY=testkey \
  go run ./cmd/server --port 18080 --db /tmp/agentgate-contract.db &
sleep 1
ADMIN_OWNER_KEY=testkey node test/contract/run.mjs http://localhost:18080
kill %1
```
Expected: all checks pass (existing + new). Clean up the temp DB.

- [ ] **Step 3: Run the contract test against the Worker**

Start `wrangler dev` for the worker with the admin secrets and run the same contract test against it (match the repo's existing way of running the worker locally — check `worker/package.json` and any existing contract-run instructions). Expected: all checks pass identically.

If running `wrangler dev` is not feasible in this environment, note that in the report and ensure the Go run is green; flag the Worker run as needing manual verification.

- [ ] **Step 4: Update `docs/api-contract.md`**

Add: (a) a note under `POST /api/diff · POST /api/files` that `encrypted_data` is stored **verbatim** as an opaque object — `ciphertext`/`iv`/`salt` are required, any additional keys (the v2 envelope: `v`, `iv_p`, `wrap_pass`, `wrap_recov`) are preserved and returned by GET unchanged; (b) two new subsections under "Owner dashboard endpoints":

```markdown
### `GET /api/admin/{kind}/{id}/recovery-dek` (requires admin session)

Returns the recovery-wrapped DEK so the operator can unwrap it offline with the
recovery private key. `200 OK`: `{ "success": true, "data": { "v": 2,
"wrap_recov": { "epk", "iv", "ct" } } }`. `409` when the share has no recovery
wrap (v1, or uploaded without a recovery key). `404` unknown kind/id. Safe to
expose to an authenticated admin — useless without the offline private key.

### `POST /api/admin/{kind}/{id}/reset-reshare` (requires admin session)

Mints a new share for the same content under a NEW passphrase wrap and revokes
the source (old passphrase can no longer decrypt anything reachable). Body:
`{ "salt", "iv_p", "wrap_pass" }` (all required — the browser computes these
after recovering the DEK offline) plus optional `{ "never_expires",
"expires_in_seconds" }`. The server keeps `ciphertext`, `iv`, and `wrap_recov`
from the source unchanged. `200 OK`: create shape (`preview_url`, `manage_url`,
`id`, `owner_token`). `409` not reset-capable; `400` missing wrap fields; `404`
unknown kind/id. Origin-checked.
```

- [ ] **Step 5: Commit**

```bash
git add test/contract/run.mjs docs/api-contract.md
git commit -m "test(contract): v2 passthrough + reset-reshare; docs(api-contract): v2 + new admin endpoints"
```

---

## Self-Review

**Spec coverage:** §6 passthrough (Tasks 1, 2). §7 reset-reshare keep-DEK flow (Tasks 3, 4). §8 `recovery-dek` + `reset-reshare` endpoints + api-contract (Tasks 3, 4, 5). §9 reset-capability gating (409 in Tasks 3, 4, 5). Web/UI (§7 browser side) is Plan 3.

**Placeholder scan:** Test helpers reference existing per-package patterns (`newTestServer`/`newAdminTestServer`/`adminReq`) — the implementer must reuse or adapt the actual helpers in `internal/server/*_test.go`; this is called out explicitly, not left vague. All handler/route code is complete.

**Type consistency:** `validateEncryptedData(json.RawMessage) bool`, `loadEncryptedData(kind, id) (string, bool, error)`, `resetReshareRequest{Salt,IVP,WrapPass,...}`, and the `{salt,iv_p,wrap_pass}` body are consistent across Go/Worker/contract/docs. Endpoint paths, status codes (200/400/404/409/403), and the reset-capability rule (`wrap_recov` present) match across all five tasks.
