/**
 * One-shot backfill: embed every KnowledgeItem whose `embedding` column
 * is NULL. Used to rescue items that landed before embed-on-sync wiring
 * existed (the 1.7K WBP products synced from Odoo prior to that PR), and
 * for routine recovery from partial embedding failures during sync.
 *
 * Idempotent: the WHERE clause already filters out embedded rows, so a
 * second run after a clean first run is a no-op. Sequential per item
 * (no parallelism) — the embedding provider's circuit breaker prefers
 * that, and the cost is bounded: 1.7K items × ~600 ms ≈ 17 min.
 *
 * Usage:
 *   npm run embeddings:backfill
 *   npm run embeddings:backfill -- --force
 *   npm run embeddings:backfill -- --help
 *
 * Performance: progress is reported every 50 items with elapsed seconds.
 *
 * NOT a queue job. Runs in the script process and exits when done. The
 * BullMQ embed-items-batch path remains the authoritative writer for
 * manual imports; this script is the operator-driven recovery channel.
 */

import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { embedKnowledgeItem } from "@/server/knowledge/embed-item";

const PROGRESS_INTERVAL = 50;
// Empirical per-item cost (sequential): one embedding API call (~400–500 ms
// p50, ~600 ms tail) plus a single-row UPDATE (~50 ms). Used only to size
// the --force confirmation prompt's runtime estimate.
const ESTIMATED_MS_PER_ITEM = 600;

function printHelp(): void {
  console.log(`
Backfill KnowledgeItem embeddings.

Usage:
  npm run embeddings:backfill                Embed only items missing an embedding.
  npm run embeddings:backfill -- --force     Regenerate ALL items (prompts for confirmation).
  npm run embeddings:backfill -- --help      Show this message.

Options:
  --force                Regenerate ALL items even if already embedded.
                         Required after embed-text composition changes.
                         Prompts for confirmation before running.
  --help                 Show this message and exit.
`);
}

/**
 * Read a single line from stdin (terminated by \\n or EOF). Used to gate
 * --force on an explicit "YES" so a fat-fingered run can't blow through
 * the embedding budget. Returns the trimmed line.
 */
async function readStdinLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl !== -1) {
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        process.stdin.removeListener("error", onError);
        resolve(buf.slice(0, nl).trim());
      }
    };
    const onEnd = (): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("error", onError);
      resolve(buf.trim());
    };
    const onError = (err: Error): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      reject(err);
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      force: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const force = values.force === true;

  // Items to embed. Default mode filters by `embedding IS NULL` (the
  // idempotent recovery path); --force returns every row across every
  // tenant. Raw query because KnowledgeItem.embedding is
  // `Unsupported("vector(1024)")` — Prisma can't bind it (same reason
  // listUnembeddedItemIds in db/items.ts uses raw SQL).
  const rows = force
    ? await prisma.$queryRaw<
        Array<{ id: string; tenantId: string; name: string }>
      >(Prisma.sql`
        SELECT "id", "tenantId", "name"
          FROM "KnowledgeItem"
         ORDER BY "createdAt" ASC
      `)
    : await prisma.$queryRaw<
        Array<{ id: string; tenantId: string; name: string }>
      >(Prisma.sql`
        SELECT "id", "tenantId", "name"
          FROM "KnowledgeItem"
         WHERE "embedding" IS NULL
         ORDER BY "createdAt" ASC
      `);

  if (force) {
    const minutesEstimate = Math.max(
      1,
      Math.ceil((rows.length * ESTIMATED_MS_PER_ITEM) / 60_000),
    );
    console.log("");
    console.log(
      `WARNING: --force will regenerate ALL ${rows.length} items including those`,
    );
    console.log(
      `already embedded. This will consume embedding API quota proportional`,
    );
    console.log(
      `to your catalog size and take ~${minutesEstimate} minutes.`,
    );
    console.log("");
    process.stdout.write("Continue? Type YES to proceed: ");
    const reply = await readStdinLine();
    if (reply !== "YES") {
      console.log("Aborted.");
      await prisma.$disconnect();
      return;
    }
    console.log("");
  } else {
    console.log(`Found ${rows.length} items needing embeddings.`);
  }

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
      // Re-load the full row — embedKnowledgeItem reads brand / category /
      // sku / description / specs to compose the embed text. The list-query
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
