import OpenAI from "openai";
import { env, isLlmEnabled } from "@/lib/env";

/**
 * OpenRouter is OpenAI-API compatible, so we use the OpenAI SDK pointed at
 * OpenRouter's base URL. Returns null when the LLM is disabled (NO_LLM_MODE or
 * missing key) — callers must handle the deterministic fallback.
 */
let client: OpenAI | null = null;

export function getLlmClient(): OpenAI | null {
  if (!isLlmEnabled()) return null;
  if (client) return client;
  client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/reporadar/reporadar",
      "X-Title": "RepoRadar",
    },
  });
  return client;
}

export const LLM_MODEL = env.OPENROUTER_MODEL;
