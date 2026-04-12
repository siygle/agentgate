import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { customAlphabet } from "nanoid";
import { getShellRcPath, ENV_LINE_REGEX } from "./key-utils.js";

const generateKey = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

export async function keyGen(key?: string): Promise<void> {
  const passphrase = key || generateKey();
  const rcPath = getShellRcPath();
  const exportLine = `export DIFF4_PASSPHRASE="${passphrase}"`;

  if (!existsSync(rcPath)) {
    writeFileSync(rcPath, `${exportLine}\n`);
    console.log(`Added DIFF4_PASSPHRASE to ${rcPath}`);
    console.log(`Passphrase: ${passphrase}`);
    console.log(`\nRun: source ${rcPath}`);
    return;
  }

  const content = readFileSync(rcPath, "utf8");
  const lines = content.split("\n");
  const existingIndex = lines.findIndex((l) => ENV_LINE_REGEX.test(l));

  if (existingIndex !== -1) {
    lines[existingIndex] = exportLine;
    writeFileSync(rcPath, lines.join("\n"));
    console.log(`Updated DIFF4_PASSPHRASE in ${rcPath}`);
  } else {
    appendFileSync(rcPath, `\n${exportLine}\n`);
    console.log(`Added DIFF4_PASSPHRASE to ${rcPath}`);
  }

  console.log(`Passphrase: ${passphrase}`);
  console.log(`\nRun: source ${rcPath}`);
}
