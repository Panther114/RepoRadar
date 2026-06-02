import { z } from "zod";

/**
 * Server-side environment configuration, validated once at module load.
 * Never import this from client components.
 *
 * During `next build` on Railway (or any CI environment), secrets are not
 * injected — they are runtime-only. Set SKIP_ENV_VALIDATION=1 in the build
 * stage to let the build complete; validation still runs at server startup.
 */
const schema = z.object({
  // Optional during build (SKIP_ENV_VALIDATION=1); required at runtime.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GITHUB_TOKEN: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().optional().default("google/gemini-2.5-flash-lite"),
  // Separate fast model used only for intent extraction (simpler task, needs sub-second latency).
  // Falls back to OPENROUTER_MODEL when unset.
  INTENT_MODEL: z.string().optional().default(""),
  // Comma-separated OpenRouter provider preference order (e.g. "Groq,Cerebras").
  // Empty = let OpenRouter pick. Pinning Groq gives the lowest latency.
  OPENROUTER_PROVIDER: z.string().optional().default(""),
  // LLM is ON by default whenever OPENROUTER_API_KEY is present.
  // Set NO_LLM_MODE=true to force heuristic-only (free/offline) mode.
  NO_LLM_MODE: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  FUNNEL_TOP_N: z
    .string()
    .optional()
    .default("15")
    .transform((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : 15;
    }),
  ANALYZE_CONCURRENCY: z
    .string()
    .optional()
    .default("15")
    .transform((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 15;
    }),
  MAX_CANDIDATES: z
    .string()
    .optional()
    .default("80")
    .transform((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(Math.max(n, 15), 200) : 80;
    }),
  LLM_SCORE_TOP_N: z
    .string()
    .optional()
    .default("20")
    .transform((v) => {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : 20;
    }),
});

const parsed = schema.safeParse(process.env);

// SKIP_ENV_VALIDATION=1 is set in the Dockerfile build stage only.
// At build time Next.js loads every route module to read its exported
// metadata (runtime, dynamic, etc.) — it never calls the handlers, so
// placeholder values are safe and never reach the database.
const skipValidation = process.env.SKIP_ENV_VALIDATION === "1";

let envData: z.infer<typeof schema>;

if (!parsed.success) {
  if (skipValidation) {
    // Provide enough defaults for module initialisation. The placeholder
    // DATABASE_URL is never used because route handlers are not invoked
    // during `next build`.
    const result = schema.safeParse({
      DATABASE_URL: "postgresql://build:skip@localhost:5432/build",
    });
    // result will always succeed because all other fields have defaults.
    envData = result.success ? result.data : ({} as z.infer<typeof schema>);
  } else {
    // Surface a readable error instead of a cryptic stack at first DB/LLM call.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
} else {
  envData = parsed.data;
}

export const env = envData;

/**
 * The LLM is only used when not in NO_LLM_MODE *and* a key is present.
 * In every other case the pipeline runs fully deterministically (free).
 */
export const isLlmEnabled = (): boolean =>
  !env.NO_LLM_MODE && env.OPENROUTER_API_KEY.length > 0;
