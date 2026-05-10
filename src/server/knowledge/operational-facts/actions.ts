"use server";

import { requireTenantContext } from "@/server/tenancy/context";
import {
  getOperationalFacts,
  operationalFactsDataSchema,
  setOperationalFacts,
  type OperationalFactsData,
} from "@/server/db/operational-facts";

/**
 * Server Actions for the Business Info admin surface (Phase 8b).
 *
 * AGENT-floor per Gate-1 E (revisit role split when multi-agent trust
 * becomes a concern). Every action calls requireTenantContext(slug, ...);
 * client-supplied tenantId is never trusted — same hard rule as Phase 3.
 *
 * The form saves the FULL envelope (tier-1 + tier-2 in one POST). The
 * atomic single-key patch in db/operational-facts.ts is groundwork for
 * later forms that edit one section at a time; this action doesn't use it.
 */

export async function loadOperationalFacts(slug: string): Promise<OperationalFactsData> {
  // VIEWER-floor for read so non-editing agents can see what's configured.
  const ctx = await requireTenantContext(slug, {
    minRole: "VIEWER",
    requiredPermission: "business-info:view",
  });
  return getOperationalFacts({ tenantId: ctx.tenant.id });
}

export async function saveOperationalFacts(
  slug: string,
  input: unknown,
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "business-info:edit",
  });
  // Re-parse on the server. The client form has its own Zod parse before
  // submit — this is the trust-boundary check, never a duplicate.
  const data = operationalFactsDataSchema.parse(input);
  await setOperationalFacts({ tenantId: ctx.tenant.id, data });
  return { ok: true };
}
