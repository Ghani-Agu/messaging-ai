import "server-only";
import { Prisma, type QnaPair } from "@prisma/client";
import { prisma } from "./client";
import { enqueueEmbedQna } from "@/server/queue/jobs";
import {
  normalizeQuestion,
  qnaPairInputSchema,
  type QnaPairInput,
  type QnaPairSummary,
} from "@/lib/qna";

/**
 * QnaPair DB layer (Phase 8b/c — Type 3: authoritative Q&A).
 *
 * Dedupe is enforced at the DB layer via the `(tenantId, normalizedQuestion)`
 * composite UNIQUE. The normalization is computed in the lib helper —
 * never in callers — so any code path through createQnaPair / updateQnaPair
 * gets consistent normalization. P2002 from the unique constraint is caught
 * and re-thrown as `QnaDuplicateError` carrying the existing pair's id,
 * which the Server Action layer surfaces as a friendly message pointing the
 * operator at the existing entry.
 *
 * Schemas + types + normalizeQuestion live in src/lib/qna.ts per the
 * server-only/lib split rule (CLAUDE.md §4) so the Q&A admin form can
 * import the schema for client-side pre-submit validation.
 */

// Re-exports — keeps existing import sites working without churn.
export {
  normalizeQuestion,
  qnaPairInputSchema,
} from "@/lib/qna";
export type {
  QnaPairInput,
  QnaPairSummary,
} from "@/lib/qna";

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
  let created: { id: string };
  try {
    created = await prisma.qnaPair.create({
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
  // Phase 8c: enqueue embedding of the question text. The worker embeds
  // with inputType: "query" since this vector is matched against incoming
  // customer queries (asymmetric retrieval; see workers/embed.ts).
  await enqueueEmbedQna({ tenantId: args.tenantId, qnaIds: [created.id] });
  return created;
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
  // Phase 8c: clear the existing embedding and re-enqueue. Without the
  // NULL flip, the worker's `AND questionEmbedding IS NULL` idempotency
  // guard would short-circuit and the vector would stay stale on the old
  // question text.
  await prisma.$executeRaw`
    UPDATE "QnaPair"
       SET "questionEmbedding" = NULL
     WHERE "id" = ${args.qnaId}
       AND "tenantId" = ${args.tenantId}
  `;
  await enqueueEmbedQna({ tenantId: args.tenantId, qnaIds: [args.qnaId] });
}

export async function deleteQnaPair(args: {
  tenantId: string;
  qnaId: string;
}): Promise<void> {
  await prisma.qnaPair.deleteMany({
    where: { id: args.qnaId, tenantId: args.tenantId },
  });
}

/**
 * Bulk delete a set of Q&A pairs by id, scoped to a tenant. Used by the
 * Q&A admin's "delete selected" action. Returns the affected row count.
 */
export async function bulkDeleteQnaPairs(args: {
  tenantId: string;
  qnaIds: string[];
}): Promise<{ count: number }> {
  if (args.qnaIds.length === 0) return { count: 0 };
  const result = await prisma.qnaPair.deleteMany({
    where: { tenantId: args.tenantId, id: { in: args.qnaIds } },
  });
  return { count: result.count };
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
// Retrieval (Phase 8c)
//
// Q&A retrieval is vector-only: questions are short, and what we want to
// match is "this customer is asking the same thing as a known question."
// Lexical adds little signal here and would noise the high-confidence
// authoritative-match path. Threshold filtering happens at the caller
// (the retriever module reads QNA_MATCH_THRESHOLD from limits.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type RawQnaHit = {
  qnaId: string;
  question: string;
  answer: string;
  language: string | null;
  languageLock: boolean;
  tags: string[];
  score: number;
};

import { HNSW_EF_SEARCH } from "@/server/knowledge/limits";

export async function vectorSearchQna(args: {
  tenantId: string;
  queryVector: number[];
  limit: number;
}): Promise<RawQnaHit[]> {
  const literal = "[" + args.queryVector.join(",") + "]";
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`);
    return tx.$queryRaw<RawQnaHit[]>`
      SELECT q."id"           AS "qnaId",
             q."question"     AS "question",
             q."answer"       AS "answer",
             q."language"     AS "language",
             q."languageLock" AS "languageLock",
             q."tags"         AS "tags",
             1 - (q."questionEmbedding" <=> ${literal}::vector) AS "score"
        FROM "QnaPair" q
       WHERE q."tenantId" = ${args.tenantId}
         AND q."questionEmbedding" IS NOT NULL
       ORDER BY q."questionEmbedding" <=> ${literal}::vector ASC
       LIMIT ${args.limit}
    `;
  });
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
