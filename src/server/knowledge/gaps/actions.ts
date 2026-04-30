"use server";

import { requireTenantContext } from "@/server/tenancy/context";
import {
  loadGapClusters,
  loadUnclusteredGaps,
  markClusterResolved,
  markSingleGapResolvedById,
  type GapClusterSummary,
  type UnclusteredGapSummary,
} from "@/server/db/knowledge-gaps";

/**
 * Server Actions for the knowledge-gap digest (Phase 8g-3).
 *
 * AGENT-floor for the resolution actions per Gate-1 E. Reads stay at
 * VIEWER so non-editing roles can audit the gap log. The "Create Q&A
 * from gap" CTA in the UI calls createQnaPairAction (existing, AGENT-
 * floor) and then markClusterResolvedAction here to roll up the whole
 * cluster.
 */

export async function loadGapsDigest(slug: string): Promise<{
  clusters: GapClusterSummary[];
  unclustered: UnclusteredGapSummary[];
}> {
  const ctx = await requireTenantContext(slug, { minRole: "VIEWER" });
  const [clusters, unclustered] = await Promise.all([
    loadGapClusters({ tenantId: ctx.tenant.id }),
    loadUnclusteredGaps({ tenantId: ctx.tenant.id }),
  ]);
  return { clusters, unclustered };
}

/**
 * Mark every gap in a cluster as resolved. Called after the operator
 * answers the cluster's question via "Create Q&A from gap" — once the
 * canonical answer exists in the Q&A table, the entire cluster is
 * captured by the brain on subsequent customer questions.
 */
export async function markClusterResolvedAction(
  slug: string,
  input: { clusterKey: string },
): Promise<{ count: number }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  return markClusterResolved({
    tenantId: ctx.tenant.id,
    clusterKey: input.clusterKey,
  });
}

/**
 * Mark a single unclustered gap as resolved (used by the digest UI's
 * "Dismiss" action on rows in the unclustered backlog section).
 */
export async function dismissGapAction(
  slug: string,
  input: { gapId: string },
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  await markSingleGapResolvedById({ tenantId: ctx.tenant.id, gapId: input.gapId });
  return { ok: true };
}
