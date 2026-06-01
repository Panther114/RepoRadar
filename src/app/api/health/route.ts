import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env, isLlmEnabled } from "@/lib/env";
import { LOG_FILE_PATH } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ext = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    return NextResponse.json({
      status: "ok",
      db: true,
      pgvector: ext.length > 0,
      llmEnabled: isLlmEnabled(),
      model: isLlmEnabled() ? env.OPENROUTER_MODEL : "deterministic",
      logFile: LOG_FILE_PATH,
    });
  } catch (error) {
    return NextResponse.json(
      { status: "error", db: false, error: String(error) },
      { status: 500 },
    );
  }
}
