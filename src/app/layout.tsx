import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import Image from "next/image";
import { Code2 } from "lucide-react";
import pkg from "../../package.json";
import "./globals.css";
import { VisitorBeacon } from "@/components/VisitorBeacon";
import { getHeaderMetrics } from "@/lib/siteMetrics";

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
  const metricsPromise = getHeaderMetrics();

  return (
    <html lang="en" className={`h-full antialiased ${roca.variable}`}>
      <body className="flex min-h-full flex-col">
        <Header metricsPromise={metricsPromise} />
        <VisitorBeacon />
        {children}
      </body>
    </html>
  );
}

async function Header({
  metricsPromise,
}: {
  metricsPromise: Promise<{ userCount: number | null; requestCount: number | null }>;
}) {
  const metrics = await metricsPromise;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-[#010409]/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/" className="group inline-flex items-center gap-2 text-foreground">
          {/* 90% of h-12 (48px) = ~43px */}
          <span className="relative inline-flex h-[43px] w-[43px] shrink-0 items-center justify-center overflow-hidden rounded-md">
            <Image
              src="/icon.png"
              alt="RepoRadar logo"
              width={43}
              height={43}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
              priority
            />
          </span>
          <span className="text-sm font-semibold">RepoRadar</span>
          <span className="font-mono text-[10px] text-muted-foreground">v{pkg.version}</span>
          <MetricPill label="User Count" value={metrics.userCount} />
          <MetricPill label="Request Count" value={metrics.requestCount} />
        </Link>
        <nav className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
            Search
          </Link>
          <Link href="/about" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
            About
          </Link>
          <Link href="/status" className="rounded-md px-2 py-1.5 transition-colors hover:bg-card hover:text-foreground">
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
  );
}

function MetricPill({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
      {label} {formatMetric(value)}
    </span>
  );
}

function formatMetric(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}
