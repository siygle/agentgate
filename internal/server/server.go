package server

import (
	"database/sql"
	"html/template"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// Server holds dependencies and the HTTP router.
type Server struct {
	db        *sql.DB
	router    chi.Router
	templates map[string]*template.Template
	baseURL   string
}

// parsePageTemplate parses a page template together with the layout.
func parsePageTemplate(tfs fs.FS, page string) *template.Template {
	return template.Must(template.ParseFS(tfs, "layout.html", page))
}

// New creates a Server with all routes registered.
// templateFS should be rooted so that "*.html" matches the template files
// (e.g. the web/templates sub-tree). staticFS should be rooted at the
// directory whose contents are served under /static/.
func New(db *sql.DB, baseURL string, templateFS, staticFS fs.FS) *Server {
	tmpl := map[string]*template.Template{
		"index.html":     parsePageTemplate(templateFS, "index.html"),
		"diff.html":      parsePageTemplate(templateFS, "diff.html"),
		"files.html":     parsePageTemplate(templateFS, "files.html"),
		"not_found.html": parsePageTemplate(templateFS, "not_found.html"),
	}

	s := &Server{
		db:        db,
		templates: tmpl,
		baseURL:   baseURL,
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

	// Pages
	r.Get("/", s.handleIndex)
	r.Get("/p/{id}", s.handleViewDiff)
	r.Get("/f/{id}", s.handleViewFiles)

	// API
	r.Post("/api/diff", s.handleCreateDiff)
	r.Post("/api/files", s.handleCreateFiles)

	s.router = r
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.router.ServeHTTP(w, r)
}
