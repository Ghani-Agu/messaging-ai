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
