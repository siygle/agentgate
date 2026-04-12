import { spawnSync } from "child_process";
import { buildPayloadFromUnifiedDiff } from "../diff-payload.js";
import { postDiff, readPassphrase } from "../api.js";
import type { Diff4Options } from "../api.js";

export async function gitLatest(options: Diff4Options): Promise<void> {
  const result = spawnSync("git", ["diff", "HEAD~1"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.error) {
    console.error(`Failed to run git diff: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`git diff failed: ${result.stderr.trim()}`);
    process.exit(1);
  }

  const diff = result.stdout.trim();

  if (!diff) {
    console.error("No diff found for the latest commit.");
    process.exit(1);
  }

  const subjectResult = spawnSync("git", ["log", "-1", "--format=%s"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const title =
    subjectResult.status === 0
      ? subjectResult.stdout.trim() || "Latest commit"
      : "Latest commit";

  const passphrase = await readPassphrase(options.passphrase);
  await postDiff(buildPayloadFromUnifiedDiff(diff, title), {
    ...options,
    passphrase,
  });
}
