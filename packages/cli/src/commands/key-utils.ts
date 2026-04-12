import { resolve } from "path";
import { homedir } from "os";

export const ENV_LINE_REGEX = /^export\s+DIFF4_PASSPHRASE="([^"]*)"/;

export function getShellRcPath(): string {
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) return resolve(homedir(), ".zshrc");
  if (shell.includes("bash")) return resolve(homedir(), ".bashrc");
  return resolve(homedir(), ".profile");
}
