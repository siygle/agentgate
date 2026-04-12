import { Command } from "commander";
import { gitLatest } from "./commands/git-latest.js";
import { gitStaged } from "./commands/git-staged.js";
import { files } from "./commands/files.js";
import { keyGen } from "./commands/key-gen.js";
import { keyGet } from "./commands/key-get.js";
import type { Diff4Options } from "./api.js";

const program = new Command();

program
  .name("diff4")
  .description("CLI for diff4 - share encrypted diffs and files")
  .version("0.1.0");

const defaultServer = process.env.DIFF4_SERVER || "https://diff4.com";

program
  .command("git-latest")
  .description("Diff the latest commit and share via diff4")
  .option("-s, --server <url>", "diff4 server URL", defaultServer)
  .option("-p, --passphrase <pass>", "encryption passphrase")
  .action(async (opts) => {
    await gitLatest({ server: opts.server, passphrase: opts.passphrase });
  });

program
  .command("git-staged")
  .description("Diff staged changes and share via diff4")
  .option("-s, --server <url>", "diff4 server URL", defaultServer)
  .option("-p, --passphrase <pass>", "encryption passphrase")
  .action(async (opts) => {
    await gitStaged({ server: opts.server, passphrase: opts.passphrase });
  });

program
  .command("files")
  .description("Share files via diff4")
  .argument("<paths...>", "file paths to share (absolute or relative)")
  .option("-s, --server <url>", "diff4 server URL", defaultServer)
  .option("-p, --passphrase <pass>", "encryption passphrase")
  .action(async (paths: string[], opts) => {
    await files(paths, { server: opts.server, passphrase: opts.passphrase });
  });

program
  .command("key-gen")
  .description("Generate and save an encryption key to shell config")
  .argument("[key]", "custom encryption key")
  .action(async (key?: string) => {
    await keyGen(key);
  });

program
  .command("key-get")
  .description("Print the current encryption key")
  .action(async () => {
    await keyGet();
  });

program.parse();
