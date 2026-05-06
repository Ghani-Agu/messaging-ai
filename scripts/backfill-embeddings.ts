/**
 * One-shot backfill: embed every KnowledgeItem whose `embedding` column
 * is NULL. Used to rescue items that landed before embed-on-sync wiring
 * existed (the 1.7K WBP products synced from Odoo prior to this PR), and
 * for routine recovery from partial embedding failures during sync.
 *
 * Idempotent: the WHERE clause already filters out embedded rows, so a
 * second run after a clean first run is a no-op. Sequential per item
 * (no parallelism) — the embedding provider's circuit breaker prefers
 * that, and the cost is bounded: 1.7K items × ~600 ms ≈ 17 min.
 *
 * Usage:
 *   npm run embeddings:backfill
 *
 * Performance: progress is reported every 50 items with elapsed seconds.
 *
 * NOT a queue job. Runs in the script process and exits when done. The
 * BullMQ embed-items-batch path remains the authoritative writer for
 * manual imports; this script is the operator-driven recovery channel.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { embedKnowledgeItem } from "@/server/knowledge/embed-item";

const PROGRESS_INTERVAL = 50;

async function main(): Promise<void> {
  // Items with no embedding yet, oldest first. Raw query because
  // KnowledgeItem.embedding is `Unsupported("vector(1024)")` — Prisma
  // can't bind it (same reason listUnembeddedItemIds in db/items.ts uses
  // raw SQL). Cross-tenant by design: an operator running backfill wants
  // every orphaned row, regardless of which tenant they belong to.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; tenantId: string; name: string }>
  >(Prisma.sql`
    SELECT "id", "tenantId", "name"
      FROM "KnowledgeItem"
     WHERE "embedding" IS NULL
     ORDER BY "createdAt" ASC
  `);

  console.log(`Found ${rows.length} items needing embeddings.`);
  if (rows.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    try {
      // Re-load the full row — embedKnowledgeItem reads brand / sku /
      // description / specs to compose the embed text. The list-query
      // above only pulls id/tenantId/name to keep memory bounded for
      // large backfills.
      const item = await prisma.knowledgeItem.findUnique({
        where: { id: row.id },
      });
      if (!item) {
        // Row was deleted between list-query and findUnique. Treat as a
        // skip rather than a failure — backfill is best-effort.
        continue;
      }
      await embedKnowledgeItem(item);
      succeeded++;
    } catch (err) {
      failed++;
      console.error(
        `Failed to embed item ${row.id} (${row.name}):`,
        err instanceof Error ? err.message : "unknown",
      );
    }

    if ((i + 1) % PROGRESS_INTERVAL === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  ${i + 1}/${rows.length} processed (${elapsed}s elapsed)`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log("");
  console.log(`Done in ${elapsed}s.`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
