import { octokit } from "@/lib/github/client";
import type { Candidate, LightRepoEvidence } from "@/lib/types";

const cache = new Map<number, LightRepoEvidence>();

interface LightRepoNode {
  readmeMd: { text: string | null } | null;
  readmeLower: { text: string | null } | null;
  packageJson: { text: string | null } | null;
  pyprojectToml: { text: string | null } | null;
  cargoToml: { text: string | null } | null;
  goMod: { text: string | null } | null;
  defaultBranchRef: { target: { tree: { entries: { name: string }[] } } | null } | null;
}

function buildQuery(n: number): string {
  const vars = Array.from({ length: n }, (_, i) => `$o${i}: String!, $n${i}: String!`).join(", ");
  const repos = Array.from(
    { length: n },
    (_, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) {
      readmeMd: object(expression: "HEAD:README.md") { ... on Blob { text } }
      readmeLower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      packageJson: object(expression: "HEAD:package.json") { ... on Blob { text } }
      pyprojectToml: object(expression: "HEAD:pyproject.toml") { ... on Blob { text } }
      cargoToml: object(expression: "HEAD:Cargo.toml") { ... on Blob { text } }
      goMod: object(expression: "HEAD:go.mod") { ... on Blob { text } }
      defaultBranchRef { target { ... on Commit { tree { entries { name } } } } }
    }`,
  ).join("\n");
  return `query LightRepoEvidence(${vars}) {\n${repos}\n}`;
}

function emptyEvidence(candidate: Candidate): LightRepoEvidence {
  return {
    fullName: candidate.fullName,
    readmeHead: null,
    manifestNames: [],
    docsSignals: {
      hasReadme: false,
      hasInstall: false,
      hasExamples: false,
      hasDocsFolder: false,
    },
  };
}

function fromNode(candidate: Candidate, node: LightRepoNode | null): LightRepoEvidence {
  if (!node) return emptyEvidence(candidate);
  const readme = node.readmeMd?.text ?? node.readmeLower?.text ?? null;
  const entries = node.defaultBranchRef?.target?.tree?.entries?.map((e) => e.name.toLowerCase()) ?? [];
  const manifestNames = [
    node.packageJson?.text ? "package.json" : null,
    node.pyprojectToml?.text ? "pyproject.toml" : null,
    node.cargoToml?.text ? "Cargo.toml" : null,
    node.goMod?.text ? "go.mod" : null,
  ].filter((x): x is string => !!x);

  return {
    fullName: candidate.fullName,
    readmeHead: readme?.slice(0, 500) ?? null,
    manifestNames,
    docsSignals: {
      hasReadme: !!readme,
      hasInstall: !!readme && /install/i.test(readme),
      hasExamples: entries.includes("examples") || entries.includes("example") || (!!readme && /example/i.test(readme)),
      hasDocsFolder: entries.includes("docs") || entries.includes("documentation"),
    },
  };
}

export async function fetchLightRepoEvidenceBatch(
  candidates: Candidate[],
  limit = 20,
  chunkSize = 20,
): Promise<Map<number, LightRepoEvidence>> {
  const selected = candidates.slice(0, Math.max(0, limit));
  const out = new Map<number, LightRepoEvidence>();
  const misses = selected.filter((candidate) => {
    const cached = cache.get(candidate.githubId);
    if (cached) {
      out.set(candidate.githubId, cached);
      return false;
    }
    return true;
  });

  for (let i = 0; i < misses.length; i += chunkSize) {
    const chunk = misses.slice(i, i + chunkSize);
    const variables: Record<string, string> = {};
    chunk.forEach((candidate, idx) => {
      variables[`o${idx}`] = candidate.owner;
      variables[`n${idx}`] = candidate.name;
    });

    let data: Record<string, LightRepoNode | null> | null = null;
    try {
      data = await octokit.graphql<Record<string, LightRepoNode | null>>(buildQuery(chunk.length), variables);
    } catch {
      data = null;
    }

    chunk.forEach((candidate, idx) => {
      const evidence = fromNode(candidate, data?.[`r${idx}`] ?? null);
      cache.set(candidate.githubId, evidence);
      out.set(candidate.githubId, evidence);
    });
  }

  return out;
}
