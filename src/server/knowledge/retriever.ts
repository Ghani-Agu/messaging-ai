import "server-only";
import type { Prisma, ItemAvailability, SourceType } from "@prisma/client";
import { embed, type EmbedProvider } from "@/server/ai/embeddings";
import {
  lexicalSearch,
  vectorSearch,
  type RawSearchHit,
} from "@/server/db/knowledge";
import {
  keywordSearchItems,
  lexicalSearchItems,
  vectorSearchItems,
  type RawItemHit,
} from "@/server/db/items";
import { vectorSearchQna } from "@/server/db/qna";
import {
  QNA_CROSS_LANGUAGE_THRESHOLD,
  QNA_MATCH_THRESHOLD,
  RETRIEVAL_CANDIDATE_POOL,
  RETRIEVAL_DEFAULT_TOP_K,
  RRF_K,
} from "./limits";
import type { SupportedLanguage } from "@/lib/validators";
import type { BrandSummary } from "@/server/ai/prompts/system";

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

/**
 * Stopwords stripped before keyword retrieval. Intentionally short —
 * covers the highest-frequency Darija / French / English filler words
 * that aren't product/brand-discriminating. Anything longer would risk
 * dropping real query tokens (e.g. brand abbreviations).
 */
const KEYWORD_STOPWORDS = new Set([
  // Darija / Arabizi
  "wsh", "wash", "wesh", "3andkom", "3andek", "3andna", "kayen", "rani", "raki",
  "khouya", "khoya", "men", "ta3", "ta3kom", "ta3i", "fi", "f", "wa", "wala",
  "bsh", "bash", "hadi", "hada", "hadak",
  // French
  "est", "ce", "que", "vous", "le", "la", "les", "des", "du", "de", "et", "un",
  "une", "ou", "où", "qui", "quoi", "avec", "pour", "dans", "par", "sur",
  // English
  "is", "the", "a", "an", "in", "on", "of", "for", "to", "and", "or", "do",
  "have", "has", "with", "from", "you", "your", "what", "any",
]);

/**
 * Extract significant tokens for keyword search from the customer message.
 * Drops stopwords + tokens shorter than 3 chars. Lowercased for stopword
 * comparison; the DB query uses ILIKE so case-folding at the DB layer
 * handles brand capitalisation differences (AJAX vs ajax).
 *
 * Returns deduplicated tokens in original order. Cap at 6 to bound the
 * number of parallel keyword queries (one per token) per retrieval call.
 */
export function extractSignificantTokens(query: string): string[] {
  const raw = query
    .split(/[^A-Za-zÀ-ÿ0-9؀-ۿ]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    const lower = token.toLowerCase();
    if (KEYWORD_STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(token);
    if (out.length >= 6) break;
  }
  return out;
}

const KEYWORD_MAX_RESULTS = 30;
/** Min keyword-hit count for the keyword path to override pure RRF ranking. */
const KEYWORD_MERGE_THRESHOLD = 3;
/** Top slots reserved for keyword matches when the merge path fires. */
const KEYWORD_TOP_SLOTS = 5;
/** Min same-brand count in the keyword pool to render a [BRAND SUMMARY] line. */
const BRAND_SUMMARY_THRESHOLD = 3;
/** Cap on the number of [BRAND SUMMARY] lines (top brands by count). */
const BRAND_SUMMARY_MAX = 3;

export type ItemRetrievalResult = {
  items: RetrievedItem[];
  /**
   * Aggregate brand counts from the WIDER keyword candidate pool (up to
   * KEYWORD_MAX_RESULTS=30 rows). Lets the brain answer brand-frequency
   * questions like "3andkom Ajax?" using catalog-level counts even when
   * only top-K=8 items make it into the citation list. Empty when no
   * brand reaches BRAND_SUMMARY_THRESHOLD (3) in the pool.
   */
  brandSummaries: BrandSummary[];
};

export async function retrieveItems(args: {
  tenantId: string;
  query: string;
  queryVector?: number[];
  topK?: number;
}): Promise<ItemRetrievalResult> {
  const trimmed = args.query.trim();
  if (!trimmed) return { items: [], brandSummaries: [] };
  const topK = args.topK ?? RETRIEVAL_DEFAULT_TOP_K;

  const { vector } = await ensureQueryVector(trimmed, args.queryVector);
  const tokens = extractSignificantTokens(trimmed);

  // Run vector + lexical + per-token keyword searches in parallel. Each
  // is independent; merging happens below.
  const [vectorHits, lexicalHits, keywordHits] = await Promise.all([
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
    runKeywordSearch({
      tenantId: args.tenantId,
      tokens,
      limit: KEYWORD_MAX_RESULTS,
    }),
  ]);

  return {
    items: mergeItems({ vectorHits, lexicalHits, keywordHits, topK }),
    brandSummaries: computeBrandSummaries(keywordHits),
  };
}

/**
 * Group keyword pool by brand, count availability, return top-N brands
 * that meet the BRAND_SUMMARY_THRESHOLD (3). The wider pool (up to 30
 * keyword hits) means the counts reflect what's actually in the catalog
 * for the brand the customer asked about, not just the top-K cited rows.
 *
 * Items with brand=null are skipped (no useful "summary by brand" to
 * render when the catalog doesn't carry brand metadata).
 */
function computeBrandSummaries(keywordHits: RawItemHit[]): BrandSummary[] {
  const byBrand = new Map<
    string,
    { total: number; inStock: number; outOfStock: number }
  >();
  for (const h of keywordHits) {
    if (!h.brand) continue;
    let entry = byBrand.get(h.brand);
    if (!entry) {
      entry = { total: 0, inStock: 0, outOfStock: 0 };
      byBrand.set(h.brand, entry);
    }
    entry.total += 1;
    if (h.availability === "IN_STOCK") entry.inStock += 1;
    else if (h.availability === "OUT_OF_STOCK") entry.outOfStock += 1;
  }
  const summaries: BrandSummary[] = [];
  for (const [brand, counts] of byBrand) {
    if (counts.total < BRAND_SUMMARY_THRESHOLD) continue;
    summaries.push({ brand, ...counts });
  }
  return summaries
    .sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand))
    .slice(0, BRAND_SUMMARY_MAX);
}

