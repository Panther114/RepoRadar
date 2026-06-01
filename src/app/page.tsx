import { GitBranch, Radar, Search, Star, TrendingUp } from "lucide-react";
import { SearchForm } from "@/components/SearchForm";

const PILLARS = [
  { icon: Search, label: "semantic fit", desc: "rank by functionality, not keyword luck", color: "text-primary" },
  { icon: TrendingUp, label: "maintenance signal", desc: "activity, releases, issues, contributors", color: "text-accent" },
  { icon: Star, label: "underrated lane", desc: "surface strong projects before they are famous", color: "text-[#d29922]" },
];

export default function HomePage() {
  return (
    // Fills the viewport minus the 3rem header and vertically centers its
    // content so the whole landing page fits in one window without scrolling.
    <main
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-3 px-4 py-3"
      style={{ minHeight: "calc(100dvh - 3rem)" }}
    >
      <div className="animate-in">
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <Radar className="h-3.5 w-3.5 text-primary" />
          OSS repository search, ranked by evidence
        </div>
        <h1
          className="text-balance text-4xl leading-[1.05] tracking-tight sm:text-[3.25rem]"
          style={{ fontFamily: "var(--font-roca)" }}
        >
          Find GitHub repos by what they do.
        </h1>
        <p className="mt-2.5 max-w-2xl text-sm leading-6 text-muted-foreground">
          RepoRadar turns a plain-English need into a ranked, inspectable shortlist with fit,
          maintenance, and hidden-gem signals. Built for developers choosing dependencies.
        </p>
      </div>

      <div className="animate-in rounded-md border border-border bg-card p-3" style={{ animationDelay: "60ms" }}>
        <SearchForm />
      </div>

      <div className="animate-in grid gap-2 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
        {PILLARS.map((p) => (
          <div key={p.label} className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <p.icon className={`h-4 w-4 ${p.color}`} />
              <div className="text-sm font-medium">{p.label}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{p.desc}</div>
          </div>
        ))}
      </div>

      <footer className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        Deterministic funnel first. AI scoring with aspect-aware ranking. Local embeddings.
      </footer>
    </main>
  );
}
