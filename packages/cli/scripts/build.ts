import { mkdirSync } from "fs";
const ENTRY = "src/index.ts";
const OUT_DIR = "binaries";

const TARGETS = [
  { target: "bun-darwin-arm64", name: "diff4-darwin-arm64" },
  { target: "bun-darwin-x64", name: "diff4-darwin-x64" },
  { target: "bun-linux-arm64", name: "diff4-linux-arm64" },
  { target: "bun-linux-x64", name: "diff4-linux-x64" },
  { target: "bun-linux-arm64-musl", name: "diff4-linux-arm64-musl" },
  { target: "bun-linux-x64-musl", name: "diff4-linux-x64-musl" },
  { target: "bun-windows-x64", name: "diff4-windows-x64.exe" },
];


mkdirSync(OUT_DIR, { recursive: true });

for (const { target, name } of TARGETS) {
  const proc = Bun.spawn([
    "bun",
    "build",
    "--compile",
    `--target=${target}`,
    ENTRY,
    `--outfile=${OUT_DIR}/${name}`,
  ]);

  const exitCode = await proc.exited;
  if (exitCode === 0) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name} (exit ${exitCode})`);
  }
}
