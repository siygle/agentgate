import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClientRootProvider } from "@/components/client-root-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "diff4 — Beautiful diffs for AI coding agents",
  description:
    "Turn your AI agent's code changes into shareable, beautifully rendered web pages. Works with OpenClaw, Hermes, and any coding agent — no more ugly terminal diffs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        <ClientRootProvider>{children}</ClientRootProvider>
      </body>
    </html>
  );
}
