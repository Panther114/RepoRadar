import { z } from "zod";
import type { Constraints, Intent, ProjectType, SearchFilters } from "@/lib/types";
import { chatJson } from "@/lib/llm/json";
import { INTENT_MODEL } from "@/lib/llm/client";

const PROJECT_TYPES: ProjectType[] = [
  "library", "framework", "cli", "app", "template", "demo", "research",
  "tutorial", "awesome-list", "plugin", "extension", "dataset", "any",
];

const STOPWORDS = new Set([
  "find", "a", "an", "the", "for", "with", "and", "or", "to", "of", "in", "on",
  "that", "is", "are", "be", "me", "i", "want", "need", "looking", "some",
  "good", "best", "maintained", "active", "actively", "open", "source",
  "project", "projects", "repo", "repos", "repository", "library", "lib",
  "using", "built", "like", "alternative", "alternatives", "support",
]);

const KNOWN_LANGUAGES: Record<string, string> = {
  typescript: "TypeScript", javascript: "JavaScript", python: "Python",
  rust: "Rust", go: "Go", golang: "Go", java: "Java", kotlin: "Kotlin",
  swift: "Swift", ruby: "Ruby", php: "PHP", "c++": "C++", cpp: "C++",
  "c#": "C#", csharp: "C#", elixir: "Elixir", scala: "Scala", dart: "Dart",
};

const intentSchema = z.object({
  normalizedPrompt: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  requiredFeatures: z.array(z.string()).optional(),
  language: z.string().nullable().optional(),
  licenses: z.array(z.string()).optional(),
  pushedWithinDays: z.number().nullable().optional(),
  projectType: z.string().optional(),
  includeSmallProjects: z.boolean().optional(),
  minStars: z.number().nullable().optional(),
  maxStars: z.number().nullable().optional(),
  queries: z.array(z.string()).optional(),
});

function normalizeProjectType(v: string | undefined): ProjectType {
  if (!v) return "any";
  const t = v.toLowerCase().trim() as ProjectType;
  return PROJECT_TYPES.includes(t) ? t : "any";
}

function applyFilters(c: Constraints, filters?: SearchFilters): Constraints {
  if (!filters) return c;
  return {
    ...c,
    language: filters.language ?? c.language,
    licenses: filters.license && filters.license.length ? filters.license : c.licenses,
    includeSmallProjects: filters.includeSmallProjects ?? c.includeSmallProjects,
    projectType: filters.projectType ?? c.projectType,
    pushedWithinDays: filters.pushedWithinDays ?? c.pushedWithinDays,
    minStars: filters.minStars ?? c.minStars,
  };
}

/** Heuristic, LLM-free intent extraction used in NO_LLM_MODE or on LLM failure. */
export function heuristicIntent(prompt: string, filters?: SearchFilters): Intent {
  const lower = prompt.toLowerCase();

  let language: string | null = null;
  for (const [k, v] of Object.entries(KNOWN_LANGUAGES)) {
    if (lower.includes(k)) { language = v; break; }
  }

  const licenses: string[] = [];
  if (/\bmit\b/.test(lower)) licenses.push("MIT");
  if (/apache/.test(lower)) licenses.push("Apache-2.0");
  if (/\bbsd\b/.test(lower)) licenses.push("BSD-3-Clause");

  let projectType: ProjectType = "any";
  for (const t of PROJECT_TYPES) {
    if (t !== "any" && lower.includes(t.replace("-", " "))) { projectType = t; break; }
  }

  const includeSmallProjects =
    /\b(small|underrated|hidden|niche|lesser|promising|new)\b/.test(lower);

  let pushedWithinDays: number | null = null;
  if (/\b(maintained|active|recent|recently)\b/.test(lower)) pushedWithinDays = 180;
  const monthMatch = lower.match(/(\d+)\s*month/);
  if (monthMatch) pushedWithinDays = parseInt(monthMatch[1], 10) * 30;

  const words = lower
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const keywords = Array.from(new Set(words)).slice(0, 8);

  const constraints: Constraints = applyFilters(
    {
      keywords,
      requiredFeatures: [],
      language,
      licenses,
      pushedWithinDays,
      projectType,
      includeSmallProjects,
      minStars: null,
      maxStars: null,
    },
    filters,
  );

  return {
    normalizedPrompt: prompt.trim(),
    constraints,
    queries: buildQueries(constraints, prompt),
  };
}

