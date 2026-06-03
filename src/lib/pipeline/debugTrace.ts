import fs from "fs";
import path from "path";

/**
 * Rich, local-only search debug tracing. Writes one JSON object per event to
 * `logs/search-debug.jsonl` (the whole `logs/` dir is gitignored) so we can
 * inspect *why* the funnel kept or dropped a candidate — per-candidate
 * similarities, aspect sims, prefilter scores, and final rank scores. This is a
 * diagnostics aid for tuning search quality, NOT user-facing output.
 *
 * Gated by SEARCH_DEBUG=true to keep it zero-cost in production.
 */
const ENABLED = String(process.env.SEARCH_DEBUG ?? "").toLowerCase() === "true";
const LOG_DIR = path.join(process.cwd(), "logs");
const FILE = path.join(LOG_DIR, "search-debug.jsonl");

export const searchDebugEnabled = (): boolean => ENABLED;

export function debugTrace(event: string, searchQueryId: string, data: Record<string, unknown>): void {
  if (!ENABLED) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      FILE,
      JSON.stringify({ ts: new Date().toISOString(), event, searchQueryId, ...data }) + "\n",
    );
  } catch {
    /* best-effort only */
  }
}

export const SEARCH_DEBUG_PATH = FILE;
