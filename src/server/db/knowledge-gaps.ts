import "server-only";
import { z } from "zod";
import { Prisma, type KnowledgeGap } from "@prisma/client";
import { prisma } from "./client";
import { SUPPORTED_LANGUAGES } from "@/lib/validators";
import { enqueueEmbedKnowledgeGap } from "@/server/queue/jobs";

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
  const created = await prisma.knowledgeGap.create({
    data: {
      tenantId: args.tenantId,
      question: data.question,
      language: data.language ?? null,
      conversationId: data.conversationId ?? null,
    },
    select: { id: true },
  });
  // Phase 8g: enqueue the embed + cluster job. The webhook handler that
  // calls this function uses fire-and-forget, so a failure to enqueue
  // (Redis hiccup) shouldn't block the customer reply — wrap in a
  // try/catch and let the worker reconcile via listUnclusteredGaps later
  // if needed (no backfill scaffold today; flagged for future).
  try {
    await enqueueEmbedKnowledgeGap({
      tenantId: args.tenantId,
      gapIds: [created.id],
    });
  } catch (err) {
    console.warn(
      `[recordKnowledgeGap] failed to enqueue embed/cluster for gap=${created.id}:`,
      err,
    );
  }
  return created;
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

// ─────────────────────────────────────────────────────────────────────────────
// Greedy clustering (Phase 8g)
//
// Cluster-on-write: when a new gap is embedded, the worker calls these
// helpers to find a candidate cluster. Per Gate-1 P8g: hard cap at 500
// candidate comparisons per insert; above the cap the worker skips
// clustering and leaves clusterKey null (digest UI surfaces backlog).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count gaps with embeddings in the clustering window (last N days)
 * for the tenant, EXCLUDING the new gap itself. Used by the worker to
 * decide whether to run clustering or skip past the candidate cap.
 *
 * Counts both clustered and unclustered candidates because new gaps can
 * either join an existing cluster (when the best match has a clusterKey)
 * or seed a new one (when the best match doesn't, or no match clears
 * the threshold).
 */
export async function countClusterCandidates(args: {
  tenantId: string;
  excludeGapId: string;
  sinceDays: number;
}): Promise<number> {
  const since = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
      FROM "KnowledgeGap"
     WHERE "tenantId" = ${args.tenantId}
       AND "id" != ${args.excludeGapId}
       AND "embedding" IS NOT NULL
       AND "createdAt" >= ${since}
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Find the single best-similarity candidate gap in the window (cap-bounded).
 * Returns null when no candidate clears the threshold — the caller then
 * mints a fresh clusterKey for the new gap.
 *
 * The query joins back the candidate's clusterKey so the worker can
 * decide:
 *   - candidate.clusterKey IS NOT NULL → assign the new gap that key
 *     (joining an existing cluster).
 *   - candidate.clusterKey IS NULL → mint a new key, assign to BOTH
 *     the new gap and this candidate (seeding a fresh cluster).
 *
 * The LIMIT is the per-insert candidate cap; with 500 candidates max,
 * pgvector's HNSW gives sub-millisecond per-query lookup.
 */
export async function findBestClusterCandidate(args: {
  tenantId: string;
  excludeGapId: string;
  queryVector: number[];
  threshold: number;
  sinceDays: number;
  limit: number;
}): Promise<{
  gapId: string;
  clusterKey: string | null;
  score: number;
} | null> {
  const since = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000);
  const literal = "[" + args.queryVector.join(",") + "]";
  // The HNSW index on KnowledgeGap.embedding (raw SQL in P8a migration)
  // serves the ORDER BY. ef_search isn't critical at this candidate
  // pool size — we cap at 500 by LIMIT regardless.
  const rows = await prisma.$queryRaw<
    Array<{ gapId: string; clusterKey: string | null; score: number }>
  >`
    SELECT "id"        AS "gapId",
           "clusterKey",
           1 - ("embedding" <=> ${literal}::vector) AS "score"
      FROM "KnowledgeGap"
     WHERE "tenantId" = ${args.tenantId}
       AND "id" != ${args.excludeGapId}
       AND "embedding" IS NOT NULL
       AND "createdAt" >= ${since}
     ORDER BY "embedding" <=> ${literal}::vector ASC
     LIMIT ${args.limit}
  `;
  if (rows.length === 0) return null;
  const best = rows[0]!;
  if (best.score < args.threshold) return null;
  return best;
}

/**
 * Read a gap's question + embedding state for the worker to embed.
 * Worker-side helper; trusts the job's tenantId.
 */
