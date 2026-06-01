import { z } from "zod";

/**
 * Server-side environment configuration, validated once at module load.
 * Never import this from client components.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GITHUB_TOKEN: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().optional().default("meta-llama/llama-3.3-70b-instruct"),
  // Comma-separated OpenRouter provider preference order (e.g. "Groq,Cerebras").
  // Empty = let OpenRouter pick. Pinning Groq gives the lowest latency.
  OPENROUTER_PROVIDER: z.string().optional().default(""),
  NO_LLM_MODE: z
    .string()
    .optional()
    .default("true")
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

if (!parsed.success) {
  // Surface a readable error instead of a cryptic stack at first DB/LLM call.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/**
 * The LLM is only used when not in NO_LLM_MODE *and* a key is present.
 * In every other case the pipeline runs fully deterministically (free).
 */
export const isLlmEnabled = (): boolean =>
  !env.NO_LLM_MODE && env.OPENROUTER_API_KEY.length > 0;
