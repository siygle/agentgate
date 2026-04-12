"use client"

import { useState } from "react"
import { motion } from "motion/react"
import { Check, Copy } from "lucide-react"

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="group mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <span className="text-zinc-400 select-none">$</span>
      <span>{command}</span>
      {copied ? (
        <Check className="ml-1 size-3.5 text-emerald-500" />
      ) : (
        <Copy className="ml-1 size-3.5 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
      )}
    </button>
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
          Turn your AI agent's file changes into shareable, beautifully rendered
          web pages. Works with OpenClaw, Hermes, and any AI agent.
        </p>

        <CopyableCommand command="npx skills add djyde/diff4" />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <a
            href="/docs"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-6 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            View docs
          </a>
        </div>
      </motion.div>
    </section>
  )
}
