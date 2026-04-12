import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClientRootProvider } from "@/components/client-root-provider";
import { OG_IMAGE_PATH, siteOrigin } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const defaultTitle = "diff4 — Beautiful file previews for AI coding agents";
const defaultDescription =
  "Turn your AI agent's file changes into shareable, beautifully rendered web pages. Works with OpenClaw, Hermes, and any coding agent — no more ugly terminal diffs.";

export const metadata: Metadata = {
  metadataBase: new URL(`${siteOrigin()}/`),
  title: defaultTitle,
  description: defaultDescription,
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    siteName: "diff4",
    locale: "en_US",
    type: "website",
    images: [
      { url: OG_IMAGE_PATH, width: 1200, height: 630, alt: "diff4" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
    images: [OG_IMAGE_PATH],
  },
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
