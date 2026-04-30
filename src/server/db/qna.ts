import "server-only";
import { z } from "zod";
import { Prisma, type QnaPair } from "@prisma/client";
import { prisma } from "./client";
import { SUPPORTED_LANGUAGES } from "@/lib/validators";

/**
 * QnaPair (Phase 8b — Type 3: authoritative Q&A).
 *
 * Dedupe is enforced at the DB layer via the `(tenantId, normalizedQuestion)`
 * composite UNIQUE. The normalization is computed in this helper — never
 * in callers — so any code path through createQnaPair / updateQnaPair gets
 * consistent normalization. P2002 from the unique constraint is caught and
 * re-thrown as `QnaDuplicateError` carrying the existing pair's id, which
 * the Server Action layer surfaces as a friendly message pointing the
 * operator at the existing entry.
 *
 * The questionEmbedding column is Unsupported in Prisma — same raw-SQL
 * write path as KnowledgeItem.embedding. P8c wires the embed worker; P8b
 * leaves embeddings null. Q&A is editable + listable without embedding;
 * semantic match (P8e) needs the vector populated.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercase + trim + collapse internal whitespace runs to single spaces.
 * App-set rather than GENERATED in the DB because lower() is STABLE (not
 * IMMUTABLE) under non-C collations, which would block GENERATED ALWAYS.
 *
 * Pure function — exported for tests.
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
// Read shapes
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

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raised by createQnaPair / updateQnaPair when the (tenantId,
 * normalizedQuestion) unique fires. `existingPairId` lets the Server Action
 * surface a "this question already has an answer — view it here" link.
 */
export class QnaDuplicateError extends Error {
  constructor(
    public readonly existingPairId: string,
    public readonly normalizedQuestion: string,
  ) {
    super(
      `A Q&A pair for this question already exists (id=${existingPairId})`,
    );
    this.name = "QnaDuplicateError";
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createQnaPair(args: {
  tenantId: string;
  input: QnaPairInput;
}): Promise<{ id: string }> {
  const data = qnaPairInputSchema.parse(args.input);
  const normalizedQuestion = normalizeQuestion(data.question);
  try {
    return await prisma.qnaPair.create({
      data: {
        tenantId: args.tenantId,
        question: data.question,
        normalizedQuestion,
        answer: data.answer,
        language: data.language ?? null,
        languageLock: data.languageLock,
        tags: data.tags,
        sourceUrl: data.sourceUrl ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const existing = await prisma.qnaPair.findFirst({
        where: { tenantId: args.tenantId, normalizedQuestion },
        select: { id: true },
      });
      throw new QnaDuplicateError(
        existing?.id ?? "(unknown)",
        normalizedQuestion,
      );
    }
    throw err;
  }
}

export async function updateQnaPair(args: {
  tenantId: string;
  qnaId: string;
  input: QnaPairInput;
}): Promise<void> {
  const data = qnaPairInputSchema.parse(args.input);
  const normalizedQuestion = normalizeQuestion(data.question);

  // Prisma's updateMany doesn't surface P2002 on composite unique violations
  // because it doesn't return the row's identity — instead the SQL just
  // fails. Catch and re-throw as QnaDuplicateError, same shape as create.
  try {
    const result = await prisma.qnaPair.updateMany({
      where: { id: args.qnaId, tenantId: args.tenantId },
      data: {
        question: data.question,
        normalizedQuestion,
        answer: data.answer,
        language: data.language ?? null,
        languageLock: data.languageLock,
        tags: data.tags,
        sourceUrl: data.sourceUrl ?? null,
      },
    });
    if (result.count === 0) throw new Error("Q&A not found");
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const existing = await prisma.qnaPair.findFirst({
        where: {
          tenantId: args.tenantId,
          normalizedQuestion,
          NOT: { id: args.qnaId },
        },
        select: { id: true },
      });
      throw new QnaDuplicateError(
        existing?.id ?? "(unknown)",
        normalizedQuestion,
      );
    }
    throw err;
  }
}

export async function deleteQnaPair(args: {
  tenantId: string;
  qnaId: string;
}): Promise<void> {
  await prisma.qnaPair.deleteMany({
    where: { id: args.qnaId, tenantId: args.tenantId },
  });
}

export async function getQnaPair(args: {
  tenantId: string;
  qnaId: string;
}): Promise<QnaPair | null> {
  return prisma.qnaPair.findFirst({
    where: { id: args.qnaId, tenantId: args.tenantId },
  });
}

export async function listQnaPairsForTenant(args: {
  tenantId: string;
  language?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<QnaPairSummary[]> {
  const where: Prisma.QnaPairWhereInput = { tenantId: args.tenantId };
  if (args.language) where.language = args.language;
  if (args.search?.trim()) {
    const q = args.search.trim();
    where.OR = [
      { question: { contains: q, mode: "insensitive" } },
      { answer: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.qnaPair.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 50,
    skip: args.offset ?? 0,
    select: {
      id: true,
      question: true,
      answer: true,
      language: true,
      languageLock: true,
      tags: true,
      lastVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const embRows = await prisma.$queryRaw<Array<{ id: string; has: boolean }>>`
    SELECT "id", ("questionEmbedding" IS NOT NULL) AS "has"
      FROM "QnaPair"
     WHERE "id" IN (${Prisma.join(ids)})
  `;
  const embFlags = new Map(embRows.map((r) => [r.id, r.has]));
  return rows.map((r) => ({
    ...r,
    hasEmbedding: embFlags.get(r.id) ?? false,
  }));
}

export async function countQnaPairsForTenant(tenantId: string): Promise<number> {
  return prisma.qnaPair.count({ where: { tenantId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding write path
// ─────────────────────────────────────────────────────────────────────────────

export async function attachQnaEmbedding(args: {
  qnaId: string;
  vector: number[];
}): Promise<void> {
  const literal = "[" + args.vector.join(",") + "]";
  await prisma.$executeRaw`
    UPDATE "QnaPair"
       SET "questionEmbedding" = ${literal}::vector,
           "updatedAt" = NOW()
     WHERE "id" = ${args.qnaId}
  `;
}

export async function listUnembeddedQnaIds(args: {
  tenantId: string;
}): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "QnaPair"
     WHERE "tenantId" = ${args.tenantId}
       AND "questionEmbedding" IS NULL
     ORDER BY "createdAt" ASC
  `;
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────

export async function markQnaVerified(args: {
  tenantId: string;
  qnaId: string;
}): Promise<void> {
  const result = await prisma.qnaPair.updateMany({
    where: { id: args.qnaId, tenantId: args.tenantId },
    data: { lastVerifiedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Q&A not found");
}
