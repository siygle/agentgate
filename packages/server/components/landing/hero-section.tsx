"use client"

import { useState } from "react"
import { motion } from "motion/react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"

const INSTALL_PROMPT = `Referencing https://diff4.com/docs/cli, help me write a skill that uses diff4.`

function InstallToAgentButton() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="lg"
            className="rounded-lg"
          />
        }
      >
        Install to Agent
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <p className="text-sm text-muted-foreground">Copy this prompt to your AI agent, it will install diff4 for you.</p>
        <DialogDescription className="text-left">
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <code>{INSTALL_PROMPT}</code>
          </pre>
        </DialogDescription>
        <DialogFooter>
          <DialogTrigger render={<Button variant="outline" />}>
            Close
          </DialogTrigger>
          <Button onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function HeroSection() {
  return (
    <section className="relative flex min-h-[50vh] flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-24">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.25, 1, 0.5, 1] }}
        className="relative z-10 flex max-w-2xl flex-col items-center text-center"
      >
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50/80 px-4 py-1.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
          Open source
        </div>

        <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-zinc-900 sm:text-5xl md:text-6xl dark:text-zinc-50">
          Beautiful file previews for AI coding agents
        </h1>

        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Turn your AI agent&apos;s file changes into shareable, beautifully rendered
          web pages. Works with OpenClaw, Hermes, and any AI agent.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <InstallToAgentButton />
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<a href="/docs" />}
          >
            View docs
          </Button>
        </div>
      </motion.div>
    </section>
  )
}
