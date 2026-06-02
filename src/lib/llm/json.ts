import type OpenAI from "openai";
import { getLlmClient, LLM_MODEL } from "@/lib/llm/client";
import { env } from "@/lib/env";

// OpenRouter provider routing (not part of the OpenAI type). Pin the fastest
// provider (e.g. Groq) while still allowing fallback if it's unavailable.
const PROVIDER_ROUTING = env.OPENROUTER_PROVIDER
  ? {
      provider: {
        order: env.OPENROUTER_PROVIDER.split(",").map((s) => s.trim()).filter(Boolean),
        allow_fallbacks: true,
      },
    }
  : {};

/** Extract a JSON object from a model response that may wrap it in prose/fences. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    // Fall back to the first {...} or [...] block.
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Run a strict-JSON chat completion against OpenRouter. Returns null if the LLM
 * is disabled or the call/parse fails (callers fall back deterministically).
 *
 * Pass `model` to override the default LLM_MODEL (e.g. use INTENT_MODEL for
 * intent extraction, which needs speed over depth).
 */
export async function chatJson<T = unknown>(args: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<T | null> {
  const client = getLlmClient();
  if (!client) return null;

  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ];
    // Hard timeout so a throttled/slow provider can't stall the whole batch.
    // The caller falls back to the deterministic scorer when this returns null.
    const timeoutMs = args.timeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 12_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const completion = await client.chat.completions.create(
        {
          model: args.model ?? LLM_MODEL,
          temperature: args.temperature ?? 0.2,
          max_tokens: args.maxTokens ?? 1500,
          response_format: { type: "json_object" },
          messages,
          ...PROVIDER_ROUTING,
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        { signal: controller.signal },
      );
      const content = completion.choices[0]?.message?.content ?? "";
      return parseJsonLoose<T>(content);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const model = args.model ?? LLM_MODEL;
    // A 404 / "No endpoints found" means the configured model slug has no
    // available provider on this key. This silently degrades the whole pipeline
    // to the heuristic/deterministic path, so make it SCREAM — a misconfigured
    // model is the single most damaging-yet-invisible failure mode here.
    const status = (error as { status?: number })?.status;
    const msg = error instanceof Error ? error.message : String(error);
    if (status === 404 || /no endpoints found/i.test(msg)) {
      console.error(
        `[llm] ❌ MODEL UNAVAILABLE: "${model}" returned 404 (no provider endpoint on this OpenRouter key). ` +
          `The pipeline is now falling back to the deterministic/heuristic path — search quality will be DEGRADED. ` +
          `Fix OPENROUTER_MODEL / INTENT_MODEL in .env to a model that resolves (e.g. google/gemini-2.5-flash-lite).`,
      );
    } else {
      console.error(`[llm] chatJson failed (model="${model}"):`, error);
    }
    return null;
  }
}
