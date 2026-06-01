import type {
  SearchFiltersInput,
  SearchResponse,
  TrendsResponse,
} from "@/lib/api/types";

const lastSearchStates = new Map<string, string>();

export async function warmSearchRoute(): Promise<void> {
  const startedAt = performance.now();
  try {
    const res = await fetch("/api/search", {
      method: "GET",
      cache: "no-store",
      headers: { "x-reporadar-purpose": "warmup" },
    });
    console.debug("[RepoRadar] Search route warm-up finished", {
      status: res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    console.debug("[RepoRadar] Search route warm-up skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startSearch(
  prompt: string,
  filters?: SearchFiltersInput,
): Promise<{ searchId: string; status: string; requestId?: string }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  const startedAt = performance.now();

  try {
    console.debug("[RepoRadar] Starting search", {
      promptLength: prompt.length,
      filters,
    });
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, filters }),
      signal: controller.signal,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const requestId = res.headers.get("x-reporadar-request-id");
    console.debug("[RepoRadar] Search request finished", {
      status: res.status,
      durationMs,
      requestId,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.detail ??
          body?.error ??
          `Search failed (${res.status}${requestId ? `, request ${requestId}` : ""})`,
      );
    }
    const body = (await res.json()) as { searchId: string; status: string; requestId?: string };
    return { ...body, requestId: body.requestId ?? requestId ?? undefined };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "Search timed out before a job was created. Check /api/health and the server logs.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getSearch(id: string): Promise<SearchResponse> {
  const res = await fetch(`/api/search/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load search (${res.status})`);
  const data = (await res.json()) as SearchResponse;
  const state = `${data.status}:${data.stage ?? ""}:${data.progress ?? ""}:${data.results.length}`;
  if (lastSearchStates.get(id) !== state) {
    lastSearchStates.set(id, state);
    console.debug("[RepoRadar] Search poll update", {
      searchId: id,
      status: data.status,
      stage: data.stage,
      progress: data.progress,
      results: data.results.length,
    });
  }
  return data;
}

export async function getRepoDetail(owner: string, name: string) {
  const res = await fetch(`/api/repo/${owner}/${name}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load repo (${res.status})`);
  return res.json();
}

export async function getRepoTrends(
  owner: string,
  name: string,
): Promise<TrendsResponse> {
  const res = await fetch(`/api/repo/${owner}/${name}/trends`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load trends (${res.status})`);
  return res.json();
}
