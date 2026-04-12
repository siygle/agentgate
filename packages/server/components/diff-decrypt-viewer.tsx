"use client";

import { useEffect, useState, useCallback } from "react";
import { decrypt, type EncryptedPayload } from "@/lib/crypto";
import {
  EncryptionKeyPrompt,
  getStoredPassphrase,
  storePassphrase,
  clearStoredPassphrase,
} from "@/components/encryption-key-prompt";
import { DiffViewer } from "@/components/diff-viewer";
import { Loader2 } from "lucide-react";

type DecryptedDiff = {
  title: string;
  files: Array<{
    filename: string;
    language?: string;
    patch: string;
  }>;
};

type DiffDecryptViewerProps = {
  encryptedData: EncryptedPayload;
  expiresAt: string;
};

export function DiffDecryptViewer({
  encryptedData,
  expiresAt,
}: DiffDecryptViewerProps) {
  const [diff, setDiff] = useState<DecryptedDiff | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

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

        const parsed = JSON.parse(plaintext) as DecryptedDiff;

        if (
          typeof parsed.title !== "string" ||
          !Array.isArray(parsed.files)
        ) {
          throw new Error("Invalid decrypted data structure");
        }

        setDiff(parsed);

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

  function handlePromptSubmit(
    passphrase: string,
    remember: boolean,
  ) {
    attemptDecrypt(passphrase, remember);
  }

  if (isDecrypting && !diff) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Decrypting...</span>
        </div>
      </div>
    );
  }

  if (diff) {
    return (
      <div className="max-w-5xl w-full mx-auto px-4 py-8 overflow-hidden">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground truncate">
            {diff.title}
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Expires {new Date(expiresAt).toLocaleString()}
          </p>
        </div>
        <DiffViewer files={diff.files} />
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
