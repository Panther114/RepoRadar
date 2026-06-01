import { Octokit } from "octokit";
import { env } from "@/lib/env";

// A single authenticated Octokit instance. Without GITHUB_TOKEN the GitHub
// Search API is heavily rate-limited (~10 req/min), so a token is strongly
// recommended (see setup.txt).
const globalForOctokit = globalThis as unknown as {
  octokit: Octokit | undefined;
};

export const octokit =
  globalForOctokit.octokit ??
  new Octokit({
    auth: env.GITHUB_TOKEN || undefined,
    userAgent: "RepoRadar",
  });

if (process.env.NODE_ENV !== "production") {
  globalForOctokit.octokit = octokit;
}

export const hasGithubToken = (): boolean => env.GITHUB_TOKEN.length > 0;
