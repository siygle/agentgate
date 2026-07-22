package server

import "time"

// AdminConfig configures the owner (instance-admin) dashboard. It is passed to
// New(); an empty SessionSecret disables the whole admin subsystem (fail
// closed) so a misconfigured deployment never exposes an unauthenticated
// dashboard.
type AdminConfig struct {
	// SessionSecret signs admin session cookies (HMAC-SHA256). Required to
	// enable the admin subsystem.
	SessionSecret string
	// SessionTTL is the session lifetime; <=0 uses the 12h default.
	SessionTTL time.Duration
	// OwnerKey is the shared secret for owner-key login; empty disables it.
	OwnerKey string
	// SecureCookies sets the Secure attribute on the session cookie. Enable for
	// https deployments; disable for plain-http localhost dev.
	SecureCookies bool
	// CFAccess configures Cloudflare Access JWT auth (optional).
	CFAccess CFAccessConfig
}

// CFAccessConfig configures Cloudflare Access header authentication. Only
// enable Enabled when the origin is reachable solely through Cloudflare (see
// docs), because a directly-exposed origin would otherwise trust a spoofable
// header — though full JWT verification still rejects forged assertions.
type CFAccessConfig struct {
	Enabled    bool
	TeamDomain string   // "<team>.cloudflareaccess.com"
	AUD        string   // expected aud tag
	Emails     []string // optional email allowlist; empty = any authenticated identity
}
