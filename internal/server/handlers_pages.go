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

// buildPageCSP assembles a host-page policy. Only script-src differs between the two
// pages, so it is the one parameter — deriving one policy from the other by string
// substitution was worse: an edit to the base policy made the substitution silently
// no-op, and the share shell quietly lost the relaxation it needs.
//
//	style-src            'unsafe-inline' covers the element.style writes the chrome makes
//	connect-src 'self'   the page talks only to its own API — so even if something did
//	                     execute here, it could not send anything to a third party
//	img/font-src         no third-party asset loads (this is what would have caught the
//	                     old Google Fonts request from the settings panel)
//	frame-src blob: data: the render sandbox is a srcdoc iframe, and "open standalone"
//	                     hands the assembled document over as a blob: URL
//	frame-ancestors      AgentGate is never meant to be embedded
func buildPageCSP(scriptSrc string) string {
	return "default-src 'self'; " +
		"script-src " + scriptSrc + "; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: blob:; " +
		"font-src 'self' data:; " +
		"connect-src 'self'; " +
		"frame-src blob: data:; " +
		"form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
}

// pageCSP is the strict policy, used by every page that does NOT embed the render
// sandbox — the landing page and, most importantly, the admin dashboard. Those carry no
// inline script at all: web/static/js/landing.js exists so this can be enforced.
var pageCSP = buildPageCSP("'self'")

// sharePageCSP is used ONLY by the share shell, and is deliberately weaker.
//
// A srcdoc iframe INHERITS its parent's CSP, and the effective policy is the
// intersection of the two. The render sandbox is built entirely from inline scripts
// (every library is inlined, because the frame has no network) and MDX compilation
// additionally needs 'unsafe-eval'. A host policy stricter than this therefore blocks
// the sandbox outright — verified in a browser, not assumed.
//
// Scoping the relaxation to this one page is the point: the admin dashboard keeps the
// strict policy. And what matters most still holds here — no third-party script origin
// may load, and connect-src 'self' means nothing that did execute could send anything
// out. The shell itself carries no inline script either; share-boot.js exists for that.
var sharePageCSP = buildPageCSP("'self' 'unsafe-inline' 'unsafe-eval'")

func (s *Server) servePage(w http.ResponseWriter, r *http.Request, name string) {
	s.servePageCSP(w, r, name, pageCSP)
}

func (s *Server) servePageCSP(w http.ResponseWriter, r *http.Request, name, csp string) {
	data, err := fs.ReadFile(s.staticFS, name)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", csp)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "index.html")
}

// handleViewShare serves the one share shell, for /s/{id} and for the five legacy
// kind-specific prefixes. The shell decrypts client-side and picks a built-in renderer
// from the payload, so the server does not need to know which kind it is serving.
func (s *Server) handleViewShare(w http.ResponseWriter, r *http.Request) {
	s.servePageCSP(w, r, "views/share.html", sharePageCSP)
}

// handleViewAdmin serves the owner-dashboard shell. Like the other view shells
// it always returns 200; the client JS probes /api/admin/session and renders
// either the login card or the shares table.
func (s *Server) handleViewAdmin(w http.ResponseWriter, r *http.Request) {
	s.servePage(w, r, "views/admin.html")
}
