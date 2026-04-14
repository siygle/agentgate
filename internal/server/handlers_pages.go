package server

import (
	"net/http"
	"time"

	"github.com/diffmini/diffmini/internal/db"
	"github.com/go-chi/chi/v5"
)

// ViewPageData is passed to the diff and files view templates.
type ViewPageData struct {
	EncryptedData string // raw JSON string, embedded as data-value attribute
	ExpiresAt     string // ISO 8601
}

// renderTemplate executes a named page template with the layout.
func (s *Server) renderTemplate(w http.ResponseWriter, name string, status int, data interface{}) {
	t, ok := s.templates[name]
	if !ok {
		http.Error(w, "template not found", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(status)
	t.ExecuteTemplate(w, "layout", data)
}

// handleIndex renders the landing page.
func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, "index.html", http.StatusOK, nil)
}

// handleViewDiff renders the diff viewer page.
func (s *Server) handleViewDiff(w http.ResponseWriter, r *http.Request) {
	diffID := chi.URLParam(r, "id")

	diff, err := db.GetDiff(s.db, diffID)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	if diff == nil || diff.ExpiredAt.Before(time.Now().UTC()) {
		s.renderTemplate(w, "not_found.html", http.StatusNotFound, nil)
		return
	}

	data := ViewPageData{
		EncryptedData: diff.EncryptedData,
		ExpiresAt:     diff.ExpiredAt.Format(time.RFC3339),
	}
	s.renderTemplate(w, "diff.html", http.StatusOK, data)
}

// handleViewFiles renders the file viewer page.
func (s *Server) handleViewFiles(w http.ResponseWriter, r *http.Request) {
	bundleID := chi.URLParam(r, "id")

	bundle, err := db.GetFileBundle(s.db, bundleID)
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	if bundle == nil || bundle.ExpiredAt.Before(time.Now().UTC()) {
		s.renderTemplate(w, "not_found.html", http.StatusNotFound, nil)
		return
	}

	data := ViewPageData{
		EncryptedData: bundle.EncryptedData,
		ExpiresAt:     bundle.ExpiredAt.Format(time.RFC3339),
	}
	s.renderTemplate(w, "files.html", http.StatusOK, data)
}
