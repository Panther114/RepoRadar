/**
 * Lightweight structured logger for the RepoRadar pipeline.
 *
 * - Always writes to stdout/stderr (picked up by `pnpm dev` terminal)
 * - Also appends JSON-lines to `logs/pipeline.log` in the project root
 * - Safe to import in server-only code (never in client components)
 */

import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "pipeline.log");

// Ensure log directory exists (sync, runs once per module load)
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* ignore */
}

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: Level;
  tag: string;
  msg: string;
  data?: unknown;
  error?: { message: string; stack?: string };
  durationMs?: number;
}

function write(entry: LogEntry): void {
  const line = JSON.stringify(entry);

  // Console output — pretty prefix
  const prefix = `[${entry.ts}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.tag}]`;
  const out = `${prefix} ${entry.msg}${entry.data !== undefined ? " " + JSON.stringify(entry.data) : ""}${entry.error ? " ERR:" + entry.error.message : ""}`;

  if (entry.level === "error" || entry.level === "warn") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }

  // File output — JSON-lines (best-effort, never throws)
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* ignore write errors */
  }
}

function makeEntry(
  level: Level,
  tag: string,
  msg: string,
  data?: unknown,
  err?: unknown,
): LogEntry {
  const entry: LogEntry = { ts: new Date().toISOString(), level, tag, msg };
  if (data !== undefined) entry.data = data;
  if (err instanceof Error) {
    entry.error = { message: err.message, stack: err.stack };
  } else if (err !== undefined) {
    entry.error = { message: String(err) };
  }
  return entry;
}

export function createLogger(tag: string) {
  return {
    debug: (msg: string, data?: unknown) => write(makeEntry("debug", tag, msg, data)),
    info: (msg: string, data?: unknown) => write(makeEntry("info", tag, msg, data)),
    warn: (msg: string, data?: unknown) => write(makeEntry("warn", tag, msg, data)),
    error: (msg: string, err?: unknown, data?: unknown) =>
      write(makeEntry("error", tag, msg, data, err)),

    /** Start a timer; call the returned fn to log duration. */
    time: (msg: string, data?: unknown): (() => void) => {
      const start = Date.now();
      write(makeEntry("info", tag, `→ ${msg}`, data));
      return () => {
        const entry = makeEntry("info", tag, `✓ ${msg}`);
        entry.durationMs = Date.now() - start;
        write(entry);
      };
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Path to the log file, for surfacing in the UI / CLI. */
export const LOG_FILE_PATH = LOG_FILE;
