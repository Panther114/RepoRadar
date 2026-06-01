import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import Image from "next/image";
import { Code2 } from "lucide-react";
import "./globals.css";

// Roca is used ONLY for the home-page slogan (see page.tsx). Exposed as a CSS
// variable so it can be opted-into per element rather than applied globally.
const roca = localFont({
  src: "../../public/roca.ttf",
  variable: "--font-roca",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:2000"),
  title: "RepoRadar — semantic GitHub repo discovery",
  description:
    "Describe the repository you need in plain language. RepoRadar searches, scores, and explains GitHub projects by fit, future, and underrated potential.",
  icons: {
    // Optimized variants generated from public/icon.png (the 2 MB source is too
    // heavy for a favicon). Browsers pick the best size; social cards use the full art.
    icon: [
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-64.png", type: "image/png", sizes: "64x64" },
    ],
    shortcut: "/icon-32.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "RepoRadar",
    description:
      "Semantic GitHub repository discovery with explainable Fit, Future, and Underrated scores.",
    type: "website",
    images: [{ url: "/icon.png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${roca.variable}`}>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-[#010409]/95 backdrop-blur">
          <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between px-4">
            <Link href="/" className="group inline-flex items-center gap-2 text-foreground">
              <span className="relative inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
                <Image
                  src="/icon.png"
                  alt="RepoRadar logo"
                  width={24}
                  height={24}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                  priority
                />
              </span>
              <span className="text-sm font-semibold">RepoRadar</span>
            </Link>
            <nav className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link href="/" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
                Search
              </Link>
              <Link href="/about" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
                About
              </Link>
              <Link href="/api/health" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
                Status
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground"
              >
                <Code2 className="h-3.5 w-3.5" /> GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
