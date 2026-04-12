"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parse } from "diff2html";
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type ThemedTokenWithVariants,
} from "shiki/bundle/web";

type DiffFileEntry = {
  filename: string;
  language?: string;
  patch: string;
};

type DiffViewerProps = {
  files: DiffFileEntry[];
};

type ParsedLine = {
  type: "context" | "insert" | "delete";
  content: string;
  oldNumber?: number;
  newNumber?: number;
};

type ParsedFile = {
  oldName: string;
  newName: string;
  language: string;
  hunks: ParsedLine[][];
  additions: number;
  deletions: number;
};

type ThemedToken = ThemedTokenWithVariants;

type SplitLine =
  | { kind: "equal"; left: ParsedLine; right: ParsedLine }
  | { kind: "delete-only"; left: ParsedLine }
  | { kind: "insert-only"; right: ParsedLine }
  | { kind: "change"; left: ParsedLine; right: ParsedLine }
  | { kind: "separator" };

function langFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    svg: "xml",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    php: "php",
    vue: "vue",
    svelte: "svelte",
    gql: "graphql",
  };
  return map[ext] ?? ext;
}

function parseDiffFiles(files: DiffFileEntry[]): ParsedFile[] {
  const combined = files.map((f) => f.patch).join("\n");
  const parsed = parse(combined);

  return parsed.map((file, i) => ({
    oldName: file.oldName,
    newName: file.newName,
    language: files[i]?.language ?? langFromFilename(file.newName),
    hunks: file.blocks.map((block) =>
      block.lines.map((line) => ({
        type: line.type as "context" | "insert" | "delete",
        content: line.content.slice(1),
        oldNumber: line.oldNumber,
        newNumber: line.newNumber,
      }))
    ),
    additions: file.addedLines ?? 0,
    deletions: file.deletedLines ?? 0,
  }));
}

function buildSplitLines(lines: ParsedLine[]): SplitLine[] {
  const result: SplitLine[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].type === "context") {
      result.push({ kind: "equal", left: lines[i], right: lines[i] });
      i++;
    } else {
      const dels: ParsedLine[] = [];
      const adds: ParsedLine[] = [];
      while (i < lines.length && lines[i].type === "delete") {
        dels.push(lines[i]);
        i++;
      }
      while (i < lines.length && lines[i].type === "insert") {
        adds.push(lines[i]);
        i++;
      }

      const pairs = Math.min(dels.length, adds.length);
      for (let p = 0; p < pairs; p++) {
        result.push({ kind: "change", left: dels[p], right: adds[p] });
      }
      for (let p = pairs; p < dels.length; p++) {
        result.push({ kind: "delete-only", left: dels[p] });
      }
      for (let p = pairs; p < adds.length; p++) {
        result.push({ kind: "insert-only", right: adds[p] });
      }
    }
  }

  return result;
}

const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "css",
  "html",
  "json",
  "yaml",
  "bash",
  "sql",
  "markdown",
  "jsx",
  "tsx",
  "vue",
  "svelte",
  "scss",
  "less",
  "xml",
  "graphql",
  "java",
  "c",
  "cpp",
  "php",
  "shell",
] as BundledLanguage[];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark-default"],
      langs: LANGUAGES,
    });
  }
  return highlighterPromise;
}

function useHighlighter() {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) setHighlighter(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { highlighter, ready: highlighter !== null };
}

function resolveLang(
  highlighter: Highlighter,
  lang: string,
): BundledLanguage {
  const loaded = highlighter.getLoadedLanguages();
  if (loaded.includes(lang as BundledLanguage)) {
    return lang as BundledLanguage;
  }
  return "plaintext" as BundledLanguage;
}

function useHighlightedLines(
  highlighter: Highlighter | null,
  lines: ParsedLine[],
  lang: string,
): ThemedToken[][] | null {
  return useMemo(() => {
    if (!highlighter || lines.length === 0) return null;

    const code = lines.map((l) => l.content).join("\n");
    const resolved = resolveLang(highlighter, lang);

    try {
      return highlighter.codeToTokensWithThemes(code, {
        lang: resolved,
        themes: { light: "github-light", dark: "github-dark-default" },
      });
    } catch {
      return null;
    }
  }, [highlighter, lines, lang]);
}

function FileBadge({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono ml-auto shrink-0">
      {additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-red-500 dark:text-red-400">-{deletions}</span>
      )}
    </span>
  );
}

function LineNumber({ num }: { num?: number }) {
  return (
    <span className="inline-block w-8 text-right pr-2 text-[11px] leading-5 select-none text-stone-400 dark:text-stone-600 font-mono">
      {num ?? ""}
    </span>
  );
}

