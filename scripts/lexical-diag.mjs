// One-shot diagnostic for the "lex —" zero-hit bug seen in Phase 3 demo.
// Runs the four checks the project lead asked for, in order.
//
// Usage:
//   npx dotenv -e .env.local -- node scripts/lexical-diag.mjs
//
// Read-only — does not mutate the DB.

import { PrismaClient } from "@prisma/client";

const QUERY = "Redis database";

const prisma = new PrismaClient();
const hr = (label) => console.log(`\n──────── ${label} ────────`);

try {
  // Find the tenant with the most chunks — that's the one being demoed,
  // regardless of slug. If nothing has chunks yet, fall back to any tenant.
  const tenantRows = await prisma.$queryRaw`
    SELECT t."id", t."slug", t."name", COUNT(k."id")::bigint AS chunk_count
      FROM "Tenant" t
      LEFT JOIN "KnowledgeChunk" k ON k."tenantId" = t."id"
     GROUP BY t."id", t."slug", t."name"
     ORDER BY chunk_count DESC, t."createdAt" ASC
  `;
  if (tenantRows.length === 0) {
    console.error("No tenants exist. Seed first.");
    process.exit(1);
  }
  console.log("Tenants:");
  for (const t of tenantRows) {
    console.log(`  - ${t.slug.padEnd(20)}  ${t.name.padEnd(30)}  chunks=${t.chunk_count}`);
  }
  const tenant = tenantRows[0];
  if (Number(tenant.chunk_count) === 0) {
    console.log("\n⚠ No tenant has any chunks. Ingest content before running this diag.");
    process.exit(0);
  }
  console.log(`\nUsing tenant: ${tenant.name} (${tenant.slug}, ${tenant.id})`);
  console.log(`Query       : "${QUERY}"`);

  // ── (a) searchVector populated? ───────────────────────────────────────────
  hr("a. searchVector population");
  const counts = await prisma.$queryRaw`
    SELECT COUNT(*)::bigint                                  AS total,
           COUNT(*) FILTER (WHERE "searchVector" IS NULL)::bigint AS null_sv,
           COUNT(*) FILTER (WHERE "embedding" IS NULL)::bigint    AS null_emb
      FROM "KnowledgeChunk"
     WHERE "tenantId" = ${tenant.id}
  `;
  const c = counts[0];
  console.log(`total chunks      : ${c.total}`);
  console.log(`null searchVector : ${c.null_sv}`);
  console.log(`null embedding    : ${c.null_emb}`);

  // Sample three rows so we can eyeball whether to_tsvector produced tokens
  // matching the test query.
  const samples = await prisma.$queryRaw`
    SELECT "id",
           LEFT("content", 120)        AS preview,
           "searchVector"::text        AS sv_text
      FROM "KnowledgeChunk"
     WHERE "tenantId" = ${tenant.id}
     ORDER BY random()
     LIMIT 3
  `;
  for (const s of samples) {
    console.log(`\nchunk ${s.id}:`);
    console.log(`  preview     : ${s.preview.replace(/\s+/g, " ")}`);
    console.log(`  sv prefix   : ${(s.sv_text ?? "").slice(0, 240)}`);
  }

  // ── (b) the exact lexicalSearch query, run live ───────────────────────────
  hr("b. live lexicalSearch SQL with query='Redis database'");

  const lexHits = await prisma.$queryRaw`
    SELECT k."id"        AS "chunkId",
           k."sourceId"  AS "sourceId",
           s."name"      AS "sourceName",
           s."type"      AS "sourceType",
           LEFT(k."content", 120) AS "preview",
           ts_rank(k."searchVector", plainto_tsquery('simple', ${QUERY})) AS "score"
      FROM "KnowledgeChunk" k
      JOIN "KnowledgeSource" s ON s."id" = k."sourceId"
     WHERE k."tenantId" = ${tenant.id}
       AND k."searchVector" @@ plainto_tsquery('simple', ${QUERY})
     ORDER BY "score" DESC
     LIMIT 50
  `;
  console.log(`row count: ${lexHits.length}`);
  if (lexHits.length > 0) {
    const top = lexHits[0];
    console.log(`top hit  : score=${Number(top.score).toFixed(4)} source=${top.sourceName}`);
    console.log(`            preview="${top.preview.replace(/\s+/g, " ")}"`);
  }

  const tsq = await prisma.$queryRaw`
    SELECT plainto_tsquery('simple',  ${QUERY})::text AS simple_q,
           plainto_tsquery('english', ${QUERY})::text AS english_q
  `;
  console.log(`\nplainto_tsquery('simple',  '${QUERY}') -> ${tsq[0].simple_q}`);
  console.log(`plainto_tsquery('english', '${QUERY}') -> ${tsq[0].english_q}`);

  const predicateCounts = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE "searchVector" @@ plainto_tsquery('simple',  ${QUERY}))::bigint AS simple_match,
      COUNT(*) FILTER (WHERE "searchVector" @@ plainto_tsquery('english', ${QUERY}))::bigint AS english_match
    FROM "KnowledgeChunk"
    WHERE "tenantId" = ${tenant.id}
  `;
  console.log(
    `predicate matches: simple=${predicateCounts[0].simple_match}, english=${predicateCounts[0].english_match}`,
  );

  const ilikeCounts = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE "content" ILIKE '%redis%')::bigint    AS has_redis,
      COUNT(*) FILTER (WHERE "content" ILIKE '%database%')::bigint AS has_database,
      COUNT(*) FILTER (WHERE "content" ILIKE '%redis%' OR "content" ILIKE '%database%')::bigint AS has_either
    FROM "KnowledgeChunk"
    WHERE "tenantId" = ${tenant.id}
  `;
  console.log(
    `ILIKE counts:    redis=${ilikeCounts[0].has_redis}, database=${ilikeCounts[0].has_database}, either=${ilikeCounts[0].has_either}`,
  );
} catch (err) {
  console.error("\ndiag failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
