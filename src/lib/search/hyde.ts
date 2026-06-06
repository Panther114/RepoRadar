import { chatJson } from "@/lib/llm/json";
import { INTENT_MODEL } from "@/lib/llm/client";
import { isLlmEnabled } from "@/lib/env";

/**
 * HyDE (Hypothetical Document Embeddings). Instead of embedding the user's terse
 * query, we ask the model to write the README/description of the *ideal* repo
 * that would perfectly answer the need, then embed THAT. It closes the
 * ask/describe vocabulary gap: a user types "react data table" but real repos
 * say "headless virtualized grid with sorting, filtering, pagination, column
 * pinning". Matching repo-space vocabulary lifts recall, especially for short
 * or vague prompts. One cheap generation, cached by prompt, runs concurrently
 * with candidate search so it is off the critical path.
 */
export async function generateHydeDoc(prompt: string): Promise<string | null> {
  if (String(process.env.HYDE ?? "").toLowerCase() !== "true") return null;
  if (!isLlmEnabled()) return null;
  const timeoutMs = Number(process.env.HYDE_TIMEOUT_MS) || 6_000;

  const raw = await Promise.race([
    chatJson<{ description?: string }>({
      system:
        "You write a concise, vocabulary-rich description of the IDEAL open-source GitHub repository " +
        "that would perfectly satisfy the user's need. Use the concrete terms, library names, features, " +
        "and ecosystem words such a repo's README would actually contain. 2-3 sentences, no preamble. " +
        'Return ONLY JSON: {"description": string}',
      user: `Need: "${prompt}"`,
      temperature: 0,
      maxTokens: 200,
      model: INTENT_MODEL,
      timeoutMs,
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);

  const doc = raw?.description?.trim();
  return doc && doc.length > 10 ? doc : null;
}
