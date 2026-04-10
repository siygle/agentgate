"use client";

import matter from "gray-matter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import React, { useCallback, useState, useEffect, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-3 right-3 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition-all duration-200 hover:bg-white/10 hover:text-zinc-300 group-hover/code:opacity-100"
      aria-label="Copy code"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

const LANG_LABELS: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", tsx: "TSX", jsx: "JSX",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", sql: "SQL",
  sh: "Shell", bash: "Bash", zsh: "Zsh", css: "CSS", html: "HTML",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  md: "Markdown", mdx: "MDX", graphql: "GraphQL", dart: "Dart",
  swift: "Swift", kotlin: "Kotlin", java: "Java", c: "C", cpp: "C++",
  dockerfile: "Dockerfile", makefile: "Makefile",
};

function CodeBlock({
  className,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"code"> & { children?: ReactNode; node?: unknown }) {
  void _node;
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match;
  const codeText = String(children).replace(/\n$/, "");

  if (isInline) {
    return <code {...props}>{children}</code>;
  }

  const lang = match ? match[1].toLowerCase() : null;
  const label = lang ? (LANG_LABELS[lang] ?? lang.toUpperCase()) : null;
  const lineCount = codeText.split("\n").length;
  const showLineNumbers = lineCount > 3;

  return (
    <div className="group/code relative not-prose">
      <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-zinc-700/50 bg-zinc-800/60 px-4 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-600/60" />
        </div>
        {label && (
          <span className="ml-2 text-[11px] font-medium tracking-wide text-zinc-400">
            {label}
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-b-xl border border-t-0 border-zinc-700/50 bg-[#0d1117]">
        <div className="flex">
          {showLineNumbers && (
            <div className="sticky left-0 shrink-0 select-none border-r border-zinc-800 bg-[#0d1117] px-3 py-4 text-right font-mono text-xs leading-[1.7] text-zinc-600">
              {codeText.split("\n").map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <pre
            className="!m-0 flex-1 !border-0 !bg-transparent p-4 text-[13px] leading-[1.7]"
            {...(props as Record<string, unknown>)}
          >
            <code className={className}>{children}</code>
          </pre>
        </div>
      </div>
      <CopyButton text={codeText} />
    </div>
  );
}

export function MarkdownViewer({
  title,
  source,
}: {
  title?: string;
  source: string;
}) {
  const [mounted, setMounted] = useState(false);
  const parsed = useMemo(() => matter(source), [source]);
  const content = parsed.content;
  const fm = parsed.data;

  const displayTitle = fm.title ?? title;

  const metaEntries = useMemo(() => {
    const skip = new Set(["title"]);
    return Object.entries(fm).filter(([k]) => !skip.has(k));
  }, [fm]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-24 pt-16 sm:px-8 lg:px-12">
      {displayTitle && (
        <header
          className={`mb-12 transition-all duration-700 ease-out ${mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
        >
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
            {typeof displayTitle === "string" ? displayTitle.replace(/^"|"$/g, "") : String(displayTitle)}
          </h1>
          <div className="mt-4 h-px w-16 bg-zinc-300 dark:bg-zinc-700" />
        </header>
      )}

      {metaEntries.length > 0 && (
        <dl
          className={`mb-12 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 px-6 py-5 text-sm transition-all duration-700 ease-out dark:border-zinc-700/50 dark:bg-zinc-800/40 ${mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
        >
          {metaEntries.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt className="font-medium text-zinc-400 dark:text-zinc-500">{key}</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{String(value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      <div
        className={`prose prose-zinc dark:prose-invert max-w-none transition-all duration-700 delay-150 ease-out ${mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => <>{children}</>,
            code: CodeBlock as never,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
