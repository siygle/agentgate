"use client"

import { motion, useReducedMotion } from "motion/react"
import { Shield, Lock, Eye, KeyRound } from "lucide-react"

const features = [
  {
    icon: Lock,
    title: "AES-256-GCM",
    description: "Military-grade encryption for every diff and file you share.",
  },
  {
    icon: Eye,
    title: "Zero-knowledge server",
    description: "Files are encrypted on your machine before upload. The server only stores ciphertext.",
  },
  {
    icon: KeyRound,
    title: "Passphrase-protected",
    description: "Only someone with the passphrase can decrypt and view your changes.",
  },
]

export function SecuritySection() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="w-full border-t border-zinc-100 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{
            duration: reduceMotion ? 0 : 0.6,
            ease: [0.25, 1, 0.5, 1],
          }}
          className="flex max-w-lg flex-col items-center text-center"
        >
          <div className="mb-5 flex size-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <Shield className="size-4.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            Your code stays yours
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Everything you share is encrypted end-to-end before it leaves your machine.
            Not even we can read it.
          </p>
        </motion.div>

        <div className="mt-14 grid w-full max-w-3xl gap-x-8 gap-y-10 sm:grid-cols-3">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                duration: reduceMotion ? 0 : 0.5,
                delay: reduceMotion ? 0 : 0.15 * (i + 1),
                ease: [0.25, 1, 0.5, 1],
              }}
              className="flex flex-col items-center text-center"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                <feature.icon className="size-4 text-zinc-600 dark:text-zinc-300" />
              </div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: reduceMotion ? 0 : 0.6,
              delay: reduceMotion ? 0 : 0.6,
            }}
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50/80 px-4 py-1.5 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-500"
          >
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            PBKDF2 · 600,000 iterations · Web Crypto API
          </motion.div>
          <motion.a
            href="/docs/api-encryption"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{
              duration: reduceMotion ? 0 : 0.6,
              delay: reduceMotion ? 0 : 0.7,
            }}
            className="inline-flex items-center rounded-sm text-sm text-zinc-500 underline underline-offset-4 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
          >
            Learn more about encryption →
          </motion.a>
        </div>
      </div>
    </section>
  )
}
