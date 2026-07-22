// Cloudflare Access JWT verification for the admin dashboard. Validates the
// Cf-Access-Jwt-Assertion header with jose (WebCrypto-native on Workers).
//
// All four checks that make the header trustworthy are enforced: RS256
// signature against the team JWKS, exact audience (aud), issuer (team domain),
// and expiry. aud MUST be checked — Cloudflare signs every Access app in a team
// with the same key, so signature alone is not sufficient.

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./bindings";

export function cfAccessEnabled(env: Env): boolean {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

export type CfAccessVerify = (token: string) => Promise<boolean>;

// Module-scoped memo so the JWKS is fetched/cached across requests within an
// isolate. Keyed by team domain + aud so a config change rebuilds it.
let cached: { key: string; verify: CfAccessVerify } | null = null;

export function getCfAccessVerifier(env: Env): CfAccessVerify | null {
  if (!cfAccessEnabled(env)) return null;
  const team = env.CF_ACCESS_TEAM_DOMAIN!;
  const aud = env.CF_ACCESS_AUD!;
  const key = team + "|" + aud;
  if (cached && cached.key === key) return cached.verify;

  const issuer = `https://${team}`;
  const jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
  const emails = new Set(
    (env.CF_ACCESS_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

  const verify: CfAccessVerify = async (token: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        audience: aud,
        issuer,
        algorithms: ["RS256"],
      });
      if (emails.size > 0) {
        const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
        if (!emails.has(email)) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  cached = { key, verify };
  return verify;
}
