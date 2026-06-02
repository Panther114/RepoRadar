import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle, AlertCircle, Database, Cpu, Zap, Clock, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { isLlmEnabled, env } from "@/lib/env";
import pkg from "../../../package.json";

export const metadata: Metadata = { title: "Status — RepoRadar" };
export const dynamic = "force-dynamic";

async function checkHealth() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - t0;
    const ext = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    return {
      ok: true,
      db: true,
      dbMs,
      pgvector: ext.length > 0,
      llm: isLlmEnabled(),
      model: isLlmEnabled() ? env.OPENROUTER_MODEL : null,
    };
  } catch (e) {
    return { ok: false, db: false, dbMs: null, pgvector: false, llm: false, model: null, error: String(e) };
  }
}

function StatusRow({
  icon: Icon,
  label,
  ok,
  value,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  ok: boolean | null;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-input">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{value}</span>
        {ok === true && <CheckCircle2 className="h-4 w-4 text-accent" />}
        {ok === false && <XCircle className="h-4 w-4 text-[#f85149]" />}
        {ok === null && <AlertCircle className="h-4 w-4 text-[#d29922]" />}
      </div>
    </div>
  );
}

export default async function StatusPage() {
  const health = await checkHealth();
  const overall = health.ok && health.pgvector;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 space-y-8">

      {/* Header */}
      <div>
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to search
        </Link>
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${overall ? "bg-accent" : "bg-[#f85149]"} shadow-[0_0_8px_2px] ${overall ? "shadow-accent/40" : "shadow-[#f85149]/40"}`} />
          <h1 className="text-2xl font-semibold tracking-tight">
            {overall ? "All systems operational" : "Degraded"}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          RepoRadar v{pkg.version} · checked just now
        </p>
      </div>

      {/* Status rows */}
      <div className="space-y-2">
        <StatusRow
          icon={Database}
          label="Database"
          ok={health.db}
          value={health.db ? `${health.dbMs}ms` : "unreachable"}
          detail="PostgreSQL via Prisma"
        />
        <StatusRow
          icon={Database}
          label="pgvector extension"
          ok={health.pgvector}
          value={health.pgvector ? "enabled" : "missing"}
          detail="Required for embedding similarity search"
        />
        <StatusRow
          icon={Zap}
          label="LLM scoring"
          ok={health.llm ? true : null}
          value={health.llm ? "enabled" : "deterministic only"}
          detail={health.model ? `Model: ${health.model}` : "Set OPENROUTER_API_KEY to enable AI scoring"}
        />
        <StatusRow
          icon={Cpu}
          label="Embeddings"
          ok={true}
          value="local (ONNX)"
          detail="all-MiniLM-L6-v2 · 384-dim · runs in-process"
        />
        <StatusRow
          icon={Clock}
          label="Typical search time"
          ok={null}
          value="30–40 s"
          detail="Cold search · warm repeat searches are faster"
        />
      </div>

      {/* Error detail if DB is down */}
      {!health.db && health.error && (
        <div className="rounded-lg border border-[#f85149]/40 bg-[#f85149]/5 px-4 py-3">
          <p className="mb-1 text-xs font-semibold text-[#f85149]">Database error</p>
          <pre className="whitespace-pre-wrap break-all text-xs text-[#f85149]/80">{health.error}</pre>
        </div>
      )}

      {/* API JSON link */}
      <p className="text-xs text-muted-foreground">
        Raw JSON:{" "}
        <a href="/api/health" className="font-mono text-primary hover:underline" target="_blank" rel="noreferrer">
          /api/health
        </a>
      </p>

    </main>
  );
}
