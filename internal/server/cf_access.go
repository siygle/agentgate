package server

import (
	"fmt"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// cfAccessVerifier validates Cloudflare Access application JWTs presented in the
// Cf-Access-Jwt-Assertion header. It enforces all four checks that make the
// header trustworthy: RS256 signature against the team JWKS, exact audience
// (aud) match, issuer (team domain), and expiry. An optional email allowlist
// further restricts which authenticated identities are accepted.
//
// aud MUST be checked: Cloudflare signs every Access app in a team with the same
// key, so a valid JWT from another app in the same team would pass signature
// verification alone.
type cfAccessVerifier struct {
	jwks   keyfunc.Keyfunc
	aud    string
	issuer string
	emails map[string]bool // empty = any authenticated identity
}

func newCFAccessVerifier(cfg CFAccessConfig) (*cfAccessVerifier, error) {
	if cfg.TeamDomain == "" || cfg.AUD == "" {
		return nil, fmt.Errorf("team domain and AUD are required")
	}
	certsURL := "https://" + cfg.TeamDomain + "/cdn-cgi/access/certs"
	k, err := keyfunc.NewDefault([]string{certsURL})
	if err != nil {
		return nil, fmt.Errorf("load JWKS from %s: %w", certsURL, err)
	}
	v := &cfAccessVerifier{
		jwks:   k,
		aud:    cfg.AUD,
		issuer: "https://" + cfg.TeamDomain,
		emails: map[string]bool{},
	}
	for _, e := range cfg.Emails {
		if e = strings.TrimSpace(strings.ToLower(e)); e != "" {
			v.emails[e] = true
		}
	}
	return v, nil
}

// verify reports whether token is a valid Cloudflare Access assertion for this
// application. Any failure (bad signature, wrong aud/iss, expired, or not on the
// email allowlist) returns false.
func (v *cfAccessVerifier) verify(token string) bool {
	if token == "" {
		return false
	}
	parsed, err := jwt.Parse(token, v.jwks.Keyfunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithAudience(v.aud),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !parsed.Valid {
		return false
	}
	if len(v.emails) > 0 {
		claims, ok := parsed.Claims.(jwt.MapClaims)
		if !ok {
			return false
		}
		email, _ := claims["email"].(string)
		if !v.emails[strings.ToLower(email)] {
			return false
		}
	}
	return true
}
