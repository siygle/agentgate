import { codeToHtml } from "shiki";

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  php: "php",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sh: "sh",
  bash: "bash",
  zsh: "bash",
  toml: "toml",
  graphql: "graphql",
  vue: "vue",
  svelte: "svelte",
};

function langFromTitle(title: string): string {
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "text";
}

export async function highlightCode(
  code: string,
  title: string,
): Promise<string> {
  const lang = langFromTitle(title);

  try {
    return await codeToHtml(code, {
      lang,
      theme: "github-light-default",
    });
  } catch {
    return await codeToHtml(code, {
      lang: "text",
      theme: "github-light-default",
    });
  }
}
