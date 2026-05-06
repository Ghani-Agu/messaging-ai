import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { syncSource, isDueForSync } from "@/server/integrations/dispatch";

/**
 * Cron route for Live Data Source sync. Triggered by the deployment
 * platform's scheduler (e.g. Vercel Cron, GitHub Actions on a
 * schedule, or a hosted cron service hitting this URL on a tick).
 *
 * Auth: simple bearer-token check against CRON_SECRET. The secret is
 * a 32-byte base64 string — see docs/integrations.md for generation.
 * The cron route is the ONLY place we accept this token; rotate
 * freely by updating both .env.local and the cron config.
 *
 * Behavior:
 *  - Loads every LiveDataSource with status in (CONNECTED, ERROR).
 *  - For each, calls isDueForSync() to gate by cadence (15min business
 *    hours / 60min off-hours; Algeria's Sun-Thu work week, Africa/Algiers).
 *  - Runs syncSource() sequentially per source (no parallelism — the
 *    common case is a single source per tenant; many sources would just
 *    pile up Prisma connections against the connection_limit=10 ceiling).
 *  - Returns a per-source result envelope so the cron observer can see
 *    what skipped and what succeeded/failed.
 *
 * 401 on missing/wrong auth header. 200 with a structured body in all
 * other cases — even per-source failures don't 5xx the route, because
 * a single bad credential shouldn't make the cron platform retry the
 * whole batch (which would hammer the healthy sources).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sources = await prisma.liveDataSource.findMany({
    where: { status: { in: ["CONNECTED", "ERROR"] } },
  });

  const results: Array<{
    id: string;
    name: string;
    skipped: boolean;
    reason?: string;
    recordsProcessed?: number;
    durationMs?: number;
    error?: string;
  }> = [];

  for (const source of sources) {
    if (!isDueForSync(source)) {
      results.push({
        id: source.id,
        name: source.name,
        skipped: true,
        reason: "Not due",
      });
      continue;
    }
    try {
      const result = await syncSource(source);
      results.push({
        id: source.id,
        name: source.name,
        skipped: false,
        recordsProcessed: result.recordsProcessed,
        durationMs: result.durationMs,
      });
    } catch (err) {
      results.push({
        id: source.id,
        name: source.name,
        skipped: false,
        error: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
