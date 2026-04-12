import { encrypt } from "./crypto.js";
import type { DiffUploadPayload } from "./diff-payload.js";

export type Diff4Options = {
  server: string;
  passphrase: string;
};

export type { DiffUploadPayload } from "./diff-payload.js";

export async function postDiff(
  payload: DiffUploadPayload,
  options: Diff4Options,
): Promise<void> {
  const encrypted = await encrypt(JSON.stringify(payload), options.passphrase);

  const res = await fetch(`${options.server}/api/diff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_data: encrypted }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`Error: ${data.error || res.statusText}`);
    process.exit(1);
  }

  console.log(JSON.stringify(data.data, null, 2));
}

export async function postFiles(
  content: string,
  options: Diff4Options,
): Promise<void> {
  const encrypted = await encrypt(content, options.passphrase);

  const res = await fetch(`${options.server}/api/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_data: encrypted }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`Error: ${data.error || res.statusText}`);
    process.exit(1);
  }

  console.log(JSON.stringify(data.data, null, 2));
}

export async function readPassphrase(passphrase?: string): Promise<string> {
  if (passphrase) return passphrase;

  const envPass = process.env.DIFF4_PASSPHRASE;
  if (envPass) return envPass;

  console.error("No encryption key found. Run `diff4 key-gen` to set one up, or pass `-p <key>`.");
  process.exit(1);
}
