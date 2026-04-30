/**
 * Phase-3 ingestion + retrieval limits. Locked by the project lead — every
 * crawler / parser / chunker / retriever consults these instead of inlining
 * magic numbers. Pure constants, safe to import from both server and client
 * (no `server-only`).
 */

// Crawler — locked.
export const MAX_PAGES_PER_CRAWL = 50;
export const MAX_CRAWL_DEPTH = 3;
export const SAME_DOMAIN_ONLY = true;

// File upload — enforced server-side in createFileSource before minting a
// signed URL. 25 MB covers the LlamaParse free-tier-friendly working set.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Manual entry — enforced in the createManualSource Zod schema.
export const MAX_MANUAL_CONTENT_CHARS = 50_000;

// Per-tenant chunk soft cap. Not a hard block — the worker continues past
// this and sets `metadata.softCapReached: true` so the UI can warn.
export const MAX_CHUNKS_PER_TENANT = 10_000;

// Chunker tuning — recursive token-aware splitter with overlap.
export const TARGET_CHUNK_TOKENS = 600;
export const CHUNK_OVERLAP_RATIO = 0.15;
export const CHUNK_OVERLAP_TOKENS = Math.round(
  TARGET_CHUNK_TOKENS * CHUNK_OVERLAP_RATIO,
);

// Retriever — RRF + HNSW.
export const RETRIEVAL_DEFAULT_TOP_K = 8;
export const RETRIEVAL_CANDIDATE_POOL = 50; // top-N from each modality before fusion
export const RRF_K = 60; // standard Reciprocal Rank Fusion constant
export const HNSW_EF_SEARCH = 100; // SET LOCAL hnsw.ef_search before each vector query

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — typed knowledge limits
// ─────────────────────────────────────────────────────────────────────────────

// Per-tenant soft caps for typed-knowledge tables. Same pattern as
// MAX_CHUNKS_PER_TENANT — surfaced in the dashboard as a warning banner,
// never a hard block.
export const MAX_ITEMS_PER_TENANT = 5_000;
export const MAX_QNA_PER_TENANT = 1_000;

// Document freshness signal. A KnowledgeSource is rendered with a "stale"
// badge when max(lastIngestedAt, lastVerifiedAt) is older than this many
// days. Per Gate 1 F: 45 days for documents (down from the original 90
// — distributors update catalogs frequently). Items have no time-based
// staleness; verification is purely operator-driven.
export const DOCUMENT_STALE_AFTER_DAYS = 45;

// Q&A authoritative-match threshold. Cosine-similarity floor on the
// question embedding. Matches above this floor are injected into Block C
// as "AUTHORITATIVE ANSWER" and the brain reuses the answer near-verbatim
// (only language-register-adapting). Below the floor, the question falls
// through to normal hybrid retrieval. Per Gate 1 K3: 0.85 (override of the
// originally proposed 0.82 — tighter for safety). No auto-skip yet; brain
// still composes the reply. Wired into the retriever in P8e.
export const QNA_MATCH_THRESHOLD = 0.85;
