import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { SearchFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("api:search");

const filtersSchema = z
  .object({
    language: z.string().nullable().optional(),
    license: z.array(z.string()).optional(),
    includeSmallProjects: z.boolean().optional(),
    minFutureScore: z.number().nullable().optional(),
    projectType: z.string().optional(),
    pushedWithinDays: z.number().nullable().optional(),
    minStars: z.number().nullable().optional(),
  })
  .optional();

const bodySchema = z.object({
  prompt: z.string().min(3, "prompt too short"),
  filters: filtersSchema,
});

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  log.debug("Search route warm-up", {
    requestId,
    purpose: req.headers.get("x-reporadar-purpose"),
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  });
  return NextResponse.json(
    { status: "ready", requestId },
    { headers: { "x-reporadar-request-id": requestId } },
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n\n${error.stack}` : error.message;
  }
  return String(error);
}

function launchSearchInBackground(args: {
  searchQueryId: string;
  prompt: string;
  filters?: SearchFilters;
  requestId: string;
}): void {
  setTimeout(() => {
    void (async () => {
      log.info("Background pipeline import starting", {
        requestId: args.requestId,
        searchQueryId: args.searchQueryId,
      });
      const { runSearch } = await import("@/lib/pipeline/runSearch");
      log.info("Background pipeline launched", {
        requestId: args.requestId,
        searchQueryId: args.searchQueryId,
      });
      await runSearch(args.searchQueryId, args.prompt, args.filters);
    })().catch(async (error) => {
      log.error("Background pipeline launch failed", error, {
        requestId: args.requestId,
        searchQueryId: args.searchQueryId,
      });
      await prisma.searchJob
        .updateMany({
          where: { searchQueryId: args.searchQueryId },
          data: {
            status: "failed",
            stage: "launch",
            progress: 100,
            error: errorText(error),
          },
        })
        .catch((updateError) => {
          log.error("Failed to mark search job as failed", updateError, {
            requestId: args.requestId,
            searchQueryId: args.searchQueryId,
          });
        });
    });
  }, 0);
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    log.warn("Rejected invalid search request", {
      requestId,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { prompt, filters } = parsed.data;

  log.info("Accepted search request", {
    requestId,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 120),
    filters,
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  });

  let query: { id: string };
  try {
    query = await prisma.searchQuery.create({
      data: { rawPrompt: prompt, normalizedPrompt: prompt },
      select: { id: true },
    });
    await prisma.searchJob.create({
      data: { searchQueryId: query.id, status: "queued", progress: 0 },
    });
  } catch (error) {
    log.error("Failed to create search job", error, { requestId });
    return NextResponse.json(
      {
        error: "Could not create search job",
        requestId,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { "x-reporadar-request-id": requestId } },
    );
  }

  // Run the pipeline in the background (in-process). On a long-lived Node
  // server (dev / Railway) this continues after the response is sent.
  launchSearchInBackground({
    searchQueryId: query.id,
    prompt,
    filters: filters as SearchFilters | undefined,
    requestId,
  });

  log.info("Search job queued", {
    requestId,
    searchQueryId: query.id,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    { searchId: query.id, status: "queued", requestId },
    { headers: { "x-reporadar-request-id": requestId } },
  );
}
