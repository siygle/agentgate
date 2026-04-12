"use client";

import { useEffect, useState, useCallback } from "react";
import { decrypt, type EncryptedPayload } from "@/lib/crypto";
import {
  EncryptionKeyPrompt,
  getStoredPassphrase,
  storePassphrase,
  clearStoredPassphrase,
} from "@/components/encryption-key-prompt";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { File, FileCheck, Clock, ChevronDown } from "lucide-react";
import { highlightCode } from "@/lib/highlight";

type DecryptedBundle = {
  files: Array<{ title: string; content: string }>;
};

type FileDecryptViewerProps = {
  encryptedData: EncryptedPayload;
  expiresAt: string;
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
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border/50 ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`shrink-0 flex size-5 items-center justify-center rounded text-[10px] font-mono ${
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
      <div className="relative group">
        <div className="overflow-x-auto">
          <pre className="p-3 text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground">
            {content}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group overflow-x-auto [&_pre]:!p-3 [&_pre]:!text-[13px] [&_pre]:!leading-relaxed [&_pre]:!whitespace-pre [&_pre]:!bg-transparent [&_pre]:!m-0">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function MobileFileList({
  files,
}: {
  files: Array<{ title: string; content: string }>;
}) {
  const defaultValue = files.map((_, i) => `file-${i}`);

  return (
    <Accordion multiple defaultValue={defaultValue} className="w-full">
      {files.map((file, i) => (
        <AccordionItem
          key={i}
          value={`file-${i}`}
          className="border-b border-border/50"
        >
          <AccordionTrigger className="px-3 py-2.5 hover:no-underline rounded-none bg-muted/40 hover:bg-muted/60 [&[data-state=open]>svg]:rotate-180">
            <div className="flex items-center gap-2.5 text-left">
              <span className="shrink-0 flex size-5 items-center justify-center rounded text-[10px] font-mono bg-muted text-muted-foreground">
                {i + 1}
              </span>
              <span className="text-sm font-medium truncate">{file.title}</span>
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

export function FileDecryptViewer({
  encryptedData,
  expiresAt,
}: FileDecryptViewerProps) {
  const [bundle, setBundle] = useState<DecryptedBundle | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const attemptDecrypt = useCallback(
    async (passphrase: string, remember: boolean) => {
      setIsDecrypting(true);
      setError(null);

      try {
        const plaintext = await decrypt(
          encryptedData.ciphertext,
          encryptedData.iv,
          encryptedData.salt,
          passphrase,
        );

        const parsed = JSON.parse(plaintext) as DecryptedBundle;

        if (!Array.isArray(parsed.files)) {
          throw new Error("Invalid decrypted data structure");
        }

        setBundle(parsed);

        if (remember) {
          storePassphrase(passphrase);
        }
      } catch {
        setError(
          "Decryption failed. The passphrase is incorrect or the data is corrupted.",
        );
        clearStoredPassphrase();
        setShowPrompt(true);
      } finally {
        setIsDecrypting(false);
      }
    },
    [encryptedData],
  );

  useEffect(() => {
    const stored = getStoredPassphrase();
    if (stored) {
      attemptDecrypt(stored, false);
    } else {
      setShowPrompt(true);
    }
  }, [attemptDecrypt]);

  function handlePromptSubmit(passphrase: string, remember: boolean) {
    attemptDecrypt(passphrase, remember);
  }

  if (isDecrypting && !bundle) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg
            className="size-5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="32"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-sm">Decrypting...</span>
        </div>
      </div>
    );
  }

  if (bundle) {
    const activeFile = bundle.files[activeIndex];

    return (
      <div className="flex flex-col h-[calc(100vh-2px)]">
        <header className="shrink-0 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <FileCheck className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">
                {bundle.files.length} file{bundle.files.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <Clock className="size-3" />
              <span>Expires {new Date(expiresAt).toLocaleString()}</span>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <nav className="hidden md:block w-56 shrink-0 border-r border-border bg-background overflow-y-auto">
            {bundle.files.map((file, i) => (
              <FileItem
                key={i}
                title={file.title}
                index={i}
                active={i === activeIndex}
                onClick={() => setActiveIndex(i)}
              />
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto bg-background md:block hidden">
            {activeFile ? (
              <div>
                <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-background border-b border-border/50">
                  <File className="size-4 text-muted-foreground shrink-0" />
                  <h2 className="text-sm font-semibold text-foreground truncate">
                    {activeFile.title}
                  </h2>
                </div>
                <ContentView content={activeFile.content} title={activeFile.title} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a file to view its content
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-background md:hidden">
            <MobileFileList files={bundle.files} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <EncryptionKeyPrompt
      open={showPrompt}
      onDecrypt={handlePromptSubmit}
      isDecrypting={isDecrypting}
      error={error}
    />
  );
}
