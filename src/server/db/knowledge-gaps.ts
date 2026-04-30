import "server-only";
import { z } from "zod";
import { Prisma, type KnowledgeGap } from "@prisma/client";
import { prisma } from "./client";
import { SUPPORTED_LANGUAGES } from "@/lib/validators";

/**
 * KnowledgeGap (Phase 8b — gap log).
 *
 * Customer questions the AI couldn't answer (escalation === "OUTSIDE_SCOPE")
 * accumulate here for the operator's "knowledge to add" digest. P8b ships
 * the basic insert/list surface; clustering + the digest UI land in P8g
 * (per Gate 1 plan), and the actual "log on OUTSIDE_SCOPE" hook lives at
 * the runBrain caller site (per Gate 1 K6 — caller-side, fire-and-forget).
 *
 * The conversationId FK uses ON DELETE SET NULL (per Gate 1 risk note):
 * gaps survive conversation deletion because the question itself — what the
 * customer was asking — is what's interesting for the operator's workflow,
 * not the conversation it came from.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Input schema
// ─────────────────────────────────────────────────────────────────────────────

export const knowledgeGapInputSchema = z.object({
  // The customer's verbatim question (capped at ~2000 chars to avoid
  // pathological storage). Trimmed but not normalized — operator sees what
  // was actually said.
  question: z.string().trim().min(1).max(2000),
  // Brain-detected language of the question. May be null when detection
  // wasn't conclusive.
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  // Provenance — the conversation this gap came from. Optional to allow
  // logging from non-conversation contexts (manual operator entry, etc.).
  conversationId: z.string().min(1).optional(),
});
export type KnowledgeGapInput = z.infer<typeof knowledgeGapInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Read shapes
// ─────────────────────────────────────────────────────────────────────────────

export type GapSummary = {
  id: string;
  question: string;
  language: string | null;
  conversationId: string | null;
  clusterKey: string | null;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  hasEmbedding: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a gap row. Caller-side, fire-and-forget per Gate 1 K6 — the
 * runBrain caller wraps this in try/catch so a logging failure never blocks
 * the customer reply.
 */
export async function recordKnowledgeGap(args: {
  tenantId: string;
  input: KnowledgeGapInput;
}): Promise<{ id: string }> {
  const data = knowledgeGapInputSchema.parse(args.input);
  return prisma.knowledgeGap.create({
    data: {
      tenantId: args.tenantId,
      question: data.question,
      language: data.language ?? null,
      conversationId: data.conversationId ?? null,
    },
    select: { id: true },
  });
}

export async function deleteKnowledgeGap(args: {
  tenantId: string;
  gapId: string;
}): Promise<void> {
  await prisma.knowledgeGap.deleteMany({
    where: { id: args.gapId, tenantId: args.tenantId },
  });
}

export async function markKnowledgeGapResolved(args: {
  tenantId: string;
  gapId: string;
}): Promise<void> {
  const result = await prisma.knowledgeGap.updateMany({
    where: { id: args.gapId, tenantId: args.tenantId },
    data: { resolved: true, resolvedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Gap not found");
}

export async function getKnowledgeGap(args: {
  tenantId: string;
  gapId: string;
}): Promise<KnowledgeGap | null> {
  return prisma.knowledgeGap.findFirst({
    where: { id: args.gapId, tenantId: args.tenantId },
  });
}

export async function listKnowledgeGapsForTenant(args: {
  tenantId: string;
  resolved?: boolean;
  /** Bound the result window — defaults to the last 30 days per Gate 1 risk note. */
  sinceDays?: number;
  limit?: number;
  offset?: number;
}): Promise<GapSummary[]> {
  const sinceDays = args.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const where: Prisma.KnowledgeGapWhereInput = {
    tenantId: args.tenantId,
    createdAt: { gte: since },
  };
  if (args.resolved !== undefined) where.resolved = args.resolved;
  const rows = await prisma.knowledgeGap.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 100,
    skip: args.offset ?? 0,
    select: {
      id: true,
      question: true,
      language: true,
      conversationId: true,
      clusterKey: true,
      resolved: true,
      resolvedAt: true,
      createdAt: true,
    },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const embRows = await prisma.$queryRaw<Array<{ id: string; has: boolean }>>`
    SELECT "id", ("embedding" IS NOT NULL) AS "has"
      FROM "KnowledgeGap"
     WHERE "id" IN (${Prisma.join(ids)})
  `;
  const embFlags = new Map(embRows.map((r) => [r.id, r.has]));
  return rows.map((r) => ({
    ...r,
    hasEmbedding: embFlags.get(r.id) ?? false,
  }));
}

export async function countKnowledgeGapsForTenant(args: {
  tenantId: string;
  resolved?: boolean;
}): Promise<number> {
  const where: Prisma.KnowledgeGapWhereInput = { tenantId: args.tenantId };
  if (args.resolved !== undefined) where.resolved = args.resolved;
  return prisma.knowledgeGap.count({ where });
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding write path (used by P8g clusterer)
// ─────────────────────────────────────────────────────────────────────────────

export async function attachGapEmbedding(args: {
  gapId: string;
  vector: number[];
}): Promise<void> {
  const literal = "[" + args.vector.join(",") + "]";
  await prisma.$executeRaw`
    UPDATE "KnowledgeGap"
       SET "embedding" = ${literal}::vector
     WHERE "id" = ${args.gapId}
  `;
}

export async function setKnowledgeGapClusterKey(args: {
  gapId: string;
  clusterKey: string | null;
}): Promise<void> {
  await prisma.knowledgeGap.update({
    where: { id: args.gapId },
    data: { clusterKey: args.clusterKey },
  });
}
