package server

import (
	"database/sql"
	"io/fs"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// defaultMaxUploadBytes caps the stored encrypted blob per share on the
// self-host backend. SQLite has no small per-value limit (unlike Cloudflare
// D1's 2 MB), so this generous default mainly guards memory; override it with
// AGENTGATE_MAX_UPLOAD_BYTES when sharing larger bundles (e.g. with a blob dir).
const defaultMaxUploadBytes = 10 << 20 // 10 MB

// Server holds dependencies and the HTTP router.
type Server struct {
	db             *sql.DB
	router         chi.Router
	staticFS       fs.FS
	baseURL        string
	maxUploadBytes int64
}

// New creates a Server with all routes registered.
// staticFS should be rooted at the directory whose contents are served under
// /static/ (it also holds the static HTML shells: index.html and views/*.html).
func New(db *sql.DB, baseURL string, staticFS fs.FS) *Server {
	s := &Server{
		db:             db,
		staticFS:       staticFS,
		baseURL:        baseURL,
		maxUploadBytes: resolveMaxUploadBytes(),
	}

	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// Static files
	fileServer := http.FileServer(http.FS(staticFS))
	r.Handle("/static/*", http.StripPrefix("/static/", fileServer))

	// Pages (Plan B: static HTML shells; client JS fetches the ciphertext).
	r.Get("/", s.handleIndex)
	r.Get("/llms.txt", s.handleLLMsTxt)
	r.Get("/llms-full.txt", s.handleLLMsFullTxt)
	r.Get("/p/{id}", s.handleViewDiff)
	r.Get("/f/{id}", s.handleViewFiles)
	r.Get("/app/{id}", s.handleViewApp)
	r.Get("/plan/{id}", s.handleViewPlan)
	r.Get("/d/{id}", s.handleViewDocs)
	// Some chat/mobile clients probe shared URLs with HEAD before opening them.
	r.Head("/p/{id}", s.handleViewDiff)
	r.Head("/f/{id}", s.handleViewFiles)
	r.Head("/app/{id}", s.handleViewApp)
	r.Head("/plan/{id}", s.handleViewPlan)
	r.Head("/d/{id}", s.handleViewDocs)

	// API
	r.Post("/api/diff", s.handleCreateDiff)
	r.Post("/api/files", s.handleCreateFiles)
	r.Get("/api/diff/{id}", s.handleGetDiff)
	r.Get("/api/files/{id}", s.handleGetFiles)
	r.Patch("/api/diff/{id}", s.handleUpdateDiff)
	r.Patch("/api/files/{id}", s.handleUpdateFiles)
	r.Put("/api/diff/{id}", s.handleReplaceDiff)
	r.Put("/api/files/{id}", s.handleReplaceFiles)

	s.router = r
	return s
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
