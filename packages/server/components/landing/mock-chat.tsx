"use client"

import dynamic from "next/dynamic"
import { motion, useReducedMotion } from "motion/react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { FileEdit, Files, GitCommitHorizontal } from "lucide-react"

const DiffViewer = dynamic(
  () => import("@/components/diff-viewer").then((m) => m.DiffViewer),
  { ssr: false }
)

const FileBundleView = dynamic(
  () => import("@/components/file-bundle-view").then((m) => m.FileBundleView),
  { ssr: false }
)

type ChatMessage = {
  role: "agent" | "user"
  text: string
}

type Scenario = {
  id: string
  label: string
  /** Shown in the fake browser chrome (matches the link in the chat). */
  browserBar: string
  messages: ChatMessage[]
  /** Unified diff preview (`/d/…`); omit when using `bundleFiles`. */
  files?: { filename: string; language: string; patch: string }[]
  /** File bundle preview (`/f/…`), same layout as the real viewer. */
  bundleFiles?: { title: string; content: string }[]
  bundleExpiresAt?: string
}

const scenarios: Scenario[] = [
  {
    id: "docs",
    label: "Edit files",
    browserBar: "diff4.com/dfj3ds",
    messages: [
      {
        role: "agent",
        text: "OK, I've edited the documentation for you.",
      },
      {
        role: "user",
        text: "Use diff4 to see what you've changed.",
      },
      {
        role: "agent",
        text: "Sure. Please review this on https://diff4.com/dfj3ds",
      },
    ],
    files: [
      {
        filename: "README.md",
        language: "markdown",
        patch: `--- a/README.md
+++ b/README.md
@@ -1,6 +1,8 @@
 # diff4
 
-Better way to see what your AI agent changes.
+A better way to see what your AI agent changes.
 
-## Getting started
+Share encrypted diffs and files. See exactly what changed, instantly.
 
+## Getting started
+
 Run \`npx diff4 share\` to share a diff.`,
      },
    ],
  },
  {
    id: "commit",
    label: "Commit code",
    browserBar: "diff4.com/a8x2kq",
    messages: [
      {
        role: "agent",
        text: "I've committed the new auth module with 3 files changed.",
      },
      {
        role: "user",
        text: "Use diff4 to see your commit changes.",
      },
      {
        role: "agent",
        text: "Done. Here's the link: https://diff4.com/a8x2kq",
      },
    ],
    files: [
      {
        filename: "src/auth/session.ts",
        language: "typescript",
        patch: `--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,8 +1,12 @@
-import { verify } from "./jwt";
+import { verify, decode } from "./jwt";
 
-export function getSession(token: string) {
-  return verify(token);
+export async function getSession(token: string) {
+  const payload = await verify(token);
+  return {
+    ...payload,
+    isNew: payload.iat > Date.now() / 1000 - 60,
+  };
 }
 
+export function decodeSession(token: string) {
+  return decode(token);
+}`,
      },
      {
        filename: "src/auth/jwt.ts",
        language: "typescript",
        patch: `--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -5,7 +5,7 @@ const SECRET = process.env.JWT_SECRET;
 
 export async function verify(token: string) {
   const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));
-  return payload;
+  return payload as SessionPayload;
 }
 
-export function decode(token: string) {
+export async function decode(token: string) {
   const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET), { algorithms: ["HS256"] });`,
      },
    ],
  },
  {
    id: "multi",
    label: "File bundle",
    browserBar: "diff4.com/f/m7k9nz",
    messages: [
      {
        role: "agent",
        text: "Here are the env template, Dockerfile, and deploy note—pasting all three below.",
      },
      {
        role: "user",
        text: "That's awkward to read in chat—put them on diff4",
      },
      {
        role: "agent",
        text: "Done. Browse them here: https://diff4.com/f/m7k9nz",
      },
    ],
    bundleExpiresAt: "2030-12-31T23:59:59.000Z",
    bundleFiles: [
      {
        title: "config/deploy.env.example",
        content: `# Copy to .env for production
DATABASE_URL=postgresql://user:pass@host:5432/render4
NEXT_PUBLIC_BASE_URL=https://diff4.com
JWT_SECRET=change-me`,
      },
      {
        title: "Dockerfile",
        content: `FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
`,
      },
      {
        title: "docs/DEPLOY.md",
        content: `# Deploy

1. Set secrets from \`config/deploy.env.example\`.
2. Build the image: \`docker build -t diff4 .\`
3. Run with your orchestrator; health check on port 3000.
`,
      },
    ],
  },
]

function ChatBubble({ message }: { message: ChatMessage }) {
  const isAgent = message.role === "agent"
  const parts = message.text.split(/(https?:\/\/[^\s]+)/g)

  return (
    <div className={`flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div className="flex max-w-[85%] flex-col">
        <span
          className={`mb-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500 ${isAgent ? "text-left" : "text-right"
            }`}
        >
          {isAgent ? "Agent" : "You"}
        </span>
        <div
          className={`rounded-2xl px-4 py-3 ${isAgent
              ? "rounded-tl-md bg-zinc-100 dark:bg-zinc-800"
              : "rounded-tr-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            }`}
        >
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {parts.map((part, i) =>
              /^https?:\/\//.test(part) ? (
                <span key={i} className="rounded bg-emerald-500/10 px-1 py-0.5 font-mono text-[13px] text-emerald-600 dark:text-emerald-400">
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

export function MockChat() {
  const reduceMotion = useReducedMotion()

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <Tabs defaultValue="docs">
        <div className="flex justify-center">
          <TabsList variant="line">
            <TabsTrigger value="docs">
              <FileEdit className="size-3.5" />
              Edit files
            </TabsTrigger>
            <TabsTrigger value="commit">
              <GitCommitHorizontal className="size-3.5" />
              Commit code
            </TabsTrigger>
            <TabsTrigger value="multi">
              <Files className="size-3.5" />
              Pick files
            </TabsTrigger>
          </TabsList>
        </div>

        {scenarios.map((scenario) => (
          <TabsContent key={scenario.id} value={scenario.id} className="mt-6 flex flex-col gap-6">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                duration: reduceMotion ? 0 : 0.6,
                ease: [0.25, 1, 0.5, 1],
              }}
              className="flex flex-col gap-6"
            >
              {scenario.messages.map((msg, i) => (
                <ChatBubble key={i} message={msg} />
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{
                duration: reduceMotion ? 0 : 0.6,
                delay: reduceMotion ? 0 : 0.3,
                ease: [0.25, 1, 0.5, 1],
              }}
              className="-mx-8 w-[calc(100%+4rem)] max-w-none overflow-hidden rounded-xl border border-zinc-200 sm:-mx-20 sm:w-[calc(100%+10rem)] dark:border-zinc-800"
            >
              <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex gap-1.5">
                  <div className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                  <div className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                  <div className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                </div>
                <div className="flex-1 truncate rounded-md bg-white px-3 py-1 text-left text-xs text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                  {scenario.browserBar}
                </div>
              </div>
              <div className="bg-white p-0 dark:bg-black">
                {scenario.bundleFiles?.length && scenario.bundleExpiresAt ? (
                  <FileBundleView
                    files={scenario.bundleFiles}
                    expiresAt={scenario.bundleExpiresAt}
                    variant="embed"
                  />
                ) : scenario.files ? (
                  <div className="p-4">
                    <DiffViewer files={scenario.files} />
                  </div>
                ) : null}
              </div>
            </motion.div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
