/**
 * Calls retriever.retrieve() directly so we can inspect what each modality
 * actually returns vs. what fuse() emits. Companion to lexical-diag.mjs.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/lexical-diag-retrieve.ts
 */

import { prisma } from "@/server/db/client";
import { lexicalSearch, vectorSearch } from "@/server/db/knowledge";
import { embed } from "@/server/ai/embeddings";
import { retrieve } from "@/server/knowledge/retriever";
import { RETRIEVAL_CANDIDATE_POOL } from "@/server/knowledge/limits";

// Override via CLI: `npx tsx scripts/lexical-diag-retrieve.ts "your query"`.
const QUERY = process.argv[2] ?? "Redis database";

async function main(): Promise<void> {
  // Pick the same tenant lexical-diag.mjs picked: max chunks.
  const [tenantRow] = await prisma.$queryRaw<
    Array<{ id: string; slug: string; name: string; cnt: bigint }>
  >`
    SELECT t."id", t."slug", t."name", COUNT(k."id")::bigint AS cnt
      FROM "Tenant" t
      LEFT JOIN "KnowledgeChunk" k ON k."tenantId" = t."id"
     GROUP BY t."id", t."slug", t."name"
     ORDER BY cnt DESC, t."createdAt" ASC
     LIMIT 1
  `;
  if (!tenantRow) throw new Error("No tenants");
  console.log(`tenant: ${tenantRow.name} (${tenantRow.slug}) chunks=${tenantRow.cnt}`);

  // Mirror retriever.retrieve() inputs.
  const queryEmbedding = await embed({ inputs: [QUERY], inputType: "query" });
  const queryVector = queryEmbedding.vectors[0]!;
  console.log(`embed provider: ${queryEmbedding.provider} (${queryVector.length} dims)`);

  const [vec, lex] = await Promise.all([
    vectorSearch({
      tenantId: tenantRow.id,
      queryVector,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
    lexicalSearch({
      tenantId: tenantRow.id,
      query: QUERY,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
  ]);
  console.log(`\nvectorSearch:  ${vec.length} hits`);
  console.log(`lexicalSearch: ${lex.length} hits`);

  // Critical check: are lex.score values actually `number`s, or did Prisma
  // hand us strings/Decimals/null? Inspect the first hit shape.
  if (lex[0]) {
    const h = lex[0];
    console.log(`\nlex[0] keys:   ${Object.keys(h).join(", ")}`);
    console.log(`lex[0].score:  ${typeof h.score} = ${JSON.stringify(h.score)}`);
    console.log(`lex[0].chunkId:${typeof h.chunkId} = ${h.chunkId}`);
  }
  if (vec[0]) {
    const h = vec[0];
    console.log(`vec[0].score:  ${typeof h.score} = ${JSON.stringify(h.score)}`);
    console.log(`vec[0].chunkId:${typeof h.chunkId} = ${h.chunkId}`);
  }

  // Overlap: how many of the top-50 lex hits also appear in top-50 vec?
  const vecIds = new Set(vec.map((h) => h.chunkId));
  const lexIds = new Set(lex.map((h) => h.chunkId));
  const overlap = lex.filter((h) => vecIds.has(h.chunkId)).length;
  console.log(`\noverlap (lex ∩ vec): ${overlap}`);
  console.log(`vec-only:            ${vec.filter((h) => !lexIds.has(h.chunkId)).length}`);
  console.log(`lex-only:            ${lex.filter((h) => !vecIds.has(h.chunkId)).length}`);

  // Now the actual fused output the UI sees.
  const fused = await retrieve({
    tenantId: tenantRow.id,
    query: QUERY,
    topK: 8,
  });
  console.log(`\nretrieve() top-${fused.length}:`);
  for (let i = 0; i < fused.length; i++) {
    const h = fused[i]!;
    console.log(
      `  ${i + 1}. rrf=${h.rrfScore.toFixed(4)}  ` +
        `vec=${h.vectorScore != null ? h.vectorScore.toFixed(3) : "—"} (rank ${h.vectorRank ?? "—"})  ` +
        `lex=${h.lexicalScore != null ? String(h.lexicalScore) : "—"} (rank ${h.lexicalRank ?? "—"})  ` +
        `src=${h.sourceName}`,
    );
  }

  // How many of the top-8 had ANY lexical signal at all?
  const withLex = fused.filter((h) => h.lexicalScore != null).length;
  console.log(`\ntop-8 with lexicalScore != null: ${withLex} / ${fused.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("diag failed:", err);
    process.exit(1);
  });
