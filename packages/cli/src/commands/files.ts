import { readFileSync } from "fs";
import { resolve } from "path";
import { postFiles, readPassphrase } from "../api.js";
import type { Diff4Options } from "../api.js";

export async function files(
  filePaths: string[],
  options: Diff4Options,
): Promise<void> {
  if (filePaths.length === 0) {
    console.error("No file paths provided.");
    process.exit(1);
  }

  const files = filePaths.map((p) => {
    const absolute = resolve(p);
    try {
      const content = readFileSync(absolute, "utf8");
      return { title: p, content };
    } catch (e) {
      console.error(`Failed to read file: ${absolute}`);
      process.exit(1);
    }
  });

  const bundle = { files };

  const passphrase = await readPassphrase(options.passphrase);
  await postFiles(JSON.stringify(bundle), { ...options, passphrase });
}
