import { GitBranch, Radar, Search, Star, TrendingUp } from "lucide-react";
import { SearchForm } from "@/components/SearchForm";

const PILLARS = [
  { icon: Search, label: "semantic fit", desc: "rank by functionality, not keyword luck", color: "text-primary" },
  { icon: TrendingUp, label: "maintenance signal", desc: "activity, releases, issues, contributors", color: "text-accent" },
  { icon: Star, label: "underrated lane", desc: "surface strong projects before they are famous", color: "text-[#d29922]" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:py-12">
      <div className="animate-in mb-6">
        <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <Radar className="h-3.5 w-3.5 text-primary" />
          OSS repository search, ranked by evidence
        </div>
        <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-normal sm:text-5xl">
          Find GitHub repos by what they do.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          RepoRadar turns a plain-English need into a ranked, inspectable shortlist with fit,
          maintenance, and hidden-gem signals. Built for developers choosing dependencies.
        </p>
      </div>

      <div className="animate-in rounded-md border border-border bg-card p-3" style={{ animationDelay: "60ms" }}>
        <SearchForm />
      </div>

      <div className="animate-in mt-4 grid gap-2 sm:grid-cols-3" style={{ animationDelay: "120ms" }}>
        {PILLARS.map((p) => (
          <div
            key={p.label}
            className="rounded-md border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <p.icon className={`h-4 w-4 ${p.color}`} />
              <div className="text-sm font-medium">{p.label}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{p.desc}</div>
          </div>
        ))}
      </div>

      <footer className="mt-auto flex items-center gap-2 pt-10 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        Deterministic funnel first. Optional AI scoring. Local embeddings.
      </footer>
    </main>
  );
}
