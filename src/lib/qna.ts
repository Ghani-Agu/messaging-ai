/**
 * QnaPair schemas + pure helpers (Phase 8c/e).
 *
 * Lives in src/lib/ per the server-only/lib split rule (CLAUDE.md §4):
 * the Q&A admin form imports the schema for client-side pre-submit
 * validation, and `"server-only"` trips the bundler even on `import type`
 * paths from a client component.
 *
 * The server-side DB layer (src/server/db/qna.ts) keeps the Prisma
 * helpers + the QnaDuplicateError class + re-exports everything in this
 * file for source compatibility.
 */

import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "./validators";

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase + trim + collapse internal whitespace runs to single spaces.
 * App-set rather than GENERATED in the DB because lower() is STABLE (not
 * IMMUTABLE) under non-C collations, which would block GENERATED ALWAYS.
 *
 * Pure function — exported for tests and for the Server Action layer.
 */
export function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Input schema
// ─────────────────────────────────────────────────────────────────────────────

export const qnaPairInputSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(500),
  answer: z.string().trim().min(1, "Answer is required").max(4000),
  // Author hint. Brain still detects per-message; only meaningful when
  // languageLock=true (then the Q&A only matches queries detected to be
  // in this language).
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  // Per Gate-1 C: default off — most tenants want a French Q&A to fire on
  // an Arabic query with the brain handling translation.
  languageLock: z.boolean().default(false),
  // Free-form tags for filtering in the dashboard. Up to 10 to keep the
  // UI bounded; lengths capped to avoid Postgres array-text bloat.
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  // Provenance — operator can paste a URL where the canonical answer was
  // sourced. Stored verbatim; never auto-fetched.
  sourceUrl: z.string().trim().url().max(2048).optional(),
});
export type QnaPairInput = z.infer<typeof qnaPairInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Read shape — used by both server (db/qna.ts) and client UI.
// ─────────────────────────────────────────────────────────────────────────────

export type QnaPairSummary = {
  id: string;
  question: string;
  answer: string;
  language: string | null;
  languageLock: boolean;
  tags: string[];
  hasEmbedding: boolean;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
