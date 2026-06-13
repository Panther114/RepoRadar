import type { GuidanceHint } from "@/lib/types";

type GuidanceRule = GuidanceHint & {
  requiredTokenGroups?: string[][];
};

const GUIDANCE: GuidanceRule[] = [
  {
    id: "browser-testing",
    match: "browser testing automation playwright selenium puppeteer ui test",
    terms: ["browser automation", "end-to-end testing", "playwright", "selenium", "puppeteer"],
    repoNames: ["microsoft/playwright", "SeleniumHQ/selenium", "puppeteer/puppeteer"],
    queries: ["playwright OR selenium OR puppeteer", "browser automation testing sort:stars"],
  },
  {
    id: "local-first-sync",
    match: "local first sync crdt offline collaboration collaborative",
    terms: ["local-first", "CRDT", "offline sync", "Yjs", "Automerge", "Loro"],
    repoNames: ["yjs/yjs", "automerge/automerge", "loro-dev/loro", "pubkey/rxdb"],
    queries: ["Yjs OR Automerge OR Loro CRDT", "local-first sync CRDT sort:stars"],
  },
  {
    id: "notion-editor",
    match: "notion editor rich text block markdown wysiwyg",
    terms: ["block editor", "rich text editor", "markdown", "tiptap", "lexical", "blocknote", "prosemirror", "slate"],
    repoNames: ["ueberdosis/tiptap", "facebook/lexical", "TypeCellOS/BlockNote", "ProseMirror/prosemirror", "ianstormtaylor/slate"],
    queries: ["tiptap OR lexical OR blocknote OR prosemirror OR slate", "block editor markdown sort:stars"],
  },
  {
    id: "react-state",
    match: "react state store global simple",
    terms: ["React state management", "global store", "Zustand", "Jotai", "Redux", "Valtio"],
    repoNames: ["pmndrs/zustand", "pmndrs/jotai", "reduxjs/redux", "pmndrs/valtio"],
    queries: ["zustand OR jotai OR redux OR valtio", "react state management sort:stars"],
    requiredTokenGroups: [["state", "store", "redux", "zustand", "jotai", "valtio"]],
  },
  {
    id: "python-api",
    match: "python api server web backend openapi",
    terms: ["Python API framework", "FastAPI", "Django REST", "Flask", "OpenAPI"],
    repoNames: ["fastapi/fastapi", "encode/django-rest-framework", "pallets/flask"],
    queries: ["fastapi OR flask OR django-rest-framework", "python api framework sort:stars"],
    requiredTokenGroups: [["api", "server", "backend", "openapi", "fastapi", "flask", "django"]],
  },
  {
    id: "self-hosted-deploy",
    match: "self hosted deploy heroku paas server containers",
    terms: ["self-hosted PaaS", "Heroku alternative", "Coolify", "Dokku", "CapRover"],
    repoNames: ["coollabsio/coolify", "dokku/dokku", "caprover/caprover"],
    queries: ["coolify OR dokku OR caprover", "self-hosted PaaS Heroku sort:stars"],
    requiredTokenGroups: [["deploy", "heroku", "paas", "coolify", "dokku", "caprover"]],
  },
  {
    id: "pdf-rag",
    match: "pdf rag documents retrieval ai embeddings",
    terms: ["PDF RAG", "retrieval augmented generation", "document QA", "LangChain", "LlamaIndex"],
    repoNames: ["langchain-ai/langchain", "run-llama/llama_index", "microsoft/semantic-kernel"],
    queries: ["PDF RAG langchain llamaindex", "document question answering embeddings sort:stars"],
  },
  {
    id: "codex-skills",
    match: "codex claude skills agents agent plugin frontend design",
    terms: ["Codex skills", "Claude Code skills", "agent skills", "frontend design skill", "plugin"],
    repoNames: ["contains-studio/agents", "anthropics/claude-code"],
    queries: ["codex skills OR claude code skills", "agent skills frontend design"],
  },
];

// A hint must match on at least this many distinct prompt tokens before it
// fires. A single shared generic word ("react", "api", "data") is NOT enough —
// that loose matching let "react data table" trigger the react-state hint and
// inject zustand/jotai/redux as canonical rescues, polluting the shortlist.
const MIN_HINT_SCORE = 2;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#]+/).filter((tok) => tok.length > 2);
}

function satisfiesRequiredGroups(tokens: Set<string>, hint: GuidanceRule): boolean {
  if (!hint.requiredTokenGroups?.length) return true;
  return hint.requiredTokenGroups.every((group) => group.some((token) => tokens.has(token)));
}

function scoreHint(text: string, hint: GuidanceRule): number {
  const haystack = `${hint.match} ${hint.terms.join(" ")} ${hint.repoNames.join(" ")}`.toLowerCase();
  // Count DISTINCT matching tokens (a repeated word shouldn't inflate the score).
  const matched = new Set<string>();
  for (const tok of tokenize(text)) {
    if (tok.length > 2 && haystack.includes(tok)) matched.add(tok);
  }
  return matched.size;
}

export function findGuidanceHints(prompt: string, limit = 3): GuidanceHint[] {
  const promptTokens = new Set(tokenize(prompt));
  return GUIDANCE
    .map((hint) => ({ hint, score: scoreHint(prompt, hint) }))
    .filter((x) => x.score >= MIN_HINT_SCORE && satisfiesRequiredGroups(promptTokens, x.hint))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.hint);
}

export function guidanceCanonicalNames(prompt: string): string[] {
  return Array.from(new Set(findGuidanceHints(prompt).flatMap((hint) => hint.repoNames))).slice(0, 8);
}
