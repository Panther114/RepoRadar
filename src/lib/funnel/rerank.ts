import { AutoTokenizer, AutoModelForSequenceClassification } from "@xenova/transformers";

/**
 * Local cross-encoder reranker (R3). Unlike the bi-encoder funnel (which embeds
 * query and repo *independently* and compares vectors), a cross-encoder reads
 * the (query, repo) pair JOINTLY and scores true relevance — far more precise.
 * It is the right precision layer for a widened candidate pool: breadth lifts
 * recall but lets canonical answers (qdrant, weaviate) get out-ranked by obscure
 * keyword-similar repos; the cross-encoder pulls them back to the top.
 *
 * Model: ms-marco-MiniLM-L-6-v2 (~90 MB quantized ONNX, CPU-fast) — the classic
 * fast reranker. Local & free, mirrors the embedder. Flag-gated.
 */
const MODEL = process.env.RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokP: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelP: Promise<any> | null = null;

function getTok() {
  tokP ??= AutoTokenizer.from_pretrained(MODEL);
  return tokP;
}
function getModel() {
  modelP ??= AutoModelForSequenceClassification.from_pretrained(MODEL, { quantized: true });
  return modelP;
}

export function crossEncoderEnabled(): boolean {
  // Default ON: paired with the prominence co-signal in the funnel blend (so it
  // can't bury canonical high-star repos under keyword-similar demos), the
  // cross-encoder is a net relevance win on the gold set (nDCG +0.044, trap-leak
  // halved). Set CROSS_ENCODER_RERANK=false to disable (skips the ~90 MB model).
  return String(process.env.CROSS_ENCODER_RERANK ?? "true").toLowerCase() === "true";
}

/**
 * Returns a relevance score in (0,1) for each doc against the query. Batched to
 * bound memory; docs are truncated since the head carries the signal.
 */
export async function crossEncoderScores(query: string, docs: string[]): Promise<number[]> {
  if (docs.length === 0) return [];
  const tokenizer = await getTok();
  const model = await getModel();
  const out: number[] = [];
  const BATCH = 16;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const inputs = tokenizer(
      new Array(chunk.length).fill(query),
      { text_pair: chunk.map((d) => d.slice(0, 1400)), padding: true, truncation: true },
    );
    const output = await model(inputs);
    const logits = output.logits.tolist() as number[][]; // [N, 1]
    for (const row of logits) {
      const z = Array.isArray(row) ? row[0] : (row as number);
      out.push(1 / (1 + Math.exp(-z))); // sigmoid → (0,1)
    }
  }
  return out;
}
