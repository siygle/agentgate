import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          // R2's SQLite-backed storage trips the pool's isolated-storage
          // stack teardown; tests use unique IDs so shared storage is fine.
          isolatedStorage: false,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            // Required by @cloudflare/vitest-pool-workers; test-only, so the
            // deployed Worker keeps its minimal compatibility flags.
            compatibilityFlags: ["nodejs_compat"],
            // Exposed to the setup file so it can apply the schema to the test D1.
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