export async function getGapForEmbedding(gapId: string): Promise<{
  id: string;
  tenantId: string;
  question: string;
  hasEmbedding: boolean;
} | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tenantId: string;
      question: string;
      hasEmbedding: boolean;
    }>
  >`
    SELECT "id", "tenantId", "question",
           ("embedding" IS NOT NULL) AS "hasEmbedding"
      FROM "KnowledgeGap"
     WHERE "id" = ${gapId}
  `;
  return rows[0] ?? null;
}

/**
 * Cluster-resolution helpers (used by the digest UI's "Create Q&A from
 * gap" CTA — when the operator answers the gap, every gap in the
 * cluster gets resolved=true).
 */
export async function markClusterResolved(args: {
  tenantId: string;
  clusterKey: string;
}): Promise<{ count: number }> {
  const result = await prisma.knowledgeGap.updateMany({
    where: { tenantId: args.tenantId, clusterKey: args.clusterKey, resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  });
  return { count: result.count };
}

/**
 * Single-gap resolution — used when the operator marks a single
 * unclustered gap resolved (skipped-clustering backlog).
 */
export async function markSingleGapResolvedById(args: {
  tenantId: string;
  gapId: string;
}): Promise<void> {
  const result = await prisma.knowledgeGap.updateMany({
    where: { id: args.gapId, tenantId: args.tenantId },
    data: { resolved: true, resolvedAt: new Date() },
  });
  if (result.count === 0) throw new Error("Gap not found");
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster digest reads (Phase 8g)
//
// `loadGapClusters` returns one row per active cluster with the
// representative question (most-recent question text in the cluster)
// + member count + latest-seen timestamp. The digest UI shows these
// alongside an "Unclustered" section for gaps the worker skipped past
// the candidate cap.
// ─────────────────────────────────────────────────────────────────────────────

export type GapClusterSummary = {
  clusterKey: string;
  representativeQuestion: string;
  representativeGapId: string;
  language: string | null;
  count: number;
  lastSeenAt: Date;
  firstSeenAt: Date;
};

export async function loadGapClusters(args: {
  tenantId: string;
  sinceDays?: number;
}): Promise<GapClusterSummary[]> {
  const sinceDays = args.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  // Per cluster: count + latest member + earliest member. The latest
  // member is the cluster's "representative" question (most recent
  // phrasing the customer used).
  const rows = await prisma.$queryRaw<
    Array<{
      clusterKey: string;
      representativeQuestion: string;
      representativeGapId: string;
      language: string | null;
      count: bigint;
      lastSeenAt: Date;
      firstSeenAt: Date;
    }>
  >`
    SELECT g."clusterKey",
           latest."question"      AS "representativeQuestion",
           latest."id"            AS "representativeGapId",
           latest."language"      AS "language",
           COUNT(*)::bigint       AS "count",
           MAX(g."createdAt")     AS "lastSeenAt",
           MIN(g."createdAt")     AS "firstSeenAt"
      FROM "KnowledgeGap" g
      JOIN LATERAL (
        SELECT g2."id", g2."question", g2."language"
          FROM "KnowledgeGap" g2
         WHERE g2."tenantId" = g."tenantId"
           AND g2."clusterKey" = g."clusterKey"
         ORDER BY g2."createdAt" DESC
         LIMIT 1
      ) latest ON TRUE
     WHERE g."tenantId" = ${args.tenantId}
       AND g."clusterKey" IS NOT NULL
       AND g."resolved" = false
       AND g."createdAt" >= ${since}
     GROUP BY g."clusterKey", latest."id", latest."question", latest."language"
     ORDER BY MAX(g."createdAt") DESC
  `;
  return rows.map((r) => ({
    clusterKey: r.clusterKey,
    representativeQuestion: r.representativeQuestion,
    representativeGapId: r.representativeGapId,
    language: r.language,
    count: Number(r.count),
    lastSeenAt: r.lastSeenAt,
    firstSeenAt: r.firstSeenAt,
  }));
}

export type UnclusteredGapSummary = {
  id: string;
  question: string;
  language: string | null;
  createdAt: Date;
};

export async function loadUnclusteredGaps(args: {
  tenantId: string;
  sinceDays?: number;
  limit?: number;
}): Promise<UnclusteredGapSummary[]> {
  const sinceDays = args.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.knowledgeGap.findMany({
    where: {
      tenantId: args.tenantId,
      clusterKey: null,
      resolved: false,
      createdAt: { gte: since },
    },
    select: { id: true, question: true, language: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: args.limit ?? 50,
  });
  return rows;
}
