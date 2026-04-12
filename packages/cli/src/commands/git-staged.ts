import { spawnSync } from "child_process";
import { buildPayloadFromUnifiedDiff } from "../diff-payload.js";
import { postDiff, readPassphrase } from "../api.js";
import type { Diff4Options } from "../api.js";

export async function gitStaged(options: Diff4Options): Promise<void> {
  const result = spawnSync("git", ["diff", "--staged"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`Failed to run git diff --staged: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`git diff --staged failed: ${result.stderr.trim()}`);
    process.exit(1);
  }

  const diff = result.stdout.trim();

  if (!diff) {
    console.error("No staged changes found.");
    process.exit(1);
  }

  const passphrase = await readPassphrase(options.passphrase);
  await postDiff(buildPayloadFromUnifiedDiff(diff, "Staged changes"), {
    ...options,
    passphrase,
  });
}
