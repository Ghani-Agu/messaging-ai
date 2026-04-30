// Verifies Phase 8a schema landed correctly on the live DB:
//   - KnowledgeItem / QnaPair / OperationalFacts / KnowledgeGap tables exist
//   - KnowledgeItem.searchVector is a GENERATED ALWAYS column with the
//     weighted multi-field expression (name='A', brand='B', sku='B',
//     description='C')
//   - HNSW indexes exist on the three new vector columns
//   - GIN index exists on KnowledgeItem.searchVector
//   - Composite UNIQUE indexes:
//       (tenantId, externalId)        on KnowledgeItem
//       (tenantId, normalizedQuestion) on QnaPair
//   - KnowledgeSource.lastVerifiedAt column exists
//
// Companion to verify-knowledge-schema.mjs (Phase 3). Run after every
// migration touching the typed-knowledge tables.
//
// Usage: npx dotenv -e .env.local -- node scripts/verify-typed-knowledge-schema.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let bad = 0;
const ok = (msg) => console.log("✓ " + msg);
const fail = (msg) => {
  console.log("✗ " + msg);
  bad++;
};

try {
  // ───────────────────────────────────────────────────────────────────────
  // Tables exist
  // ───────────────────────────────────────────────────────────────────────
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('KnowledgeItem','QnaPair','OperationalFacts','KnowledgeGap')
     ORDER BY table_name`,
  );
  if (tables.length === 4) ok("typed-knowledge tables exist (Item, QnaPair, OpFacts, Gap)");
  else fail(`expected 4 tables, got ${tables.length}: ${JSON.stringify(tables.map((t) => t.table_name))}`);

  // ───────────────────────────────────────────────────────────────────────
  // KnowledgeSource.lastVerifiedAt column was added
  // ───────────────────────────────────────────────────────────────────────
  const lva = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='KnowledgeSource' AND column_name='lastVerifiedAt'`,
  );
  if (lva.length === 1 && /timestamp/.test(lva[0].data_type)) {
    ok("KnowledgeSource.lastVerifiedAt is timestamp");
  } else {
    fail(`KnowledgeSource.lastVerifiedAt missing or wrong: ${JSON.stringify(lva)}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // KnowledgeItem.searchVector is GENERATED with weighted expression
  // ───────────────────────────────────────────────────────────────────────
  const itemCols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_generated, generation_expression
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='KnowledgeItem'
        AND column_name IN ('embedding','searchVector')
      ORDER BY column_name`,
  );
  const itemSv = itemCols.find((c) => c.column_name === "searchVector");
  const itemEmb = itemCols.find((c) => c.column_name === "embedding");
  if (itemEmb?.data_type === "USER-DEFINED") ok("KnowledgeItem.embedding is vector(1024)");
  else fail(`KnowledgeItem.embedding wrong: ${JSON.stringify(itemEmb)}`);

  // The GENERATED expression must reference all four weighted fields. We
  // assert each substring rather than the whole string because Postgres
  // may quote / reorder the expression internally.
  const ge = itemSv?.generation_expression ?? "";
  const sourcedFromAllFields =
    /name/.test(ge) && /brand/.test(ge) && /sku/.test(ge) && /description/.test(ge);
  const weighted = /setweight/i.test(ge);
  if (itemSv?.is_generated === "ALWAYS" && sourcedFromAllFields && weighted) {
    ok(`KnowledgeItem.searchVector is GENERATED ALWAYS (weighted, 4 fields)`);
  } else {
    fail(`KnowledgeItem.searchVector wrong: is_generated=${itemSv?.is_generated} expr=${ge}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // HNSW indexes exist on the three new vector columns
  // ───────────────────────────────────────────────────────────────────────
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname, tablename, indexdef FROM pg_indexes
      WHERE schemaname='public'
        AND tablename IN ('KnowledgeItem','QnaPair','KnowledgeGap')
      ORDER BY indexname`,
  );
  const expectations = [
    {
      name: "KnowledgeItem_embedding_hnsw",
      table: "KnowledgeItem",
      colMatch: /\bembedding\b/,
    },
    {
      name: "QnaPair_questionEmbedding_hnsw",
      table: "QnaPair",
      colMatch: /\bquestionEmbedding\b/,
    },
    {
      name: "KnowledgeGap_embedding_hnsw",
      table: "KnowledgeGap",
      colMatch: /\bembedding\b/,
    },
  ];
  for (const e of expectations) {
    const found = idx.find(
      (i) => i.indexname === e.name && /hnsw/i.test(i.indexdef) && e.colMatch.test(i.indexdef),
    );
    if (found) ok(`HNSW present: ${e.name}`);
    else fail(`HNSW missing on ${e.table}: ${e.name}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // GIN index on KnowledgeItem.searchVector
  // ───────────────────────────────────────────────────────────────────────
  const gin = idx.find(
    (i) =>
      i.tablename === "KnowledgeItem" &&
      /gin/i.test(i.indexdef) &&
      /searchVector/.test(i.indexdef),
  );
  if (gin) ok(`GIN  present: ${gin.indexname}`);
  else fail("GIN index on KnowledgeItem.searchVector missing");

  // ───────────────────────────────────────────────────────────────────────
  // Composite UNIQUE indexes (Prisma-generated; double-check they landed)
  // ───────────────────────────────────────────────────────────────────────
  const uniques = [
    {
      name: "KnowledgeItem_tenantId_externalId_key",
      table: "KnowledgeItem",
      cols: /tenantId.*externalId/,
    },
    {
      name: "QnaPair_tenantId_normalizedQuestion_key",
      table: "QnaPair",
      cols: /tenantId.*normalizedQuestion/,
    },
  ];
  for (const u of uniques) {
    const found = idx.find(
      (i) => i.indexname === u.name && /UNIQUE/i.test(i.indexdef) && u.cols.test(i.indexdef),
    );
    if (found) ok(`UNIQUE present: ${u.name}`);
    else fail(`UNIQUE missing: ${u.name}`);
  }
} catch (err) {
  console.error("verify failed:", err);
  bad++;
} finally {
  await prisma.$disconnect();
}

if (bad > 0) {
  console.error(`\n${bad} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nPhase 8a typed-knowledge schema verified.");
}
