package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/siygle/agentgate/internal/blobstore"
	"github.com/siygle/agentgate/internal/db"
	"github.com/siygle/agentgate/internal/id"
)

// uploadSlack is headroom above maxUploadBytes for JSON envelope overhead so the
// explicit size check (which yields a precise 413 message) runs before the hard
// MaxBytesReader ceiling trips.
const uploadSlack = 64 << 10

// decodeCreateBody reads a create/replace JSON body under a hard size ceiling,
// returning ok=false (after writing the response) on malformed or oversized
// input so callers can simply return.
func (s *Server) decodeCreateBody(w http.ResponseWriter, r *http.Request, req *createRequest) bool {
	r.Body = http.MaxBytesReader(w, r.Body, s.maxUploadBytes+uploadSlack)
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			s.writeTooLarge(w)
			return false
		}
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return false
	}
	return true
}

// encodeAndCheckSize marshals encrypted_data and enforces the per-share size
// limit, writing a 413 (and returning ok=false) when the blob is too large.
func (s *Server) encodeAndCheckSize(w http.ResponseWriter, req *createRequest) (string, bool) {
	encJSON, err := json.Marshal(req.EncryptedData)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return "", false
	}
	if int64(len(encJSON)) > s.maxUploadBytes {
		s.writeTooLarge(w)
		return "", false
	}
	return string(encJSON), true
}

func (s *Server) writeTooLarge(w http.ResponseWriter) {
	writeJSON(w, http.StatusRequestEntityTooLarge, apiResponse{
		Success: false,
		Error: fmt.Sprintf(
			"encrypted payload exceeds the %d byte limit; set AGENTGATE_MAX_UPLOAD_BYTES (or a filesystem blob dir) to raise it",
			s.maxUploadBytes),
	})
}

const defaultExpiry = 7 * 24 * time.Hour

// sentinelNeverExpiry is the timestamp stored in expired_at for never-expires
// records. The actual expiry check uses the never_expires flag; this value
// only exists because the column is NOT NULL.
var sentinelNeverExpiry = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

// createRequest is the JSON body for both diff and file-bundle creation.
type createRequest struct {
	EncryptedData struct {
		Ciphertext string `json:"ciphertext"`
		IV         string `json:"iv"`
		Salt       string `json:"salt"`
	} `json:"encrypted_data"`
	ExpiresInSeconds int64 `json:"expires_in_seconds,omitempty"`
	NeverExpires     bool  `json:"never_expires,omitempty"`
}

// updateRequest is the JSON body for PATCH endpoints.
type updateRequest struct {
	NeverExpires *bool `json:"never_expires,omitempty"`
}

type apiResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

type createResponseData struct {
	PreviewURL string `json:"preview_url"`
	ManageURL  string `json:"manage_url"`
	ID         string `json:"id"`
	OwnerToken string `json:"owner_token"`
}

type updateResponseData struct {
	ID           string `json:"id"`
	NeverExpires bool   `json:"never_expires"`
	ExpiresAt    string `json:"expires_at,omitempty"`
}

// getResponseData is returned by GET /api/{diff,files}/{id}. EncryptedData is
// emitted as a nested JSON object (the stored ciphertext blob), not a string.
type getResponseData struct {
	EncryptedData json.RawMessage `json:"encrypted_data"`
	ExpiresAt     string          `json:"expires_at,omitempty"`
	NeverExpires  bool            `json:"never_expires"`
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
}

// handleGetDiff returns a diff share's ciphertext + expiry metadata.
func (s *Server) handleGetDiff(w http.ResponseWriter, r *http.Request) {
	s.handleGet(w, r, "diff")
}

// handleGetFiles returns a file bundle's ciphertext + expiry metadata.
func (s *Server) handleGetFiles(w http.ResponseWriter, r *http.Request) {
	s.handleGet(w, r, "files")
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request, kind string) {
	recordID := chi.URLParam(r, "id")

	var (
		encData      string
		blobKey      string
		expiredAt    time.Time
		neverExpires bool
		found        bool
	)

	switch kind {
	case "diff":
		d, err := db.GetDiff(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if d != nil {
			found = true
			encData = d.EncryptedData
			blobKey = d.BlobKey
			expiredAt = d.ExpiredAt
			neverExpires = d.NeverExpires
		}
	case "files":
		fb, err := db.GetFileBundle(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if fb != nil {
			found = true
			encData = fb.EncryptedData
			blobKey = fb.BlobKey
			expiredAt = fb.ExpiredAt
			neverExpires = fb.NeverExpires
		}
	}

	if !found || (!neverExpires && expiredAt.Before(time.Now().UTC())) {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}

	// A record with a blob_key stored its ciphertext on the filesystem; read it
	// back. A missing file is treated as not found; a disabled store on a record
	// that needs one is a misconfiguration (500), not a silent 404.
	if blobKey != "" {
		if !s.blobs.Enabled() {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "blob storage not configured for this record"})
			return
		}
		blob, err := s.blobs.Get(blobKey)
		if err != nil {
			if os.IsNotExist(err) {
				writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
			} else {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			}
			return
		}
		encData = blob
	}

	data := getResponseData{
		EncryptedData: json.RawMessage(encData),
		NeverExpires:  neverExpires,
		ID:            recordID,
		Kind:          kind,
	}
	if !neverExpires {
		data.ExpiresAt = expiredAt.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: data})
}

