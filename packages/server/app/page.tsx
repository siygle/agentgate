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
      <footer className="pb-8 pt-4 text-center text-sm text-neutral-400 dark:text-neutral-600">
        made with &hearts; by{" "}
        <a
          href="https://x.com/randyloop"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 transition-colors hover:text-neutral-600 dark:hover:text-neutral-400"
        >
          Randy Lu
        </a>
      </footer>
    </div>
  )
}
