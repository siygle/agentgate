"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, Loader2 } from "lucide-react";

const STORAGE_KEY = "diff4-passphrase";

type EncryptionKeyPromptProps = {
  open: boolean;
  onDecrypt: (passphrase: string, remember: boolean) => void;
  isDecrypting: boolean;
  error: string | null;
};

export function EncryptionKeyPrompt({
  open,
  onDecrypt,
  isDecrypting,
  error,
}: EncryptionKeyPromptProps) {
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase.trim()) return;
    onDecrypt(passphrase.trim(), remember);
  }

  return (
    <Dialog open={open} modal onOpenChange={(open) => { if (!open) return }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-muted">
              <Lock className="size-3.5 text-muted-foreground" />
            </span>
            Enter passphrase
          </DialogTitle>
          <DialogDescription>
            This diff is encrypted. Enter the passphrase to view it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="passphrase">Passphrase</Label>
            <Input
              id="passphrase"
              type="password"
              placeholder="Enter passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            Remember in this browser
          </label>

          {error && (
            <p className="text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={!passphrase.trim() || isDecrypting}
              className="w-full"
            >
              {isDecrypting && <Loader2 className="size-3.5 animate-spin" />}
              {isDecrypting ? "Decrypting..." : "Decrypt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function getStoredPassphrase(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function storePassphrase(passphrase: string): void {
  localStorage.setItem(STORAGE_KEY, passphrase);
}

export function clearStoredPassphrase(): void {
  localStorage.removeItem(STORAGE_KEY);
}
