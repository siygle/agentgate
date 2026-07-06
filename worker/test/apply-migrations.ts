import { applyD1Migrations, env } from "cloudflare:test";

// Apply the D1 schema to the isolated test database before any test runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