/** Build several GitHub search query variants (REPORADAR.md §8.2). */
export function buildQueries(c: Constraints, rawPrompt: string): string[] {
  // Remove the language name from keywords — it's redundant with language: filter
  // and makes queries needlessly restrictive (e.g. "typescript … language:TypeScript").
  const langLower = c.language?.toLowerCase();
  const kws = c.keywords.filter(
    (k) => !langLower || !k.toLowerCase().startsWith(langLower),
  );

  // Keep at most 3 keywords per focused query; too many terms → 0 GitHub hits.
  const kw3 = kws.slice(0, 3).join(" ");
  const kw2 = kws.slice(0, 2).join(" ");
  const kw1 = kws[0] ?? "";
  const langQ = c.language ? ` language:${c.language}` : "";
  const starsQ = c.minStars ? ` stars:>=${c.minStars}` : "";
  const pushed = c.pushedWithinDays
    ? ` pushed:>${new Date(Date.now() - c.pushedWithinDays * 86400_000)
        .toISOString()
        .slice(0, 10)}`
    : "";

  // OR query — any matching keyword is enough, much better recall.
  const orTerms = kws.slice(0, 5).join(" OR ");

  // Topic-based query — GitHub topics are curator-applied, high signal.
  const topicQ = kws
    .slice(0, 2)
    .map((k) => `topic:${k.toLowerCase().replace(/\s+/g, "-")}`)
    .join(" ");

  const variants = [
    `${kw3}${langQ}${starsQ}`,                         // focused: 3 kw + language
    orTerms ? `${orTerms}${langQ}${starsQ}` : "",       // OR — broad recall
    topicQ ? `${topicQ}${langQ}` : "",                  // topic: — curator-quality signal
    `${kw3}${langQ}${pushed}`,                          // + recency filter
    kw2 ? `${kw2} in:readme${langQ}` : "",              // README full-text search
    kw2 ? `${kw2}${langQ} stars:<1000` : "",            // underrated discovery
    kw1 ? `${kw1}${langQ} stars:>100` : "",             // popular + broad
    kw3 ? `${kw3}` : "",                                // no-language fallback
  ];

  // De-dup, drop empties, keep order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    const q = v.trim().replace(/\s+/g, " ");
    if (q && !seen.has(q)) { seen.add(q); out.push(q); }
  }
  if (out.length === 0) out.push(rawPrompt.trim());
  return out;
}

