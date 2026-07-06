// Copies the shared frontend (../web/static) into ./public with the URL layout
// Workers Static Assets expects:
//   ../web/static/index.html   -> public/index.html          (served at /)
//   ../web/static/{css,js,vendor} -> public/static/*         (served at /static/*)
//   ../web/static/views/*      -> public/views/*             (served by the Worker for /p /f /app /plan /d)
// web/static remains the single source of truth shared with the Go self-host server.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(here, "..");
const src = join(workerRoot, "..", "web", "static");
const out = join(workerRoot, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "static"), { recursive: true });

for (const dir of ["css", "js", "vendor"]) {
  cpSync(join(src, dir), join(out, "static", dir), { recursive: true });
}
cpSync(join(src, "views"), join(out, "views"), { recursive: true });
cpSync(join(src, "index.html"), join(out, "index.html"));

console.log("sync-assets: copied web/static -> worker/public");
