import "server-only";
import type { Prisma, ItemAvailability, SourceType } from "@prisma/client";
import { embed, type EmbedProvider } from "@/server/ai/embeddings";
import {
  lexicalSearch,
  vectorSearch,
  type RawSearchHit,
} from "@/server/db/knowledge";
import {
  lexicalSearchItems,
  vectorSearchItems,
  type RawItemHit,
} from "@/server/db/items";
import { vectorSearchQna } from "@/server/db/qna";
import {
  QNA_MATCH_THRESHOLD,
  RETRIEVAL_CANDIDATE_POOL,
  RETRIEVAL_DEFAULT_TOP_K,
  RRF_K,
} from "./limits";
import type { SupportedLanguage } from "@/lib/validators";

/**
 * Retrieval — three channels, all tenant-scoped:
 *
 *   - retrieveChunks       (Phase 3): hybrid vector + lexical, RRF fused
 *   - retrieveItems        (Phase 8c): hybrid vector + lexical, RRF fused
 *   - retrieveQnaMatches   (Phase 8c): vector-only, threshold-gated, with
 *                                       optional language-lock filter
 *
 * Each retriever embeds the query if `queryVector` isn't pre-supplied. The
 * orchestrator passes the same vector to all three to avoid re-embedding;
 * unit tests typically pass a fresh string query. RRF k = 60 (Cormack et
 * al., shared with chunks).
 *
 * `retrieve` (Phase 3) is kept as a deprecated alias for `retrieveChunks`
 * so older callers / external scripts don't break in lockstep with the
 * P8c rename.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Chunks (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

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

export async function retrieveChunks(args: {
  tenantId: string;
  query: string;
  /** Pre-computed query embedding. When omitted, the retriever embeds. */
  queryVector?: number[];
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];
  const topK = args.topK ?? RETRIEVAL_DEFAULT_TOP_K;

  const { vector, provider } = await ensureQueryVector(trimmed, args.queryVector);

  const [vectorHits, lexicalHits] = await Promise.all([
    vectorSearch({
      tenantId: args.tenantId,
      queryVector: vector,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
    lexicalSearch({
      tenantId: args.tenantId,
      query: trimmed,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
  ]);

  return fuseChunks({ vectorHits, lexicalHits, topK, embedProvider: provider });
}

/** Phase-3 alias kept for in-tree imports that haven't moved to retrieveChunks. */
export const retrieve = retrieveChunks;

function fuseChunks(args: {
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

// ─────────────────────────────────────────────────────────────────────────────
// Items (Phase 8c) — hybrid vector + lexical with RRF.
// ─────────────────────────────────────────────────────────────────────────────

export type RetrievedItem = {
  itemId: string;
  name: string;
  category: string | null;
  brand: string | null;
  sku: string | null;
  currency: string | null;
  priceCents: number | null;
  availability: ItemAvailability;
  description: string | null;
  specs: Prisma.JsonValue;
  vectorScore: number | null;
  vectorRank: number | null;
  lexicalScore: number | null;
  lexicalRank: number | null;
  rrfScore: number;
};

export async function retrieveItems(args: {
  tenantId: string;
  query: string;
  queryVector?: number[];
  topK?: number;
}): Promise<RetrievedItem[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];
  const topK = args.topK ?? RETRIEVAL_DEFAULT_TOP_K;

  const { vector } = await ensureQueryVector(trimmed, args.queryVector);

  const [vectorHits, lexicalHits] = await Promise.all([
    vectorSearchItems({
      tenantId: args.tenantId,
      queryVector: vector,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
    lexicalSearchItems({
      tenantId: args.tenantId,
      query: trimmed,
      limit: RETRIEVAL_CANDIDATE_POOL,
    }),
  ]);

  return fuseItems({ vectorHits, lexicalHits, topK });
}

function fuseItems(args: {
  vectorHits: RawItemHit[];
  lexicalHits: RawItemHit[];
  topK: number;
}): RetrievedItem[] {
  const byId = new Map<string, RetrievedItem>();
  const ensure = (h: RawItemHit): RetrievedItem => {
    let existing = byId.get(h.itemId);
    if (!existing) {
      existing = {
        itemId: h.itemId,
        name: h.name,
        category: h.category,
        brand: h.brand,
        sku: h.sku,
        currency: h.currency,
        priceCents: h.priceCents,
        availability: h.availability,
        description: h.description,
        specs: h.specs,
        vectorScore: null,
        vectorRank: null,
        lexicalScore: null,
        lexicalRank: null,
        rrfScore: 0,
      };
      byId.set(h.itemId, existing);
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

// ─────────────────────────────────────────────────────────────────────────────
// Q&A (Phase 8c) — vector-only, threshold-gated, language-lock filter.
// ─────────────────────────────────────────────────────────────────────────────

export type RetrievedQna = {
  qnaId: string;
  question: string;
  answer: string;
  language: string | null;
  languageLock: boolean;
  tags: string[];
  score: number; // cosine similarity
};

/**
 * Retrieve Q&A matches above the threshold for the customer's question.
 *
 * Two filters apply:
 *   1. score >= threshold (default QNA_MATCH_THRESHOLD = 0.85 per Gate-1
 *      K3 — tightened from the originally proposed 0.82). Below this floor,
 *      the question falls through to normal hybrid retrieval; the brain
 *      doesn't see a Q&A injection.
 *   2. languageLock filter: if a Q&A row has languageLock=true, it only
 *      matches when `detectedLanguage` equals the row's `language`. When
 *      languageLock=false (the default), the Q&A applies cross-language
 *      and the brain handles register-translation in the reply.
 *
 * Returns up to `topK` matches sorted by score descending. The orchestrator
 * typically takes the top-1 match for authoritative-answer injection; the
 * full list is available for debug / future multi-Q&A blending.
 */
export async function retrieveQnaMatches(args: {
  tenantId: string;
  query: string;
  queryVector?: number[];
  threshold?: number;
  detectedLanguage?: SupportedLanguage;
  topK?: number;
}): Promise<RetrievedQna[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];
  const threshold = args.threshold ?? QNA_MATCH_THRESHOLD;
  const topK = args.topK ?? 5;

  const { vector } = await ensureQueryVector(trimmed, args.queryVector);

  const hits = await vectorSearchQna({
    tenantId: args.tenantId,
    queryVector: vector,
    // Pull a wider candidate pool than topK to absorb language-lock
    // filtering — locked rows that don't match the detected language
    // get dropped post-query.
    limit: RETRIEVAL_CANDIDATE_POOL,
  });

  const filtered: RetrievedQna[] = [];
  for (const h of hits) {
    if (h.score < threshold) continue;
    if (h.languageLock && h.language && args.detectedLanguage) {
      if (h.language !== args.detectedLanguage) continue;
    }
    filtered.push({
      qnaId: h.qnaId,
      question: h.question,
      answer: h.answer,
      language: h.language,
      languageLock: h.languageLock,
      tags: h.tags,
      score: h.score,
    });
    if (filtered.length >= topK) break;
  }
  return filtered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper
// ─────────────────────────────────────────────────────────────────────────────

async function ensureQueryVector(
  query: string,
  pre?: number[],
): Promise<{ vector: number[]; provider: EmbedProvider }> {
  if (pre) {
    // Caller embedded once and is sharing across channels. We don't know
    // which provider produced the vector — that's only relevant for
    // diagnostic reporting on chunk hits, where we display the provider
    // in the dashboard. When pre-supplied, default to "voyage" since that's
    // the primary path; the rare OpenAI-fallback case will mis-label
    // diagnostically but won't change behavior.
    return { vector: pre, provider: "voyage" };
  }
  const r = await embed({ inputs: [query], inputType: "query" });
  return { vector: r.vectors[0]!, provider: r.provider };
}
