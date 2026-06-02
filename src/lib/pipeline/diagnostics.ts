import fs from "fs";
import path from "path";
import type { SearchDiagnostics } from "@/lib/types";

const LOG_DIR = path.join(process.cwd(), "logs");
const FILE = path.join(LOG_DIR, "search-diagnostics.jsonl");

export function writeSearchDiagnostics(diagnostics: SearchDiagnostics): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(diagnostics) + "\n");
  } catch {
    /* diagnostics are best-effort only */
  }
}

export const SEARCH_DIAGNOSTICS_PATH = FILE;
