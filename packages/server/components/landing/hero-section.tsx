"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const INSTALL_PROMPT = `Referencing https://diff4.com/docs/cli, help me write a skill that uses diff4.`

const TRY_IT_PROMPT = "show me the skill file you created use diff4"

function InstallToAgentButton() {
  const [copiedInstall, setCopiedInstall] = useState(false)
  const [copiedTryIt, setCopiedTryIt] = useState(false)

  const handleCopyInstall = async () => {
    await navigator.clipboard.writeText(INSTALL_PROMPT)
    setCopiedInstall(true)
    setTimeout(() => setCopiedInstall(false), 2000)
  }

  const handleCopyTryIt = async () => {
    await navigator.clipboard.writeText(TRY_IT_PROMPT)
    setCopiedTryIt(true)
    setTimeout(() => setCopiedTryIt(false), 2000)
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
      <DialogContent
        showCloseButton={false}
        className="gap-0 pb-0 sm:max-w-md"
      >
        <DialogHeader className="text-left">
          <DialogTitle>Install to Agent</DialogTitle>
          <DialogDescription>
            Copy this prompt and paste it into your AI agent—it will set up diff4 for you.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4 mb-4">
          <div className="space-y-2">
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <code>{INSTALL_PROMPT}</code>
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleCopyInstall}
            >
              {copiedInstall ? (
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
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Try it</p>
            <p className="text-sm text-muted-foreground">
              After the skill is set up, send this follow-up to verify it.
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <code>{TRY_IT_PROMPT}</code>
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleCopyTryIt}
            >
              {copiedTryIt ? (
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
          </div>
        </div>
        <DialogFooter className="mb-0 py-2.5">
          <DialogTrigger render={<Button variant="outline" />}>
            Close
          </DialogTrigger>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function HeroSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative flex min-h-[50vh] flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-24">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: reduceMotion ? 0 : 0.7,
          ease: [0.25, 1, 0.5, 1],
        }}
        className="relative z-10 flex max-w-2xl flex-col items-center text-center"
      >
        <a
          href="https://github.com/djyde/diff4"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50/80 px-4 py-1.5 text-sm text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
        >
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
          Open source
        </a>

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
