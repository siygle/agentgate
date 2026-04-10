import { parse } from "diff2html";

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
  hunks: ParsedLine[][];
  additions: number;
  deletions: number;
};

function parseDiffFiles(files: DiffFileEntry[]): ParsedFile[] {
  const combined = files.map((f) => f.patch).join("\n");
  const parsed = parse(combined);

  return parsed.map((file) => ({
    oldName: file.oldName,
    newName: file.newName,
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
    <span className="inline-block w-10 text-right pr-3 text-[11px] leading-5 select-none text-stone-400 dark:text-stone-600 font-mono">
      {num ?? ""}
    </span>
  );
}

function DiffFileBlock({ file }: { file: ParsedFile }) {
  return (
    <div className="rounded-lg overflow-hidden border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 dark:bg-stone-900/80 border-b border-stone-200 dark:border-stone-800">
        <span className="text-xs font-mono font-medium text-stone-700 dark:text-stone-300 truncate">
          {file.newName.replace(/^b\//, "")}
        </span>
        <FileBadge additions={file.additions} deletions={file.deletions} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] font-mono leading-5">
          <tbody>
            {file.hunks.flatMap((hunk, hunkIdx) => [
              hunkIdx > 0 ? (
                <tr key={`sep-${hunkIdx}`} className="bg-sky-50/60 dark:bg-sky-950/30">
                  <td colSpan={3} className="px-4 py-1 text-[11px] text-sky-600 dark:text-sky-400 select-none tracking-wider">
                    &middot;&middot;&middot;
                  </td>
                </tr>
              ) : null,
              ...hunk.map((line, lineIdx) => (
                <tr
                  key={`${hunkIdx}-${lineIdx}`}
                  className={
                    line.type === "insert"
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : line.type === "delete"
                        ? "bg-red-50 dark:bg-red-950/30"
                        : "hover:bg-stone-50 dark:hover:bg-stone-900/40"
                  }
                >
                  <td className="border-r border-stone-100 dark:border-stone-800/60 w-12 min-w-12">
                    <LineNumber num={line.oldNumber} />
                  </td>
                  <td className="border-r border-stone-100 dark:border-stone-800/60 w-12 min-w-12">
                    <LineNumber num={line.newNumber} />
                  </td>
                  <td className="px-4 whitespace-pre">
                    <span
                      className={
                        line.type === "insert"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : line.type === "delete"
                            ? "text-red-600 dark:text-red-400"
                            : "text-stone-700 dark:text-stone-300"
                      }
                    >
                      {line.type === "insert" ? "+" : line.type === "delete" ? "-" : " "}
                    </span>
                    {line.content}
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DiffViewer({ files }: DiffViewerProps) {
  const parsed = parseDiffFiles(files);
  const totalAdd = parsed.reduce((s, f) => s + f.additions, 0);
  const totalDel = parsed.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400 font-mono">
        <span>{parsed.length} file{parsed.length !== 1 ? "s" : ""}</span>
        <span className="text-stone-300 dark:text-stone-700">|</span>
        <span className="text-emerald-600 dark:text-emerald-400">+{totalAdd}</span>
        <span className="text-red-500 dark:text-red-400">-{totalDel}</span>
      </div>
      {parsed.map((file, i) => (
        <DiffFileBlock key={i} file={file} />
      ))}
    </div>
  );
}
