"use server";

import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  contactInputSchema,
  createContact,
  deleteContact,
  listContactsForTenant,
  updateContact,
  type ContactSummary,
} from "@/server/db/contacts";

/**
 * Server Actions for the Contacts admin surface (Phase post-WBP).
 *
 * Contacts are operator-managed phone/email entries the brain suggests
 * when escalating to a human. OWNER-floor for create / update / delete
 * (matches the prior Billing surface which Contacts replaces — workspace
 * owners control who customers reach when the AI hands off). VIEWER can
 * read so non-owner team members see what's configured.
 *
 * Every action calls requireTenantContext(slug, ...) before touching
 * the DB; client-supplied tenantId is never trusted (CLAUDE.md hard
 * rule). All writes revalidate the contacts route so the page picks up
 * the new state without a manual refresh.
 */

export async function listContacts(slug: string): Promise<ContactSummary[]> {
  const ctx = await requireTenantContext(slug, {
    minRole: "VIEWER",
    requiredPermission: "contacts:view",
  });
  return listContactsForTenant(ctx.tenant.id);
}

export async function createContactAction(args: {
  tenantSlug: string;
  input: unknown;
}): Promise<ContactSummary> {
  const ctx = await requireTenantContext(args.tenantSlug, { minRole: "OWNER" });
  const parsed = contactInputSchema.parse(args.input);
  const row = await createContact({ tenantId: ctx.tenant.id, input: parsed });
  revalidatePath(`/${args.tenantSlug}/contacts`);
  return row;
}

export async function updateContactAction(args: {
  tenantSlug: string;
  contactId: string;
  input: unknown;
}): Promise<ContactSummary> {
  const ctx = await requireTenantContext(args.tenantSlug, { minRole: "OWNER" });
  const parsed = contactInputSchema.parse(args.input);
  const row = await updateContact({
    tenantId: ctx.tenant.id,
    contactId: args.contactId,
    input: parsed,
  });
  revalidatePath(`/${args.tenantSlug}/contacts`);
  return row;
}

export async function deleteContactAction(args: {
  tenantSlug: string;
  contactId: string;
}): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(args.tenantSlug, { minRole: "OWNER" });
  await deleteContact({ tenantId: ctx.tenant.id, contactId: args.contactId });
  revalidatePath(`/${args.tenantSlug}/contacts`);
  return { ok: true };
}
