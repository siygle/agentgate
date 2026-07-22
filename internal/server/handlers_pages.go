package server

import (
	"io/fs"
	"net/http"
)

// servePage writes a static HTML shell from the embedded static filesystem.
// Under Plan B the server no longer injects share content into the page; the
// client JS derives kind+id from the URL and fetches GET /api/{kind}/{id}.
// View routes therefore always return 200 for an existing shell — a missing or
// expired share surfaces as a 404 from the API and a not-found state in the UI.
func (s *Server) servePage(w http.ResponseWriter, r *http.Request, name string) {
	data, err := fs.ReadFile(s.staticFS, name)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "index.html")
}

func (s *Server) handleViewDiff(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/diff.html")
}

func (s *Server) handleViewFiles(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/files.html")
}

func (s *Server) handleViewApp(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/app.html")
}

// handleViewPlan and handleViewDocs share the plan viewer shell; the encrypted
// payload's kind selects plan vs generic-document rendering client-side.
func (s *Server) handleViewPlan(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/plan.html")
}

func (s *Server) handleViewDocs(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/plan.html")
}

// handleViewAdmin serves the owner-dashboard shell. Like the other view shells
// it always returns 200; the client JS probes /api/admin/session and renders
// either the login card or the shares table.
func (s *Server) handleViewAdmin(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/admin.html")
}
