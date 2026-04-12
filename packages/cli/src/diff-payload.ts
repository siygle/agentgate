/** Plaintext shape must match `DiffDecryptViewer` on the server. */

export type DiffUploadPayload = {
  title: string;
  files: Array<{
    filename: string;
    language?: string;
    patch: string;
  }>;
};

function parseGitPath(spec: string): string {
  let s = spec.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.startsWith("b/")) return s.slice(2);
  if (s.startsWith("a/")) return s.slice(2);
  return s;
}

function filenameFromPatch(patch: string): string {
  let plus: string | undefined;
  let minus: string | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      plus = line.slice(4).split("\t")[0].trim();
    } else if (line.startsWith("--- ")) {
      const raw = line.slice(4).split("\t")[0].trim();
      if (raw !== "/dev/null") minus = raw;
    }
  }
  if (plus && plus !== "/dev/null") return parseGitPath(plus);
  if (minus && minus !== "/dev/null") return parseGitPath(minus);

  const first = patch.split("\n")[0] ?? "";
  const m = first.match(/^diff --git (.+) (.+)$/);
  if (m) return parseGitPath(m[2]);
  return "unknown";
}

function splitUnifiedDiff(unifiedDiff: string): string[] {
  const trimmed = unifiedDiff.trim();
  return trimmed
    .split(/(?=^diff --git )/m)
    .filter((c) => c.startsWith("diff --git"));
}

export function buildPayloadFromUnifiedDiff(
  unifiedDiff: string,
  title: string,
): DiffUploadPayload {
  const chunks = splitUnifiedDiff(unifiedDiff);
  if (chunks.length === 0) {
    return {
      title,
      files: [{ filename: "diff", patch: unifiedDiff.trim() }],
    };
  }
  return {
    title,
    files: chunks.map((patch) => ({
      filename: filenameFromPatch(patch),
      patch,
    })),
  };
}
