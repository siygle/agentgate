package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/siygle/agentgate/internal/blobstore"
	"github.com/siygle/agentgate/internal/db"
	"github.com/siygle/agentgate/internal/id"
)

// ---------------------------------------------------------------------------
// Auth: session probe, login, logout
// ---------------------------------------------------------------------------

// sessionInfo is the payload of GET /api/admin/session — a public status probe
// the dashboard uses to decide between the login card and the shares table.
type sessionInfo struct {
	Authenticated bool     `json:"authenticated"`
	Method        string   `json:"method,omitempty"`
	Exp           int64    `json:"exp,omitempty"`
	Enabled       bool     `json:"enabled"`
	Methods       []string `json:"methods"`
}

// handleAdminSession reports whether the caller is authenticated and which
// login methods are enabled. Public (not behind requireAdmin) so the login card
// can render the right tabs; it only reveals which auth methods are configured.
func (s *Server) handleAdminSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	info := sessionInfo{Enabled: s.admin != nil, Methods: []string{}}
	if s.admin == nil {
		writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: info})
		return
	}
	info.Methods = s.admin.methods()
	if method, ok := s.authenticateAdmin(r); ok {
		info.Authenticated = true
		info.Method = method
		if c, err := r.Cookie(adminCookieName); err == nil {
			if claims, ok := verifySession(s.admin.secret, c.Value); ok {
				info.Exp = claims.Exp
			}
		}
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: info})
}

// handleAdminLogout clears the session cookie.
func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	secure := s.admin != nil && s.admin.secureCookies
	clearSessionCookie(w, secure)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]bool{"ok": true}})
}

type ownerKeyLoginRequest struct {
	Key string `json:"key"`
}

// handleOwnerKeyLogin authenticates with the configured owner key. It compares
// the SHA-256 hex of the presented key against the stored hash in constant time
// (fixed length, so no length leak), rate-limits per client IP, and issues a
// session cookie on success.
func (s *Server) handleOwnerKeyLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.admin == nil || s.admin.ownerKeyHash == "" {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "owner-key login disabled"})
		return
	}
	if !s.checkOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Error: "bad origin"})
		return
	}
	if s.admin.limiter != nil && !s.admin.limiter.allow(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, apiResponse{Success: false, Error: "too many attempts, try again later"})
		return
	}

	var req ownerKeyLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return
	}
	if req.Key == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "key required"})
		return
	}

	sum := sha256.Sum256([]byte(req.Key))
	got := hex.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(got), []byte(s.admin.ownerKeyHash)) != 1 {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "invalid key"})
		return
	}

	tok := newSessionToken(s.admin.secret, authMethodOwnerKey, s.admin.ttl)
	setSessionCookie(w, tok, s.admin.ttl, s.admin.secureCookies)
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]string{"method": authMethodOwnerKey}})
}

// ---------------------------------------------------------------------------
// Shares: list, keep-forever, revoke, delete, re-share
// ---------------------------------------------------------------------------

type shareListItem struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	CreatedAt    string `json:"created_at"`
	ExpiredAt    string `json:"expired_at,omitempty"`
	NeverExpires bool   `json:"never_expires"`
	Storage      string `json:"storage"`
	ByteSize     *int64 `json:"byte_size"`
	Status       string `json:"status"`
}

type shareListResponse struct {
	Items  []shareListItem `json:"items"`
	Total  int             `json:"total"`
	Limit  int             `json:"limit"`
	Offset int             `json:"offset"`
}

// handleAdminListShares returns every share (diffs + file bundles) with
// metadata only — no ciphertext. Timestamps are normalized to RFC3339.
func (s *Server) handleAdminListShares(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	limit := clampInt(atoiDefault(q.Get("limit"), 50), 1, 200)
	offset := atoiDefault(q.Get("offset"), 0)
	if offset < 0 {
		offset = 0
	}

	summaries, total, err := db.ListAllShares(s.db, limit, offset, q.Get("sort"), q.Get("order"), q.Get("status"), q.Get("kind"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	now := time.Now().UTC()
	items := make([]shareListItem, 0, len(summaries))
	for _, sm := range summaries {
		it := shareListItem{
			ID:           sm.ID,
			Kind:         sm.Kind,
			CreatedAt:    sm.CreatedAt.UTC().Format(time.RFC3339),
			NeverExpires: sm.NeverExpires,
		}
		if sm.HasBlob {
			it.Storage = "blob"
		} else {
			it.Storage = "inline"
			if sm.ByteSize.Valid {
				v := sm.ByteSize.Int64
				it.ByteSize = &v
			}
		}
		if sm.NeverExpires {
			it.Status = "active"
		} else {
			it.ExpiredAt = sm.ExpiredAt.UTC().Format(time.RFC3339)
			if sm.ExpiredAt.After(now) {
				it.Status = "active"
			} else {
				it.Status = "expired"
			}
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: shareListResponse{
		Items: items, Total: total, Limit: limit, Offset: offset,
	}})
}

// handleAdminKeepForever toggles never_expires on a share (admin-authed, no
// per-share owner token). Mirrors handleUpdate's "reset expiry if past-due"
// rule when turning expiry back on.
func (s *Server) handleAdminKeepForever(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind := chi.URLParam(r, "kind")
	if _, _, ok := kindFromParam(kind); !ok {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if !s.checkOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Error: "bad origin"})
		return
	}
	recordID := chi.URLParam(r, "id")

	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return
	}
	if req.NeverExpires == nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "never_expires required"})
		return
	}

	_, _, currentExpiry, _, found, err := s.loadShare(kind, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}

	var newExpiry *time.Time
	if !*req.NeverExpires {
		now := time.Now().UTC()
		if currentExpiry.Before(now) || currentExpiry.Equal(sentinelNeverExpiry) {
			reset := now.Add(defaultExpiry)
			newExpiry = &reset
		}
	}
	if err := s.setNeverExpires(kind, recordID, *req.NeverExpires, newExpiry); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	resp := updateResponseData{ID: recordID, NeverExpires: *req.NeverExpires}
	if !*req.NeverExpires {
		eff := currentExpiry
		if newExpiry != nil {
			eff = *newExpiry
		}
		resp.ExpiresAt = eff.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: resp})
}

