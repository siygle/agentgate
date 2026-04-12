export function Navbar() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <a href="/" className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          diff4
        </a>
        <div className="flex items-center gap-6">
          <a
            href="/docs"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Docs
          </a>
          <a
            href="https://github.com/djyde/diff4"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  )
}
