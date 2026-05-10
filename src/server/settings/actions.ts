"use server";

import { revalidatePath } from "next/cache";
import { aiBehaviorSchema, type AiBehavior } from "@/lib/validators";
import { requireTenantContext } from "@/server/tenancy/context";
import { updateTenantAiBehavior } from "@/server/db/tenancy";
import type { UpdateAiBehaviorState } from "./state";

/**
 * Persist the AI Behavior toggles for a tenant. OWNER-only — these
 * settings change how the AI represents the business to customers and
 * shouldn't be tweaked by support agents. Same role floor we use for
 * Live Data Source credentials and other policy-grade knobs.
 *
 * Body is re-parsed via aiBehaviorSchema on the server. The client form
 * does its own parse pre-submit; this is the trust-boundary check, not
 * a duplicate. The DB write merges the new aiBehavior key into
 * Tenant.settings inside a transaction so a parallel voice-profile save
 * can't race and clobber either side.
 */
export async function updateAiBehaviorAction(args: {
  tenantSlug: string;
  aiBehavior: AiBehavior;
}): Promise<UpdateAiBehaviorState> {
  const validated = aiBehaviorSchema.parse(args.aiBehavior);
  const ctx = await requireTenantContext(args.tenantSlug, {
    minRole: "OWNER",
  });
  await updateTenantAiBehavior({
    tenantId: ctx.tenant.id,
    aiBehavior: validated,
  });
  revalidatePath(`/${args.tenantSlug}/settings/ai`);
  return { status: "saved" };
}