// handleAdminRevoke makes a share immediately inaccessible by setting
// never_expires=0 and expired_at=now. The existing expiry check then 404s the
// GET immediately; the cleanup sweeper hard-deletes it (and its blob) later.
func (s *Server) handleAdminRevoke(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind := chi.URLParam(r, "kind")
	if _, _, ok := kindFromParam(kind); !ok {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if !s.checkOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Error: "bad origin"})
		return
	}
	recordID := chi.URLParam(r, "id")

	_, _, _, _, found, err := s.loadShare(kind, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}

	now := time.Now().UTC()
	if err := s.setNeverExpires(kind, recordID, false, &now); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]string{
		"id": recordID, "kind": kind, "status": "expired",
	}})
}

// handleAdminDelete hard-deletes a share now and unlinks its filesystem blob.
func (s *Server) handleAdminDelete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	kind := chi.URLParam(r, "kind")
	table, _, ok := kindFromParam(kind)
	if !ok {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if !s.checkOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiResponse{Success: false, Error: "bad origin"})
		return
	}
	recordID := chi.URLParam(r, "id")

	blobKey, found, err := db.DeleteShareByID(s.db, table, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if blobKey != "" && s.blobs.Enabled() {
		_ = s.blobs.Delete(blobKey) // best-effort, mirrors cleanup.sweep
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]interface{}{
		"id": recordID, "kind": kind, "deleted": true,
	}})
}

type reshareRequest struct {
	NeverExpires     bool  `json:"never_expires,omitempty"`
	ExpiresInSeconds int64 `json:"expires_in_seconds,omitempty"`
}

// handleAdminReshare issues a new access link for the same content: it copies
// the stored ciphertext/blob to a fresh id with a new owner token, preserving
// zero-knowledge (the passphrase is unchanged). The source record is untouched.
func (s *Server) handleAdminReshare(w http.ResponseWriter, r *http.Request) {
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

	enc, blobKey, _, _, found, err := s.loadShare(kind, recordID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}
	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}

	// Read the source ciphertext from wherever it lives.
	srcData := enc
	if blobKey != "" {
		if !s.blobs.Enabled() {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "blob storage not configured for this record"})
			return
		}
		data, gerr := s.blobs.Get(blobKey)
		if gerr != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		srcData = data
	}

	// Optional body controls the new record's expiry (defaults to fresh 7d TTL).
	var req reshareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return
	}

	newID := id.Generate()
	ownerToken, ownerHash, err := generateOwnerToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	var expiry time.Time
	if req.NeverExpires {
		expiry = sentinelNeverExpiry
	} else {
		expiry = time.Now().Add(resolveExpiry(req.ExpiresInSeconds))
	}

	// New record follows the current storage mode (blob if the source used one).
	inlineData := srcData
	newBlobKey := ""
	if blobKey != "" {
		newBlobKey = blobstore.Key(kind, newID)
		if cerr := s.blobs.Copy(blobKey, newBlobKey); cerr != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		inlineData = ""
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
			_ = s.blobs.Delete(newBlobKey) // roll back the copied blob
		}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// kindFromParam validates the {kind} path segment and maps it to its table and
// preview path prefix.
func kindFromParam(kind string) (table, prefix string, ok bool) {
	switch kind {
	case "diff":
		return "diffs", "/p/", true
	case "files":
		return "file_bundles", "/f/", true
	}
	return "", "", false
}

// loadShare fetches a record's fields by kind. found=false when absent.
func (s *Server) loadShare(kind, recordID string) (enc, blobKey string, expiry time.Time, neverExpires, found bool, err error) {
	switch kind {
	case "diff":
		d, e := db.GetDiff(s.db, recordID)
		if e != nil {
			return "", "", time.Time{}, false, false, e
		}
		if d != nil {
			return d.EncryptedData, d.BlobKey, d.ExpiredAt, d.NeverExpires, true, nil
		}
	case "files":
		fb, e := db.GetFileBundle(s.db, recordID)
		if e != nil {
			return "", "", time.Time{}, false, false, e
		}
		if fb != nil {
			return fb.EncryptedData, fb.BlobKey, fb.ExpiredAt, fb.NeverExpires, true, nil
		}
	}
	return "", "", time.Time{}, false, false, nil
}

func (s *Server) setNeverExpires(kind, recordID string, neverExpires bool, newExpiry *time.Time) error {
	switch kind {
	case "diff":
		return db.SetDiffNeverExpires(s.db, recordID, neverExpires, newExpiry)
	case "files":
		return db.SetFileBundleNeverExpires(s.db, recordID, neverExpires, newExpiry)
	}
	return nil
}

// clientIP extracts the client IP from RemoteAddr (normalized by RealIP).
func clientIP(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
