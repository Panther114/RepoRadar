import { prisma } from "@/lib/db";

/** Format a JS number[] as a pgvector literal: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}]`;
}

/** Upsert a repo's evidence embedding (best-effort; never throws). */
export async function upsertRepoEmbedding(
  repoId: string,
  sourceType: string,
  sourceHash: string,
  vec: number[],
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO repo_embeddings (id, repo_id, embedding, source_type, source_hash, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::vector, $3, $4, now())
       ON CONFLICT (repo_id, source_type)
       DO UPDATE SET embedding = EXCLUDED.embedding, source_hash = EXCLUDED.source_hash, created_at = now()`,
      repoId,
      toVectorLiteral(vec),
      sourceType,
      sourceHash,
    );
  } catch (error) {
    console.error("[embeddings] upsertRepoEmbedding failed:", error);
  }
}

/** Persist the intent embedding on a search query (best-effort). */
export async function setIntentEmbedding(searchQueryId: string, vec: number[]): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE search_queries SET intent_embedding = $2::vector WHERE id = $1::uuid`,
      searchQueryId,
      toVectorLiteral(vec),
    );
  } catch (error) {
    console.error("[embeddings] setIntentEmbedding failed:", error);
  }
}
