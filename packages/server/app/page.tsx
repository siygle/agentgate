import { Navbar } from "@/components/landing/navbar"
import { HeroSection } from "@/components/landing/hero-section"
import { MockChat } from "@/components/landing/mock-chat"
import { SecuritySection } from "@/components/landing/security-section"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-white dark:bg-black">
      <Navbar />
      <HeroSection />
      <div className="-mt-10 mb-32 flex w-full justify-center px-6">
        <MockChat />
      </div>
      <SecuritySection />
      <footer className="pb-8 pt-4 text-center text-sm text-zinc-400 dark:text-zinc-600">
        Made with &hearts; by{" "}
        <a
          href="https://x.com/randyloop"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center underline underline-offset-4 transition-colors hover:text-zinc-600 focus-visible:rounded-sm focus-visible:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:hover:text-zinc-400 dark:focus-visible:text-zinc-300 dark:focus-visible:ring-zinc-500/50 dark:focus-visible:ring-offset-black"
        >
          Randy Lu
        </a>
      </footer>
    </div>
  )
}