// handleCreateDiff creates an encrypted diff record.
func (s *Server) handleCreateDiff(w http.ResponseWriter, r *http.Request) {
	s.handleCreate(w, r, "diff")
}

// handleCreateFiles creates an encrypted file bundle record.
func (s *Server) handleCreateFiles(w http.ResponseWriter, r *http.Request) {
	s.handleCreate(w, r, "files")
}

// handleCreate is the shared body for both diff and file-bundle creation.
func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request, kind string) {
	var req createRequest
	if !s.decodeCreateBody(w, r, &req) {
		return
	}

	if req.EncryptedData.Ciphertext == "" || req.EncryptedData.IV == "" || req.EncryptedData.Salt == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{
			Success: false,
			Error:   "encrypted_data must include non-empty ciphertext, iv, and salt",
		})
		return
	}

	encJSONStr, ok := s.encodeAndCheckSize(w, &req)
	if !ok {
		return
	}

	newID := id.Generate()

	// Decide storage: filesystem blob (encrypted_data empty) or inline in the DB.
	inlineData := encJSONStr
	blobKey := ""
	if s.blobs.Enabled() {
		blobKey = blobstore.Key(kind, newID)
		if err := s.blobs.Put(blobKey, encJSONStr); err != nil {
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
		writeJSON(w, http.StatusInternalServerError, apiResponse{
			Success: false,
			Error:   "internal server error",
		})
		return
	}

	var pathPrefix string
	var createErr error
	switch kind {
	case "diff":
		createErr = db.CreateDiff(s.db, newID, inlineData, blobKey, expiry, req.NeverExpires, ownerHash)
		pathPrefix = "/p/"
	case "files":
		createErr = db.CreateFileBundle(s.db, newID, inlineData, blobKey, expiry, req.NeverExpires, ownerHash)
		pathPrefix = "/f/"
	}
	if createErr != nil {
		// Roll back the orphaned blob so the two stores stay in sync.
		if blobKey != "" {
			_ = s.blobs.Delete(blobKey)
		}
		writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
		return
	}

	previewURL := s.baseURL + pathPrefix + newID
	writeJSON(w, http.StatusCreated, apiResponse{
		Success: true,
		Data: createResponseData{
			PreviewURL: previewURL,
			ManageURL:  previewURL + "#owner=" + ownerToken,
			ID:         newID,
			OwnerToken: ownerToken,
		},
	})
}

// handleUpdateDiff toggles never_expires (and other future fields) on a diff
// record, authenticated by the owner token in the Authorization header.
func (s *Server) handleUpdateDiff(w http.ResponseWriter, r *http.Request) {
	s.handleUpdate(w, r, "diff")
}

// handleUpdateFiles toggles never_expires on a file bundle record.
func (s *Server) handleUpdateFiles(w http.ResponseWriter, r *http.Request) {
	s.handleUpdate(w, r, "files")
}

func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request, kind string) {
	recordID := chi.URLParam(r, "id")
	if recordID == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "id required"})
		return
	}

	token := extractBearerToken(r.Header.Get("Authorization"))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "missing bearer token"})
		return
	}

	var req updateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "invalid JSON body"})
		return
	}
	if req.NeverExpires == nil {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "never_expires required"})
		return
	}

	var storedHash string
	var currentExpiry time.Time
	var found bool

	switch kind {
	case "diff":
		d, err := db.GetDiff(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if d != nil {
			found = true
			currentExpiry = d.ExpiredAt
			if d.OwnerTokenHash.Valid {
				storedHash = d.OwnerTokenHash.String
			}
		}
	case "files":
		fb, err := db.GetFileBundle(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if fb != nil {
			found = true
			currentExpiry = fb.ExpiredAt
			if fb.OwnerTokenHash.Valid {
				storedHash = fb.OwnerTokenHash.String
			}
		}
	}

	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}

	if storedHash == "" || !verifyOwnerToken(token, storedHash) {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "invalid token"})
		return
	}

	// If turning expiry back on and the original deadline is in the past,
	// reset to now + defaultExpiry so the share doesn't immediately disappear.
	var newExpiry *time.Time
	if !*req.NeverExpires {
		now := time.Now().UTC()
		if currentExpiry.Before(now) || currentExpiry.Equal(sentinelNeverExpiry) {
			reset := now.Add(defaultExpiry)
			newExpiry = &reset
		}
	}

	switch kind {
	case "diff":
		if err := db.SetDiffNeverExpires(s.db, recordID, *req.NeverExpires, newExpiry); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
	case "files":
		if err := db.SetFileBundleNeverExpires(s.db, recordID, *req.NeverExpires, newExpiry); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
	}

	respData := updateResponseData{
		ID:           recordID,
		NeverExpires: *req.NeverExpires,
	}
	if !*req.NeverExpires {
		effectiveExpiry := currentExpiry
		if newExpiry != nil {
			effectiveExpiry = *newExpiry
		}
		respData.ExpiresAt = effectiveExpiry.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: respData})
}

