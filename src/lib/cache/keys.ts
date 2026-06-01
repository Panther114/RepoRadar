import { createHash } from "node:crypto";

/** Stable SHA-256 hex of a string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hash of any JSON-serializable value (key order-insensitive for objects). */
export function hashJson(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * Cache key for a single repo's model analysis, per REPORADAR.md §5 rule 4:
 * keyed by repo full name, pushed_at, README hash, and the query intent hash.
 */
export function analysisInputHash(params: {
  fullName: string;
  pushedAt: string | null;
  readmeHash: string | null;
  intentHash: string;
  model: string;
}): string {
  return sha256(
    [
      params.fullName,
      params.pushedAt ?? "",
      params.readmeHash ?? "",
      params.intentHash,
      params.model,
    ].join("|"),
  );
}
