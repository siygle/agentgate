// Shared route constants.
//
// Kept in its own module rather than in index.ts because admin.ts needs SHARE_PATH too,
// and index.ts already imports admin.ts — importing back would be a cycle.

// SHARE_PATH is the single page route every new share previews at. The kind-specific
// prefixes (/p/, /f/, /app/, /plan/, /d/) still resolve — shares can be permanent, so
// links already handed out must keep working — but they are no longer minted.
export const SHARE_PATH = "/s/";

// LEGACY_SHARE_PREFIXES are the pre-/s/ page routes, kept forever as aliases.
export const LEGACY_SHARE_PREFIXES = ["/p", "/f", "/app", "/plan", "/d"] as const;