/**
 * Per-token keyword search, unioned across tokens. Each token-search
 * returns up to `limit` rows; results are deduplicated by itemId and
 * capped at `limit` total to bound the merge work below.
 *
 * Score precedence: an item's keyword score is the MAX across all token
 * matches for that item (so an item that matches both "ajax" and "alarme"
 * still gets the brand-match boost from "ajax").
 */
async function runKeywordSearch(args: {
  tenantId: string;
  tokens: string[];
  limit: number;
}): Promise<RawItemHit[]> {
  if (args.tokens.length === 0) return [];
  const perToken = await Promise.all(
    args.tokens.map((token) =>
      keywordSearchItems({
        tenantId: args.tenantId,
        token,
        limit: args.limit,
      }),
    ),
  );
  const byId = new Map<string, RawItemHit>();
  for (const hits of perToken) {
    for (const hit of hits) {
      const existing = byId.get(hit.itemId);
      if (!existing || hit.score > existing.score) byId.set(hit.itemId, hit);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, args.limit);
}

/**
 * Merge keyword + vector + lexical hits.
 *
 * When keyword search returns >= KEYWORD_MERGE_THRESHOLD (3) rows, we
 * surface keyword matches in the top KEYWORD_TOP_SLOTS (5) positions
 * (deterministic — brand queries should reliably return brand items),
 * then fill remaining slots with the RRF-fused vector+lexical top
 * results not already in the set. When keyword returns fewer than 3
 * rows, we fall back to pure vector+lexical RRF (same as before).
 *
 * The split means brand-name queries surface their items even when the
 * embedding signal is weak (sparse-text catalogs), while semantic
 * queries continue to rank by RRF.
 */
function mergeItems(args: {
  vectorHits: RawItemHit[];
  lexicalHits: RawItemHit[];
  keywordHits: RawItemHit[];
  topK: number;
}): RetrievedItem[] {
  const fusion = fuseItems({
    vectorHits: args.vectorHits,
    lexicalHits: args.lexicalHits,
    topK: args.topK,
  });
  if (args.keywordHits.length < KEYWORD_MERGE_THRESHOLD) {
    return fusion;
  }
  const out: RetrievedItem[] = [];
  const seen = new Set<string>();
  // First N slots: keyword matches (already sorted by score from
  // runKeywordSearch).
  for (const hit of args.keywordHits) {
    if (out.length >= KEYWORD_TOP_SLOTS) break;
    out.push(keywordHitToRetrieved(hit));
    seen.add(hit.itemId);
  }
  // Remaining slots: fused vector+lexical top results, skipping anything
  // already in the keyword slot list.
  for (const row of fusion) {
    if (out.length >= args.topK) break;
    if (seen.has(row.itemId)) continue;
    out.push(row);
    seen.add(row.itemId);
  }
  // If we still have headroom and unused keyword hits, fill from those
  // (catalog has more matching items than the vector path found).
  for (const hit of args.keywordHits) {
    if (out.length >= args.topK) break;
    if (seen.has(hit.itemId)) continue;
    out.push(keywordHitToRetrieved(hit));
    seen.add(hit.itemId);
  }
  return out;
}

function keywordHitToRetrieved(hit: RawItemHit): RetrievedItem {
  return {
    itemId: hit.itemId,
    name: hit.name,
    category: hit.category,
    brand: hit.brand,
    sku: hit.sku,
    currency: hit.currency,
    priceCents: hit.priceCents,
    availability: hit.availability,
    description: hit.description,
    specs: hit.specs,
    vectorScore: null,
    vectorRank: null,
    lexicalScore: null,
    lexicalRank: null,
    // RRF score in the (1/RRF_K..) band — typical fused values; lets the
    // confidence formula treat keyword matches as comparable retrieval signal.
    rrfScore: 1 / (RRF_K + 1),
  };
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
  /**
   * Phase 8e-3: true when the match fired below the same-language safety
   * threshold (i.e., via the cross-language relaxed threshold). Surfaced
   * in the conversations dashboard so operators can spot any false
   * positives crossing languages.
   *
   * Specifically: `score < QNA_MATCH_THRESHOLD` (0.85). At-or-above the
   * same-language floor is high confidence regardless of which language
   * pair fired, so we don't flag those even when languages differ.
   */
  crossLanguageMatch: boolean;
};

/**
 * Retrieve Q&A matches for the customer's question. Two-tier threshold
 * (Phase 8e-3) with the language-lock filter applied on top:
 *
 *   1. THRESHOLD selection per candidate:
 *        - Same-language (h.language === detectedLanguage, both non-null):
 *          QNA_MATCH_THRESHOLD (0.85) — high-confidence safety floor.
 *        - Otherwise (different languages, or either is null):
 *          QNA_CROSS_LANGUAGE_THRESHOLD (0.65) — Voyage's multilingual
 *          embedding produces lower cosine similarity across languages,
 *          so we relax the floor. Matches that fire here are flagged
 *          `crossLanguageMatch: true` for dashboard auditing.
 *      Below the applicable threshold the question falls through to
 *      normal hybrid retrieval; the brain doesn't see a Q&A injection.
 *
 *   2. LANGUAGE-LOCK filter (independent, hard): if a Q&A row has
 *      languageLock=true, it only matches when languages are equal,
 *      regardless of score. The two-tier threshold doesn't loosen the
 *      lock — locked Q&A is still cross-language-blocked.
 *
 * Returns up to `topK` matches sorted by score descending. The orchestrator
 * typically takes the top-1 match for authoritative-answer injection.
 */
export async function retrieveQnaMatches(args: {
  tenantId: string;
  query: string;
  queryVector?: number[];
  /** Override the same-language threshold (default QNA_MATCH_THRESHOLD = 0.85). */
  threshold?: number;
  /** Override the cross-language threshold (default QNA_CROSS_LANGUAGE_THRESHOLD = 0.65). */
  crossLanguageThreshold?: number;
  detectedLanguage?: SupportedLanguage;
  topK?: number;
}): Promise<RetrievedQna[]> {
  const trimmed = args.query.trim();
  if (!trimmed) return [];
  const sameLanguageThreshold = args.threshold ?? QNA_MATCH_THRESHOLD;
  const crossLanguageThreshold =
    args.crossLanguageThreshold ?? QNA_CROSS_LANGUAGE_THRESHOLD;
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
    // Hard filter: language lock blocks cross-language matches regardless
    // of score. Applied first so a low-score locked candidate doesn't even
    // get its threshold computed.
    if (h.languageLock && h.language && args.detectedLanguage) {
      if (h.language !== args.detectedLanguage) continue;
    }

    // Determine which threshold applies. Same-language requires both the
    // Q&A's declared language and the detected language to be non-null
    // and equal; everything else (mismatch, either side null) is treated
    // as cross-language and gets the relaxed floor.
    const sameLanguage =
      !!h.language &&
      !!args.detectedLanguage &&
      h.language === args.detectedLanguage;
    const threshold = sameLanguage
      ? sameLanguageThreshold
      : crossLanguageThreshold;

    if (h.score < threshold) continue;

    // Mark cross-language when the match fired below the same-language
    // safety floor — that's the operator-meaningful "this match required
    // relaxation" signal, regardless of which language pair fired.
    const crossLanguageMatch = h.score < sameLanguageThreshold;

    filtered.push({
      qnaId: h.qnaId,
      question: h.question,
      answer: h.answer,
      language: h.language,
      languageLock: h.languageLock,
      tags: h.tags,
      score: h.score,
      crossLanguageMatch,
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
