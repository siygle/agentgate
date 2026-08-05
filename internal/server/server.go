package server

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/siygle/agentgate/internal/blobstore"
)

// defaultMaxUploadBytes caps the stored encrypted blob per share on the
// self-host backend. SQLite has no small per-value limit (unlike Cloudflare
// D1's 2 MB), so this generous default mainly guards memory; override it with
// AGENTGATE_MAX_UPLOAD_BYTES when sharing larger bundles (e.g. with a blob dir).
const defaultMaxUploadBytes = 10 << 20 // 10 MB

const defaultSessionTTL = 12 * time.Hour

// Server holds dependencies and the HTTP router.
type Server struct {
	db             *sql.DB
	router         chi.Router
	staticFS       fs.FS
	baseURL        string
	maxUploadBytes int64
	blobs          *blobstore.Store // nil = inline storage (blobs in the DB)
	admin          *adminState      // nil = admin dashboard disabled
}

// New creates a Server with all routes registered. staticFS should be rooted at
// the directory whose contents are served under /static/ (it also holds the
// static HTML shells). blobs may be nil, meaning encrypted blobs are stored
// inline in the database; when non-nil they are written to the filesystem.
// adminCfg configures the owner dashboard; an empty SessionSecret disables it.
func New(db *sql.DB, baseURL string, staticFS fs.FS, blobs *blobstore.Store, adminCfg AdminConfig) *Server {
	s := &Server{
		db:             db,
		staticFS:       staticFS,
		baseURL:        baseURL,
		maxUploadBytes: resolveMaxUploadBytes(),
		blobs:          blobs,
		admin:          buildAdminState(adminCfg),
	}

	r := chi.NewRouter()

	// Base middleware applies to every route.
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Public surface: pages, static assets, and the share API. These keep the
	// permissive `*` CORS suitable for a shared tool.
	r.Group(func(r chi.Router) {
		r.Use(corsMiddleware)

		fileServer := http.FileServer(http.FS(staticFS))
		r.Handle("/static/*", http.StripPrefix("/static/", fileServer))

		// Pages (Plan B: static HTML shells; client JS fetches the ciphertext).
		r.Get("/", s.handleIndex)
		r.Get("/llms.txt", s.handleLLMsTxt)
		r.Get("/llms-full.txt", s.handleLLMsFullTxt)
		// /s/{id} is the route new shares use; the five kind-specific prefixes are
		// permanent aliases, because a --no-expiry link handed out years ago must keep
		// resolving. Every one of them serves the same shell, which picks a renderer
		// from the decrypted payload.
		r.Get("/s/{id}", s.handleViewShare)
		r.Get("/p/{id}", s.handleViewShare)
		r.Get("/f/{id}", s.handleViewShare)
		r.Get("/app/{id}", s.handleViewShare)
		r.Get("/plan/{id}", s.handleViewShare)
		r.Get("/d/{id}", s.handleViewShare)
		// Some chat/mobile clients probe shared URLs with HEAD before opening them.
		r.Head("/s/{id}", s.handleViewShare)
		r.Head("/p/{id}", s.handleViewShare)
		r.Head("/f/{id}", s.handleViewShare)
		r.Head("/app/{id}", s.handleViewShare)
		r.Head("/plan/{id}", s.handleViewShare)
		r.Head("/d/{id}", s.handleViewShare)

		// Share API
		r.Post("/api/diff", s.handleCreateDiff)
		r.Post("/api/files", s.handleCreateFiles)
		r.Get("/api/diff/{id}", s.handleGetDiff)
		r.Get("/api/files/{id}", s.handleGetFiles)
		// Kind-agnostic lookup, so the /s/{id} shell can fetch without knowing which
		// table the id lives in.
		r.Get("/api/share/{id}", s.handleGetShare)
		r.Patch("/api/diff/{id}", s.handleUpdateDiff)
		r.Patch("/api/files/{id}", s.handleUpdateFiles)
		r.Put("/api/diff/{id}", s.handleReplaceDiff)
		r.Put("/api/files/{id}", s.handleReplaceFiles)
	})

	// Admin surface: same-origin dashboard. No permissive CORS (cookies +
	// SameSite=Strict); state-changing routes verify Origin as CSRF defense.
	r.Group(func(r chi.Router) {
		r.Get("/admin", s.handleViewAdmin)
		r.Head("/admin", s.handleViewAdmin)

		// Public admin endpoints (own gating): status probe + auth.
		r.Get("/api/admin/session", s.handleAdminSession)
		r.Post("/api/admin/login/owner-key", s.handleOwnerKeyLogin)
		r.Post("/api/admin/logout", s.handleAdminLogout)

		// Protected admin API.
		r.Group(func(r chi.Router) {
			r.Use(s.requireAdmin)
			r.Get("/api/admin/shares", s.handleAdminListShares)
			r.Patch("/api/admin/{kind}/{id}", s.handleAdminKeepForever)
			r.Post("/api/admin/{kind}/{id}/revoke", s.handleAdminRevoke)
			r.Post("/api/admin/{kind}/{id}/reshare", s.handleAdminReshare)
			r.Get("/api/admin/{kind}/{id}/recovery-dek", s.handleAdminRecoveryDek)
			r.Post("/api/admin/{kind}/{id}/reset-reshare", s.handleAdminResetReshare)
			r.Delete("/api/admin/{kind}/{id}", s.handleAdminDelete)
		})
	})

	s.router = r
	return s
}

// buildAdminState resolves AdminConfig into runtime state, or nil when the
// admin subsystem is disabled (no session secret).
func buildAdminState(cfg AdminConfig) *adminState {
	if cfg.SessionSecret == "" {
		return nil
	}
	ttl := cfg.SessionTTL
	if ttl <= 0 {
		ttl = defaultSessionTTL
	}
	as := &adminState{
		secret:        []byte(cfg.SessionSecret),
		ttl:           ttl,
		secureCookies: cfg.SecureCookies,
		limiter:       newRateLimiter(5, time.Minute),
	}
	if cfg.OwnerKey != "" {
		sum := sha256.Sum256([]byte(cfg.OwnerKey))
		as.ownerKeyHash = hex.EncodeToString(sum[:])
	}
	if cfg.CFAccess.Enabled {
		v, err := newCFAccessVerifier(cfg.CFAccess)
		if err != nil {
			log.Printf("admin: Cloudflare Access disabled: %v", err)
		} else {
			as.cfAccess = v
			log.Printf("admin: Cloudflare Access enabled (team %s)", cfg.CFAccess.TeamDomain)
		}
	}
	return as
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}

// resolveMaxUploadBytes reads AGENTGATE_MAX_UPLOAD_BYTES (a positive byte count)
// or falls back to the default.
func resolveMaxUploadBytes() int64 {
	if v := os.Getenv("AGENTGATE_MAX_UPLOAD_BYTES"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return defaultMaxUploadBytes
}
