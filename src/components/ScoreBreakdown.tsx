import { FIT_WEIGHTS, FUTURE_WEIGHTS } from "@/lib/scoring/rubric";

const FIT_LABELS: Record<string, string> = {
  semantic_similarity: "Semantic similarity",
  explicit_feature_match: "Explicit feature match",
  language_framework_match: "Language / framework",
  package_manifest_match: "Package manifest",
  constraint_satisfaction: "Constraint satisfaction",
  repository_type_match: "Repository type",
};
const FUTURE_LABELS: Record<string, string> = {
  recent_activity: "Recent activity",
  release_cadence: "Release cadence",
  issue_pr_health: "Issue / PR health",
  contributor_health: "Contributor health",
  star_velocity: "Star velocity",
  documentation_quality: "Documentation",
  ecosystem_signal: "Ecosystem signal",
};

function Row({ label, weight, value }: { label: string; weight: number; value: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-input">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round((value ?? 0) * 100)}%` }}
        />
      </div>
      <span className="w-9 text-right tabular-nums">{Math.round((value ?? 0) * 100)}</span>
      <span className="w-10 text-right text-[10px] text-muted-foreground">×{weight}</span>
    </div>
  );
}

export function ScoreBreakdown({
  fitComponents,
  futureComponents,
}: {
  fitComponents: Record<string, number>;
  futureComponents: Record<string, number>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <div className="mb-1 text-xs font-semibold text-primary">
          Fit components
        </div>
        {Object.entries(FIT_WEIGHTS).map(([k, w]) => (
          <Row key={k} label={FIT_LABELS[k] ?? k} weight={w} value={fitComponents?.[k] ?? 0} />
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="mb-1 text-xs font-semibold text-accent">
          Future components
        </div>
        {Object.entries(FUTURE_WEIGHTS).map(([k, w]) => (
          <Row key={k} label={FUTURE_LABELS[k] ?? k} weight={w} value={futureComponents?.[k] ?? 0} />
        ))}
      </div>
    </div>
  );
}
