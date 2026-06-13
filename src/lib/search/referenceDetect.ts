// Pure reference detection (no network): finds project names a prompt DEFINES
// the target by — "alternative to X", "like X", "X clone". Kept separate from
// referenceResolver.ts (which resolves names on GitHub via octokit) so the
// regex layer stays unit-testable without the octokit import chain.

// Patterns that point at another project. The captured group is the project
// name — one or two words, possibly hyphen/dot-qualified ("next.js", "k8s").
const REF_PATTERNS: RegExp[] = [
  /\b(?:open[- ]source\s+)?alternatives?\s+(?:to|for|of)\s+([\w.&-]+(?:\s+[\w.&-]+)?)/i,
  /\b(?:self[- ]hosted|free|lightweight|minimal)\s+([\w.&-]+(?:\s+[\w.&-]+)?)\s+alternatives?\b/i,
  /\b([\w.&-]+(?:\s+[\w.&-]+)?)\s+alternatives?\b/i,
  // (?<![-\w]) keeps "notion-like editor" from matching as like→"editor".
  /(?<![-\w])(?:similar\s+to|like|clone\s+of|replacement\s+for|inspired\s+by)\s+([\w.&-]+(?:\s+[\w.&-]+)?)/i,
  /\b([\w.&-]+)[- ]like\b/i,
  /\b([\w.&-]+)\s+clones?\b/i,
];

// Generic words that the loose patterns can capture but never name a project.
const NOT_PROJECTS = new Set([
  "a", "an", "the", "it", "them", "this", "that", "good", "best", "free",
  "open", "source", "open-source", "self-hosted", "hosted", "cheap", "paid",
  "commercial", "proprietary", "great", "modern", "simple", "lightweight",
  "library", "framework", "tool", "app", "software", "project", "repo",
  "something", "anything", "one",
  // conjunctions/prepositions that trail a name in "like X but/with/for …"
  "but", "with", "without", "and", "or", "for", "in", "on", "which", "than",
]);

/** Extract candidate project names the prompt points at (deduped, max 2). */
export function detectReferences(prompt: string): string[] {
  const found: string[] = [];
  for (const re of REF_PATTERNS) {
    const m = re.exec(prompt);
    if (!m) continue;
    // Trim generic words off both ends of 2-word captures
    // ("notion app" → "notion", "hosted notion" → "notion").
    const words = m[1].trim().split(/\s+/);
    while (words.length > 1 && NOT_PROJECTS.has(words[words.length - 1].toLowerCase())) words.pop();
    while (words.length > 1 && NOT_PROJECTS.has(words[0].toLowerCase())) words.shift();
    const name = words.join(" ").toLowerCase();
    if (!name || NOT_PROJECTS.has(name) || name.length < 2) continue;
    if (!found.includes(name)) found.push(name);
    if (found.length >= 2) break;
  }
  return found;
}
