import "server-only";
import type { Prisma, SourceType } from "@prisma/client";
import { embed, type EmbedProvider } from "@/server/ai/embeddings";
import {
  lexicalSearch,
  vectorSearch,
  type RawSearchHit,
} from "@/server/db/knowledge";
import {
  RETRIEVAL_CANDIDATE_POOL,
  RETRIEVAL_DEFAULT_TOP_K,
  RRF_K,
} from "./limits";

/**
 * Hybrid retrieval — vector + lexical, fused by Reciprocal Rank Fusion.
 *
 * Both modalities pull RETRIEVAL_CANDIDATE_POOL (top 50) candidates, then
 * RRF merges them: a chunk that ranks well in either list bubbles up, but
 * a chunk that ranks well in *both* dominates. The k constant is the
 * standard RRF=60 from Cormack et al.
 *
 * Score breakdown is preserved per-hit so the retrieval test panel can
 * show both contributions (the score column trio in the UI).
 */

export type RetrievedChunk = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  content: string;
  metadata: Prisma.JsonValue;
  vectorScore: number | null; // 1 - cosine_distance, null if not in vector top-N
  vectorRank: number | null;  // 1-based rank in the vector list
  lexicalScore: number | null;
  lexicalRank: number | null;
  rrfScore: number;
  embedProvider: EmbedProvider;
};

export async function retrieve(args: {
  tenantId: string;
  query: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];
  const topK = args.topK ?? RETRIEVAL_DEFAULT_TOP_K;

  const queryEmbedding = await embed({
    inputs: [trimmed],
    inputType: "query",
  });
  const queryVector = queryEmbedding.vectors[0]!;

  const [vectorHits, lexicalHits] = await Promise.all([
    vectorSearch({
      tenantId: args.tenantId,
      queryVector,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
    lexicalSearch({
      tenantId: args.tenantId,
      query: trimmed,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
  ]);

  return fuse({
    vectorHits,
    lexicalHits,
    topK,
    embedProvider: queryEmbedding.provider,
  });
}

function fuse(args: {
  vectorHits: RawSearchHit[];
  lexicalHits: RawSearchHit[];
  topK: number;
  embedProvider: EmbedProvider;
}): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();

  const ensure = (h: RawSearchHit): RetrievedChunk => {
    let existing = byId.get(h.chunkId);
    if (!existing) {
      existing = {
        chunkId: h.chunkId,
        sourceId: h.sourceId,
        sourceName: h.sourceName,
        sourceType: h.sourceType,
        content: h.content,
        metadata: h.metadata,
        vectorScore: null,
        vectorRank: null,
        lexicalScore: null,
        lexicalRank: null,
        rrfScore: 0,
        embedProvider: args.embedProvider,
      };
      byId.set(h.chunkId, existing);
    }
    return existing;
  };

  args.vectorHits.forEach((hit, i) => {
    const rank = i + 1;
    const row = ensure(hit);
    row.vectorScore = hit.score;
    row.vectorRank = rank;
    row.rrfScore += 1 / (RRF_K + rank);
  });

  args.lexicalHits.forEach((hit, i) => {
    const rank = i + 1;
    const row = ensure(hit);
    row.lexicalScore = hit.score;
    row.lexicalRank = rank;
    row.rrfScore += 1 / (RRF_K + rank);
  });

  return [...byId.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, args.topK);
}
