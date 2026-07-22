package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Admin session: a compact HMAC-signed stateless token stored in an HttpOnly
// cookie. It authenticates the instance operator for the /admin dashboard and
// is entirely separate from the per-share owner tokens in handlers_api.go.
//
// The same token format is implemented byte-for-byte in the Cloudflare Worker
// (worker/src/session.ts) so both backends accept sessions issued by either.
// Format: "v1.<base64url(payload_json)>.<base64url(hmac_sha256(secret, "v1."+b64payload))>"
// payload_json: {"sub":"owner","m":"owner-key|passkey","iat":<unix>,"exp":<unix>}

const (
	adminCookieName = "agentgate_admin"
	sessionVersion  = "v1"

	authMethodOwnerKey = "owner-key"
	authMethodPasskey  = "passkey"
	// authMethodCFAccess labels a request authenticated by a live Cloudflare
	// Access JWT rather than a session cookie; no cookie is issued for it.
	authMethodCFAccess = "cf-access"
)

// sessionClaims is the signed payload. Field tags produce the compact JSON
// the Worker also emits/parses.
type sessionClaims struct {
	Sub    string `json:"sub"`
	Method string `json:"m"`
	Iat    int64  `json:"iat"`
	Exp    int64  `json:"exp"`
}

// signSession returns a signed session token for the given claims.
func signSession(secret []byte, c sessionClaims) string {
	payload, _ := json.Marshal(c)
	b64 := base64.RawURLEncoding.EncodeToString(payload)
	signing := sessionVersion + "." + b64
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signing))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signing + "." + sig
}

// newSessionToken mints a token for method, valid for ttl from now.
func newSessionToken(secret []byte, method string, ttl time.Duration) string {
	now := time.Now().Unix()
	return signSession(secret, sessionClaims{
		Sub:    "owner",
		Method: method,
		Iat:    now,
		Exp:    now + int64(ttl.Seconds()),
	})
}

// verifySession validates a token's signature (constant time) and expiry,
// returning the decoded claims. ok=false on any tampering, malformed input,
// missing secret, or expiry.
func verifySession(secret []byte, token string) (sessionClaims, bool) {
	var zero sessionClaims
	if token == "" || len(secret) == 0 {
		return zero, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != sessionVersion {
		return zero, false
	}
	signing := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signing))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expected), []byte(parts[2])) != 1 {
		return zero, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return zero, false
	}
	var c sessionClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return zero, false
	}
	if c.Exp <= time.Now().Unix() {
		return zero, false
	}
	return c, true
}

// setSessionCookie writes the admin session cookie. secure controls the Secure
// attribute — it is disabled for plain-http (localhost) deployments so dev
// still works, and enabled whenever the base URL is https.
func setSessionCookie(w http.ResponseWriter, token string, ttl time.Duration, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}

// clearSessionCookie expires the admin session cookie.
func clearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}
