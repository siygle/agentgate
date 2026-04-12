export function Navbar() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <a
          href="/"
          className="inline-flex items-center rounded-md text-lg font-semibold tracking-tight text-zinc-900 transition-colors hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:text-zinc-50 dark:hover:text-zinc-200 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
        >
          diff4
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/docs"
            className="inline-flex items-center rounded-md text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
          >
            Docs
          </a>
          <a
            href="https://github.com/djyde/diff4"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  )
}
