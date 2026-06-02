import type { GuidanceHint, Intent } from "@/lib/types";

const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  go: "Go",
  golang: "Go",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  ruby: "Ruby",
  php: "PHP",
  "c++": "C++",
  cpp: "C++",
  "c#": "C#",
  csharp: "C#",
};

const QUALIFIER_RE = /\s+(?:stars|pushed|fork|archived|created|updated|size):\S+/gi;

export interface LanguagePolicy {
  hardLanguage: string | null;
  softLanguages: string[];
  reason: "filter" | "explicit" | "soft" | "none";
}

function canonicalLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  return LANGUAGE_ALIASES[key] ?? value.trim();
}

export function buildLanguagePolicy(
  prompt: string,
  filterLanguage?: string | null,
): LanguagePolicy {
  const fromFilter = canonicalLanguage(filterLanguage);
  if (fromFilter) return { hardLanguage: fromFilter, softLanguages: [fromFilter], reason: "filter" };

  const lower = prompt.toLowerCase();
  const explicit =
    /\b(?:must|only|strictly|required|require|written|implemented|coded)\b.{0,30}\b(?:in|with|using)\s+([a-z0-9+#]+)/i.exec(prompt) ??
    /\blanguage\s*:\s*([a-z0-9+#]+)/i.exec(prompt);
  if (explicit) {
    const hard = canonicalLanguage(explicit[1]);
    if (hard) return { hardLanguage: hard, softLanguages: [hard], reason: "explicit" };
  }

  const soft = new Set<string>();
  for (const [alias, lang] of Object.entries(LANGUAGE_ALIASES)) {
    const escaped = alias.replace(/[+#]/g, (m) => `\\${m}`);
    if (new RegExp(`\\b${escaped}\\b`, "i").test(lower)) soft.add(lang);
  }
  if (/\b(react|node|npm|frontend|web|browser)\b/i.test(prompt)) {
    soft.add("JavaScript");
    soft.add("TypeScript");
  }
  return {
    hardLanguage: null,
    softLanguages: Array.from(soft),
    reason: soft.size ? "soft" : "none",
  };
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

export function stripUnsafeQualifiers(query: string, policy: LanguagePolicy): string {
  let out = query.replace(/\blanguage:[^\s]+/gi, "").replace(QUALIFIER_RE, "").trim();
  if (policy.hardLanguage) out = `${out} language:${policy.hardLanguage}`;
  return normalizeQuery(out);
}

function addUnique(out: string[], query: string): void {
  const q = normalizeQuery(query);
  if (q && !out.some((existing) => existing.toLowerCase() === q.toLowerCase())) out.push(q);
}

export function expandQuerySet(args: {
  rawPrompt: string;
  intent: Intent;
  guidanceHints?: GuidanceHint[];
  canonicalNames?: string[];
  maxQueries?: number;
}): string[] {
  const policy = buildLanguagePolicy(args.rawPrompt, args.intent.constraints.language);
  const out: string[] = [];
  const max = Math.min(Math.max(args.maxQueries ?? 10, 4), 10);

  for (const q of args.intent.queries) addUnique(out, stripUnsafeQualifiers(q, policy));

  const terms = [
    ...args.intent.constraints.keywords,
    ...(args.guidanceHints ?? []).flatMap((h) => h.terms),
    ...(args.canonicalNames ?? []),
  ]
    .map((t) => t.replace(/^https:\/\/github\.com\//i, "").trim())
    .filter(Boolean);

  const broadTerms = Array.from(new Set(terms)).slice(0, 5);
  if (broadTerms.length) {
    addUnique(out, broadTerms.join(" OR "));
    addUnique(out, `${broadTerms.slice(0, 3).join(" ")} sort:stars`);
  }

  for (const hint of args.guidanceHints ?? []) {
    for (const q of hint.queries) addUnique(out, stripUnsafeQualifiers(q, policy));
    if (hint.repoNames.length) addUnique(out, hint.repoNames.slice(0, 5).join(" OR "));
  }

  if (policy.softLanguages.includes("JavaScript") || policy.softLanguages.includes("TypeScript")) {
    const jsTerms = broadTerms.filter((t) => !/^(javascript|typescript)$/i.test(t)).slice(0, 4);
    if (jsTerms.length) {
      addUnique(out, `${jsTerms.join(" OR ")} language:JavaScript`);
      addUnique(out, `${jsTerms.join(" OR ")} language:TypeScript`);
      addUnique(out, jsTerms.join(" OR "));
    }
  }

  addUnique(out, args.rawPrompt);
  return out.slice(0, max);
}