// handleReplaceDiff overwrites a diff record's ciphertext (in-place re-key).
func (s *Server) handleReplaceDiff(w http.ResponseWriter, r *http.Request) {
	s.handleReplace(w, r, "diff")
}

// handleReplaceFiles overwrites a file bundle's ciphertext (in-place re-key).
func (s *Server) handleReplaceFiles(w http.ResponseWriter, r *http.Request) {
	s.handleReplace(w, r, "files")
}

// handleReplace overwrites the encrypted blob of an existing share, keeping the
// same id, links, expiry, and owner token. Authenticated by the owner token in
// the Authorization header. This backs "reset passphrase": the client decrypts
// with the old passphrase, re-encrypts with a new one, and PUTs the new blob.
func (s *Server) handleReplace(w http.ResponseWriter, r *http.Request, kind string) {
	recordID := chi.URLParam(r, "id")
	if recordID == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{Success: false, Error: "id required"})
		return
	}

	token := extractBearerToken(r.Header.Get("Authorization"))
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "missing bearer token"})
		return
	}

	var req createRequest
	if !s.decodeCreateBody(w, r, &req) {
		return
	}
	if req.EncryptedData.Ciphertext == "" || req.EncryptedData.IV == "" || req.EncryptedData.Salt == "" {
		writeJSON(w, http.StatusBadRequest, apiResponse{
			Success: false,
			Error:   "encrypted_data must include non-empty ciphertext, iv, and salt",
		})
		return
	}

	var storedHash string
	var blobKey string
	var found bool
	switch kind {
	case "diff":
		d, err := db.GetDiff(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if d != nil {
			found = true
			blobKey = d.BlobKey
			if d.OwnerTokenHash.Valid {
				storedHash = d.OwnerTokenHash.String
			}
		}
	case "files":
		fb, err := db.GetFileBundle(s.db, recordID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
		if fb != nil {
			found = true
			blobKey = fb.BlobKey
			if fb.OwnerTokenHash.Valid {
				storedHash = fb.OwnerTokenHash.String
			}
		}
	}

	if !found {
		writeJSON(w, http.StatusNotFound, apiResponse{Success: false, Error: "not found"})
		return
	}
	if storedHash == "" || !verifyOwnerToken(token, storedHash) {
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "invalid token"})
		return
	}

	encJSON, ok := s.encodeAndCheckSize(w, &req)
	if !ok {
		return
	}

	// Re-key writes to wherever the record already lives: overwrite the
	// filesystem blob in place when it has one, else update the DB column.
	if blobKey != "" {
		if !s.blobs.Enabled() {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "blob storage not configured for this record"})
			return
		}
		if err := s.blobs.Put(blobKey, encJSON); err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
			return
		}
	} else {
		switch kind {
		case "diff":
			if err := db.UpdateDiffEncryptedData(s.db, recordID, encJSON); err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
				return
			}
		case "files":
			if err := db.UpdateFileBundleEncryptedData(s.db, recordID, encJSON); err != nil {
				writeJSON(w, http.StatusInternalServerError, apiResponse{Success: false, Error: "internal server error"})
				return
			}
		}
	}

	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: map[string]string{"id": recordID}})
}

func resolveExpiry(expiresInSeconds int64) time.Duration {
	if expiresInSeconds <= 0 {
		return defaultExpiry
	}
	return time.Duration(expiresInSeconds) * time.Second
}

// generateOwnerToken returns (token, sha256HexHash, err). The token is a
// 32-byte URL-safe random string returned once to the caller; the hex hash is
// stored server-side.
func generateOwnerToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}

// verifyOwnerToken compares a presented token against a stored sha256 hex
// hash using a constant-time comparison.
func verifyOwnerToken(token, storedHash string) bool {
	if token == "" || storedHash == "" {
		return false
	}
	sum := sha256.Sum256([]byte(token))
	got := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(storedHash)) == 1
}

// extractBearerToken parses an Authorization header of the form
// "Bearer <token>" (case-insensitive on the scheme) and returns the token.
func extractBearerToken(header string) string {
	if header == "" {
		return ""
	}
	parts := strings.SplitN(strings.TrimSpace(header), " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// writeJSON encodes v as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
