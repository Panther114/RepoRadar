import type { Metadata } from "next";
import Link from "next/link";
import { Code2, Radar } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoRadar — semantic GitHub repo discovery",
  description:
    "Describe the repository you need in plain language. RepoRadar searches, scores, and explains GitHub projects by fit, future, and underrated potential.",
  openGraph: {
    title: "RepoRadar",
    description:
      "Semantic GitHub repository discovery with explainable Fit, Future, and Underrated scores.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-[#010409]/95 backdrop-blur">
          <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between px-4">
            <Link href="/" className="group inline-flex items-center gap-2 text-foreground">
              <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card">
                <Radar className="h-3.5 w-3.5 text-primary transition-transform duration-300 group-hover:rotate-90" />
              </span>
              <span className="text-sm font-semibold">RepoRadar</span>
            </Link>
            <nav className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link href="/" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
                Search
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
