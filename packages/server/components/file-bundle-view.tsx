"use client";

import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { File, FileCheck, Clock } from "lucide-react";
import { highlightCode } from "@/lib/highlight";

export type FileBundleEntry = { title: string; content: string };

export type FileBundleViewProps = {
  files: FileBundleEntry[];
  expiresAt: string;
  /** Full-page `/f/[id]` vs compact landing mock */
  variant?: "page" | "embed";
};

function FileItem({
  title,
  index,
  active,
  onClick,
}: {
  title: string;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-border/50 px-3 py-2 text-left text-sm transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-mono ${
            active
              ? "bg-foreground/10 text-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {index + 1}
        </span>
        <span className="truncate font-medium">{title}</span>
      </div>
    </button>
  );
}

function ContentView({ content, title }: { content: string; title: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlightCode(content, title).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [content, title]);

  if (!html) {
    return (
      <div className="group relative">
        <div className="overflow-x-auto">
          <pre className="break-words p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
            {content}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-x-auto [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-3 [&_pre]:!text-[13px] [&_pre]:!leading-relaxed [&_pre]:!whitespace-pre">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function MobileFileList({ files }: { files: FileBundleEntry[] }) {
  const defaultValue = files.map((_, i) => `file-${i}`);

  return (
    <Accordion multiple defaultValue={defaultValue} className="w-full">
      {files.map((file, i) => (
        <AccordionItem
          key={i}
          value={`file-${i}`}
          className="border-b border-border/50"
        >
          <AccordionTrigger className="rounded-none bg-muted/40 px-3 py-2.5 hover:bg-muted/60 hover:no-underline [&[data-state=open]>svg]:rotate-180">
            <div className="flex items-center gap-2.5 text-left">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-mono text-muted-foreground">
                {i + 1}
              </span>
              <span className="truncate text-sm font-medium">{file.title}</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <ContentView content={file.content} title={file.title} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function FileBundleView({
  files,
  expiresAt,
  variant = "page",
}: FileBundleViewProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeFile = files[activeIndex];

  const shellClass =
    variant === "page"
      ? "flex h-[calc(100vh-2px)] flex-col"
      : "flex h-[min(22rem,55vh)] min-h-[16rem] flex-col sm:h-[22rem]";

  return (
    <div className={shellClass}>
      <header className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            <span>Expires {new Date(expiresAt).toLocaleString()}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-background md:block">
          {files.map((file, i) => (
            <FileItem
              key={i}
              title={file.title}
              index={i}
              active={i === activeIndex}
              onClick={() => setActiveIndex(i)}
            />
          ))}
        </nav>

        <div className="hidden flex-1 overflow-y-auto bg-background md:block">
          {activeFile ? (
            <div>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-background px-3 py-2">
                <File className="size-4 shrink-0 text-muted-foreground" />
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {activeFile.title}
                </h2>
              </div>
              <ContentView content={activeFile.content} title={activeFile.title} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to view its content
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-background md:hidden">
          <MobileFileList files={files} />
        </div>
      </div>
    </div>
  );
}
