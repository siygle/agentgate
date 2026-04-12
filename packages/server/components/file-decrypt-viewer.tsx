"use client";

import { useEffect, useState, useCallback } from "react";
import { decrypt, type EncryptedPayload } from "@/lib/crypto";
import {
  EncryptionKeyPrompt,
  getStoredPassphrase,
  storePassphrase,
  clearStoredPassphrase,
} from "@/components/encryption-key-prompt";
import { FileBundleView } from "@/components/file-bundle-view";

type DecryptedBundle = {
  files: Array<{ title: string; content: string }>;
};

type FileDecryptViewerProps = {
  encryptedData: EncryptedPayload;
  expiresAt: string;
};

export function FileDecryptViewer({
  encryptedData,
  expiresAt,
}: FileDecryptViewerProps) {
  const [bundle, setBundle] = useState<DecryptedBundle | null>(null);
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
      <div className="flex min-h-[40vh] items-center justify-center">
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
    return (
      <FileBundleView
        files={bundle.files}
        expiresAt={expiresAt}
        variant="page"
      />
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