const INTENT_SYSTEM = `You are RepoRadar's search architect. Convert a developer's natural-language request into rich, expanded search intent optimised for GitHub repository discovery.

━━━ SHORT PROMPT EXPANSION (CRITICAL) ━━━
When a prompt is short or vague, EXPAND aggressively with domain knowledge. Think like an expert who knows every major library, framework, and ecosystem term.

Examples of required expansion:
• "auth library" → authentication, JWT, OAuth2, sessions, PKCE, login, signup, cookies, NextAuth, Lucia, Clerk, BetterAuth, PassportJS, Auth.js
• "rich text editor" → WYSIWYG, markdown, ProseMirror, CodeMirror, Slate, TipTap, Lexical, Quill, BlockNote, rich-text
• "vector database" → embeddings, similarity search, pgvector, Qdrant, Weaviate, Milvus, Chroma, ANN, HNSW
• "state management" → Redux, Zustand, Jotai, Recoil, Valtio, MobX, context, store, reactive
• "form validation" → schema, Zod, Yup, react-hook-form, Formik, validation, input
• "AI coding assistant" → LLM, code generation, copilot, autocomplete, agent, code completion, Claude, Codex
• "local-first" → offline, CRDT, sync, Yjs, Automerge, conflict-free, peer-to-peer
• "Notion-like" → block editor, workspace, wiki, note-taking, ProseMirror, block-based, TipTap
• "RAG" → retrieval-augmented generation, vector search, embeddings, chunking, langchain, llamaindex

━━━ QUERY GENERATION RULES ━━━
Generate 6-8 DIVERSE GitHub search queries. Mix ALL of these strategies:
1. Focused keyword + language filter: "block editor markdown language:TypeScript"
2. OR broad recall: "prosemirror OR tiptap OR lexical OR slate language:TypeScript"
3. Topic-based (HIGH SIGNAL — GitHub topics are curator-applied): "topic:markdown-editor topic:wysiwyg"
4. README full-text (catches less-tagged repos): "block editor local-first in:readme"
5. Underrated/small (for hidden gems): "block editor language:TypeScript stars:<500"
6. Popular + discovery: "markdown editor stars:>500 language:TypeScript"
7. No-language fallback (catches polyglot): "block editor local-first CRDT"

━━━ OUTPUT ━━━
Return ONLY this JSON object (no prose, no markdown fences):
{
  "normalizedPrompt": string,        // 1-sentence restatement clarifying the intent
  "keywords": string[],              // 6-10 concise search terms — include known library names!
  "requiredFeatures": string[],      // concrete capabilities the repo MUST demonstrate
  "language": string | null,         // canonical GitHub language name, or null
  "licenses": string[],              // ["MIT","Apache-2.0"] etc., [] if unspecified
  "pushedWithinDays": number | null, // recency constraint in days, or null
  "projectType": "library" | "framework" | "cli" | "app" | "template" | "demo" | "research" | "tutorial" | "awesome-list" | "plugin" | "extension" | "dataset" | "any",
  "includeSmallProjects": boolean,   // true when user wants underrated/small repos
  "minStars": number | null,
  "maxStars": number | null,
  "queries": string[]                // 6-8 diverse GitHub search query strings
}`;

/** Extract intent via the LLM, falling back to heuristics. */
export async function extractIntent(
  prompt: string,
  filters?: SearchFilters,
): Promise<Intent> {
  const fallback = heuristicIntent(prompt, filters);

  const raw = await chatJson<unknown>({
    system: INTENT_SYSTEM,
    user: `Developer request: "${prompt}"\n\nUI filters already applied: ${JSON.stringify(filters ?? {})}`,
    // Deterministic: identical prompts must yield identical queries + normalized
    // prompt so the search/enrichment/scoring caches reliably hit on repeats.
    temperature: 0,
    maxTokens: 900,
    // Use the fast intent model — this is structured extraction, not deep reasoning.
    model: INTENT_MODEL,
  });
  if (!raw) return fallback;

  const parsed = intentSchema.safeParse(raw);
  if (!parsed.success) return fallback;
  const d = parsed.data;

  const constraints: Constraints = applyFilters(
    {
      keywords: d.keywords?.length ? d.keywords : fallback.constraints.keywords,
      requiredFeatures: d.requiredFeatures ?? [],
      language: d.language ?? fallback.constraints.language,
      licenses: d.licenses ?? [],
      pushedWithinDays: d.pushedWithinDays ?? fallback.constraints.pushedWithinDays,
      projectType: normalizeProjectType(d.projectType),
      includeSmallProjects:
        d.includeSmallProjects ?? fallback.constraints.includeSmallProjects,
      minStars: d.minStars ?? null,
      maxStars: d.maxStars ?? null,
    },
    filters,
  );

  const queries =
    d.queries?.length ? d.queries.slice(0, 8) : buildQueries(constraints, prompt);

  return {
    normalizedPrompt: d.normalizedPrompt?.trim() || prompt.trim(),
    constraints,
    queries,
  };
}
