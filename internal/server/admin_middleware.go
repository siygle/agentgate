package server

import (
	"context"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// accessVerifier validates a Cloudflare Access JWT. Implemented by
// cfAccessVerifier (cf_access.go); nil on adminState when CF Access is disabled.
type accessVerifier interface {
	verify(token string) bool
}

// adminState holds the resolved admin-auth configuration. It is nil on the
// Server when the admin subsystem is disabled (no session secret configured).
type adminState struct {
	secret        []byte
	ttl           time.Duration
	ownerKeyHash  string // sha256 hex of the owner key; "" disables owner-key login
	secureCookies bool
	cfAccess      accessVerifier // nil disables CF Access
	limiter       *rateLimiter
}

// methods lists the enabled login methods for the session status probe.
func (a *adminState) methods() []string {
	m := []string{}
	if a == nil {
		return m
	}
	if a.ownerKeyHash != "" {
		m = append(m, authMethodOwnerKey)
	}
	if a.cfAccess != nil {
		m = append(m, authMethodCFAccess)
	}
	return m
}

type ctxKey string

const adminMethodKey ctxKey = "adminMethod"

// requireAdmin gates admin API routes. It accepts a valid Cloudflare Access JWT
// (when enabled) or a valid session cookie; otherwise 401. All admin responses
// are marked no-store.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if s.admin == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResponse{Success: false, Error: "admin disabled"})
			return
		}
		if method, ok := s.authenticateAdmin(r); ok {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), adminMethodKey, method)))
			return
		}
		writeJSON(w, http.StatusUnauthorized, apiResponse{Success: false, Error: "unauthorized"})
	})
}

// authenticateAdmin reports whether the request carries valid admin auth,
// returning the method used. CF Access JWT is checked before the session cookie.
func (s *Server) authenticateAdmin(r *http.Request) (string, bool) {
	if s.admin == nil {
		return "", false
	}
	if s.admin.cfAccess != nil {
		if jwt := r.Header.Get("Cf-Access-Jwt-Assertion"); jwt != "" && s.admin.cfAccess.verify(jwt) {
			return authMethodCFAccess, true
		}
	}
	if c, err := r.Cookie(adminCookieName); err == nil {
		if claims, ok := verifySession(s.admin.secret, c.Value); ok {
			return claims.Method, true
		}
	}
	return "", false
}

// checkOrigin is CSRF defense-in-depth for state-changing admin POSTs: when an
// Origin header is present it must match the configured base URL's origin.
func (s *Server) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client or same-origin navigation
	}
	ou, err := url.Parse(origin)
	if err != nil {
		return false
	}
	bu, err := url.Parse(s.baseURL)
	if err != nil {
		return false
	}
	return ou.Scheme == bu.Scheme && ou.Host == bu.Host
}

// rateLimiter is a simple in-memory per-key sliding-window limiter used to
// throttle owner-key login attempts. Single-process only (self-host).
type rateLimiter struct {
	mu      sync.Mutex
	hits    map[string][]int64
	limit   int
	windowS int64
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: map[string][]int64{}, limit: limit, windowS: int64(window.Seconds())}
}

// allow records an attempt for key and reports whether it is within the limit.
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now().Unix()
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := now - rl.windowS
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t > cutoff {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.limit {
		rl.hits[key] = kept
		return false
	}
	rl.hits[key] = append(kept, now)
	return true
}