function HighlightedContent({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <>
      {tokens.map((token, i) => {
        const light = token.variants.light?.color;
        const dark = token.variants.dark?.color;
        return (
          <span
            key={i}
            style={
              light && dark
                ? ({
                    "--shiki-light": light,
                    "--shiki-dark": dark,
                    color: light,
                  } as React.CSSProperties)
                : undefined
            }
            className={light && dark ? "dark:!text-[var(--shiki-dark)]" : undefined}
          >
            {token.content}
          </span>
        );
      })}
    </>
  );
}

function LineContent({
  line,
  tokens,
}: {
  line: ParsedLine;
  tokens: ThemedToken[] | null;
}) {
  return (
    <>
      <span
        className={
          line.type === "insert"
            ? "text-emerald-700 dark:text-emerald-400"
            : line.type === "delete"
              ? "text-red-600 dark:text-red-400"
              : undefined
        }
      >
        {line.type === "insert" ? "+" : line.type === "delete" ? "-" : " "}
      </span>
      {tokens ? <HighlightedContent tokens={tokens} /> : line.content}
    </>
  );
}

function UnifiedView({
  file,
  highlighted,
}: {
  file: ParsedFile;
  highlighted: ThemedToken[][] | null;
}) {
  let tokenIdx = 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] font-mono leading-5">
        <tbody>
          {file.hunks.flatMap((hunk, hunkIdx) => [
            hunkIdx > 0 ? (
              <tr
                key={`sep-${hunkIdx}`}
                className="bg-sky-50/60 dark:bg-sky-950/30"
              >
                <td
                  colSpan={3}
                  className="px-2 py-1 text-[11px] text-sky-600 dark:text-sky-400 select-none tracking-wider"
                >
                  &middot;&middot;&middot;
                </td>
              </tr>
            ) : null,
            ...hunk.map((line) => {
              const lineTokens = highlighted
                ? highlighted[tokenIdx]
                : null;
              tokenIdx++;
              return (
                <tr
                  key={`l-${hunkIdx}-${tokenIdx - 1}`}
                  className={
                    line.type === "insert"
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : line.type === "delete"
                        ? "bg-red-50 dark:bg-red-950/30"
                        : "hover:bg-stone-50 dark:hover:bg-stone-900/40"
                  }
                >
                  <td className="border-r border-stone-100 dark:border-stone-800/60 w-9 min-w-9">
                    <LineNumber num={line.oldNumber} />
                  </td>
                  <td className="border-r border-stone-100 dark:border-stone-800/60 w-9 min-w-9">
                    <LineNumber num={line.newNumber} />
                  </td>
                  <td className="px-2 whitespace-pre">
                    <LineContent line={line} tokens={lineTokens} />
                  </td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function getTokens(
  map: Map<string, ThemedToken[] | null>,
  idx: number,
): ThemedToken[] | null {
  return map.get(`${idx}`) ?? null;
}

function SplitView({
  file,
  highlighted,
}: {
  file: ParsedFile;
  highlighted: ThemedToken[][] | null;
}) {
  const allLines = file.hunks.flat();
  const tokenMap = useMemo(() => {
    if (!highlighted) return new Map<string, ThemedToken[] | null>();
    const m = new Map<string, ThemedToken[] | null>();
    for (let i = 0; i < allLines.length; i++) {
      m.set(`${i}`, highlighted[i] ?? null);
    }
    return m;
  }, [highlighted, allLines.length]);

  const splitLinesByHunk = file.hunks.map((hunk, hunkIdx) => {
    const startIdx = file.hunks
      .slice(0, hunkIdx)
      .reduce((s, h) => s + h.length, 0);

    const splitLines = buildSplitLines(hunk);
    return { hunkIdx, splitLines, startIdx };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] font-mono leading-5">
        <colgroup>
          <col className="w-9 min-w-9" />
          <col />
          <col className="w-9 min-w-9" />
          <col />
        </colgroup>
        <tbody>
          {splitLinesByHunk.flatMap(
            ({ hunkIdx, splitLines, startIdx }, groupIdx) => [
              groupIdx > 0 ? (
                <tr
                  key={`sep-${hunkIdx}`}
                  className="bg-sky-50/60 dark:bg-sky-950/30"
                >
                  <td
                    colSpan={4}
                    className="px-3 py-1 text-[11px] text-sky-600 dark:text-sky-400 select-none tracking-wider"
                  >
                    &middot;&middot;&middot;
                  </td>
                </tr>
              ) : null,
              ...splitLines.map((sl, li) => {
                if (sl.kind === "separator") return null;

                if (sl.kind === "equal") {
                  const idx = startIdx + li;
                  const tokens = getTokens(tokenMap, idx);
                  return (
                    <tr key={`s-${hunkIdx}-${li}`}>
                      <td className="border-r border-stone-100 dark:border-stone-800/60">
                        <LineNumber num={sl.left.oldNumber} />
                      </td>
                      <td className="border-r border-stone-200 dark:border-stone-700 px-3 whitespace-pre hover:bg-stone-50 dark:hover:bg-stone-900/40">
                        <LineContent line={sl.left} tokens={tokens} />
                      </td>
                      <td className="border-r border-stone-100 dark:border-stone-800/60">
                        <LineNumber num={sl.right.newNumber} />
                      </td>
                      <td className="px-3 whitespace-pre hover:bg-stone-50 dark:hover:bg-stone-900/40">
                        <LineContent line={sl.right} tokens={tokens} />
                      </td>
                    </tr>
                  );
                }

                if (sl.kind === "delete-only") {
                  const idx = startIdx + li;
                  const tokens = getTokens(tokenMap, idx);
                  return (
                    <tr
                      key={`s-${hunkIdx}-${li}`}
                      className="bg-red-50 dark:bg-red-950/20"
                    >
                      <td className="border-r border-stone-100 dark:border-stone-800/60">
                        <LineNumber num={sl.left.oldNumber} />
                      </td>
                      <td className="border-r border-stone-200 dark:border-stone-700 px-3 whitespace-pre">
                        <LineContent line={sl.left} tokens={tokens} />
                      </td>
                      <td className="border-r border-stone-100 dark:border-stone-800/60" />
                      <td className="bg-stone-50/50 dark:bg-stone-900/30" />
                    </tr>
                  );
                }

                if (sl.kind === "insert-only") {
                  const idx = startIdx + li;
                  const tokens = getTokens(tokenMap, idx);
                  return (
                    <tr
                      key={`s-${hunkIdx}-${li}`}
                      className="bg-emerald-50 dark:bg-emerald-950/20"
                    >
                      <td className="border-r border-stone-100 dark:border-stone-800/60" />
                      <td className="bg-stone-50/50 dark:bg-stone-900/30" />
                      <td className="border-r border-stone-100 dark:border-stone-800/60">
                        <LineNumber num={sl.right.newNumber} />
                      </td>
                      <td className="px-3 whitespace-pre">
                        <LineContent line={sl.right} tokens={tokens} />
                      </td>
                    </tr>
                  );
                }

                if (sl.kind === "change") {
                  const leftIdx = startIdx + li;
                  const leftTokens = getTokens(tokenMap, leftIdx);
                  const rightIdx = startIdx + li;
                  const rightTokens = getTokens(tokenMap, rightIdx);
                  return (
                    <tr key={`s-${hunkIdx}-${li}`}>
                      <td className="border-r border-stone-100 dark:border-stone-800/60 bg-red-50 dark:bg-red-950/20">
                        <LineNumber num={sl.left.oldNumber} />
                      </td>
                      <td className="border-r border-stone-200 dark:border-stone-700 bg-red-50 dark:bg-red-950/20 px-3 whitespace-pre">
                        <LineContent line={sl.left} tokens={leftTokens} />
                      </td>
                      <td className="border-r border-stone-100 dark:border-stone-800/60 bg-emerald-50 dark:bg-emerald-950/20">
                        <LineNumber num={sl.right.newNumber} />
                      </td>
                      <td className="bg-emerald-50 dark:bg-emerald-950/20 px-3 whitespace-pre">
                        <LineContent line={sl.right} tokens={rightTokens} />
                      </td>
                    </tr>
                  );
                }

                return null;
              }),
            ],
          )}
        </tbody>
      </table>
    </div>
  );
}

function DiffFileBlock({
  file,
  highlighter,
}: { file: ParsedFile; highlighter: Highlighter | null }) {
  const allLines = file.hunks.flat();
  const highlighted = useHighlightedLines(highlighter, allLines, file.language);

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 dark:bg-stone-900/80 border-b border-stone-200 dark:border-stone-800">
        <span className="text-xs font-mono font-medium text-stone-700 dark:text-stone-300 truncate">
          {file.newName.replace(/^b\//, "")}
        </span>
        <FileBadge additions={file.additions} deletions={file.deletions} />
      </div>
      <div className="overflow-x-auto md:hidden">
        <UnifiedView file={file} highlighted={highlighted} />
      </div>
      <div className="overflow-x-auto hidden md:block">
        <SplitView file={file} highlighted={highlighted} />
      </div>
    </div>
  );
}

export function DiffViewer({ files }: DiffViewerProps) {
  const parsed = parseDiffFiles(files);
  const totalAdd = parsed.reduce((s, f) => s + f.additions, 0);
  const totalDel = parsed.reduce((s, f) => s + f.deletions, 0);
  const { highlighter } = useHighlighter();

  const summary = (
    <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400 font-mono">
      <span>
        {parsed.length} file{parsed.length !== 1 ? "s" : ""}
      </span>
      <span className="text-stone-300 dark:text-stone-700">|</span>
      <span className="text-emerald-600 dark:text-emerald-400">
        +{totalAdd}
      </span>
      <span className="text-red-500 dark:text-red-400">-{totalDel}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {summary}
      {parsed.map((file, i) => (
        <DiffFileBlock key={i} file={file} highlighter={highlighter} />
      ))}
    </div>
  );
}
