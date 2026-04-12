import { existsSync, readFileSync } from "fs";
import { getShellRcPath, ENV_LINE_REGEX } from "./key-utils.js";

export async function keyGet(): Promise<void> {
  const envPass = process.env.DIFF4_PASSPHRASE;
  if (envPass) {
    console.log(envPass);
    return;
  }

  const rcPath = getShellRcPath();
  if (!existsSync(rcPath)) {
    console.error("No DIFF4_PASSPHRASE found. Run `diff4 key-gen` first.");
    process.exit(1);
  }

  const content = readFileSync(rcPath, "utf8");
  const match = content.split("\n").find((l) => ENV_LINE_REGEX.test(l));

  if (!match) {
    console.error("No DIFF4_PASSPHRASE found. Run `diff4 key-gen` first.");
    process.exit(1);
  }

  const [, passphrase] = match.match(ENV_LINE_REGEX)!;
  console.log(passphrase);
}
