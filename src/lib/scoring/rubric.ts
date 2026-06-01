// The transparent scoring rubric from REPORADAR.md §4.
// Per the project decision, the LLM PRODUCES the scores — these weights are
// passed to it as a rubric and are reused by the deterministic fallback and to
// compute the blended total. They are NOT used to override AI scores.

export const FIT_WEIGHTS = {
  // ONNX embedding cosine similarity is our strongest relevance signal in
  // deterministic mode and a useful secondary signal with LLM. Amplify it.
  semantic_similarity: 0.55,
  explicit_feature_match: 0.20,
  language_framework_match: 0.10,
  // Manifest/constraint signals are noisy for non-library queries — reduce.
  package_manifest_match: 0.07,
  constraint_satisfaction: 0.05,
  repository_type_match: 0.03,
} as const;

export const FUTURE_WEIGHTS = {
  recent_activity: 0.2,
  release_cadence: 0.15,
  issue_pr_health: 0.15,
  contributor_health: 0.15,
  star_velocity: 0.15,
  documentation_quality: 0.1,
  ecosystem_signal: 0.1,
} as const;

export type FitComponent = keyof typeof FIT_WEIGHTS;
export type FutureComponent = keyof typeof FUTURE_WEIGHTS;

/** Clamp a number into [0, 1]; non-finite -> 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Weighted sum of component sub-scores, clamped to [0, 1]. */
export function weighted(
  components: Record<string, number>,
  weights: Record<string, number>,
): number {
  let sum = 0;
  for (const [k, w] of Object.entries(weights)) {
    sum += clamp01(components[k] ?? 0) * w;
  }
  return clamp01(sum);
}

/**
 * The blended headline score.
 * Fit (semantic relevance) dominates. Future (health) matters but cannot
 * rescue an irrelevant result. Underrated is a small nudge only.
 */
export function computeTotal(
  fit: number,
  future: number,
  underrated: number,
): number {
  return clamp01(0.62 * fit + 0.33 * future + 0.05 * underrated);
}
