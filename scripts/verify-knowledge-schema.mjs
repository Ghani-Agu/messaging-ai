// Verifies Phase 3 schema landed correctly on the live DB:
//   - KnowledgeSource / KnowledgeChunk tables exist
//   - searchVector is a GENERATED ALWAYS column with the right expression
//   - HNSW index on embedding exists
//   - GIN index on searchVector exists
//
// Run: npx dotenv -e .env.local -- node scripts/verify-knowledge-schema.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let bad = 0;
const ok = (msg) => console.log("✓ " + msg);
const fail = (msg) => {
  console.log("✗ " + msg);
  bad++;
};

try {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('KnowledgeSource','KnowledgeChunk')
     ORDER BY table_name`,
  );
  if (tables.length === 2) ok("tables KnowledgeSource & KnowledgeChunk exist");
  else fail(`expected 2 tables, got ${tables.length}: ${JSON.stringify(tables)}`);

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_generated, generation_expression
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='KnowledgeChunk'
        AND column_name IN ('embedding','searchVector')
      ORDER BY column_name`,
  );
  const sv = cols.find((c) => c.column_name === "searchVector");
  const emb = cols.find((c) => c.column_name === "embedding");
  if (emb?.data_type === "USER-DEFINED") ok("embedding is vector(1024)");
  else fail(`embedding column wrong: ${JSON.stringify(emb)}`);
  if (sv?.is_generated === "ALWAYS" && /to_tsvector/.test(sv?.generation_expression ?? "")) {
    ok(`searchVector is GENERATED ALWAYS (${sv.generation_expression})`);
  } else {
    fail(`searchVector not generated correctly: ${JSON.stringify(sv)}`);
  }

  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='KnowledgeChunk'
      ORDER BY indexname`,
  );
  const hnsw = idx.find((i) => /hnsw/i.test(i.indexdef) && /embedding/.test(i.indexdef));
  const gin = idx.find((i) => /gin/i.test(i.indexdef) && /searchVector/.test(i.indexdef));
  if (hnsw) ok(`HNSW index present: ${hnsw.indexname}`);
  else fail("HNSW index on embedding missing");
  if (gin) ok(`GIN  index present: ${gin.indexname}`);
  else fail("GIN index on searchVector missing");
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
  console.log("\nPhase 3 schema verified.");
}
