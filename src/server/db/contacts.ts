import "server-only";

import type { Contact } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  type ContactInput,
  type ContactSummary,
  MAX_CONTACTS_IN_PROMPT,
  toContactSummary,
} from "@/lib/contacts";

// Re-export schemas / types for source-compat with server-side callers.
// Same lib/server split rule as src/server/db/items.ts.
export {
  contactInputSchema,
  MAX_CONTACTS_IN_PROMPT,
  type ContactInput,
  type ContactSummary,
} from "@/lib/contacts";

/**
 * List all contacts for a tenant, ordered by operator position then
 * createdAt (stable secondary sort for ties at the default position=0).
 * No pagination — operators don't curate more than a small handful of
 * escalation contacts per workspace.
 */
export async function listContactsForTenant(
  tenantId: string,
): Promise<ContactSummary[]> {
  const rows = await prisma.contact.findMany({
    where: { tenantId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toContactSummary);
}

/**
 * Load the contacts the brain injects into Block C on each turn.
 * Identical ordering to listContactsForTenant; capped at
 * MAX_CONTACTS_IN_PROMPT (6) so the prompt-side token cost stays bounded.
 *
 * Returns the raw Contact rows so the orchestrator can pass them
 * through to the citation renderer without re-querying.
 */
export async function listContactsForBrain(
  tenantId: string,
): Promise<Contact[]> {
  return prisma.contact.findMany({
    where: { tenantId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    take: MAX_CONTACTS_IN_PROMPT,
  });
}

export async function createContact(args: {
  tenantId: string;
  input: ContactInput;
}): Promise<ContactSummary> {
  const { tenantId, input } = args;
  const row = await prisma.contact.create({
    data: {
      tenantId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      role: input.role ?? null,
      position: input.position,
    },
  });
  return toContactSummary(row);
}

export async function updateContact(args: {
  tenantId: string;
  contactId: string;
  input: ContactInput;
}): Promise<ContactSummary> {
  const { tenantId, contactId, input } = args;
  // Tenant-scope guard: scope the update by both tenantId and id so a
  // contactId from a different tenant can't be hit even with a valid id.
  // updateMany returns a count; we still need to fetch to return the row.
  const result = await prisma.contact.updateMany({
    where: { id: contactId, tenantId },
    data: {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      role: input.role ?? null,
      position: input.position,
    },
  });
  if (result.count === 0) {
    throw new Error(`contact not found or not owned by tenant: ${contactId}`);
  }
  const fresh = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!fresh) throw new Error(`contact disappeared mid-update: ${contactId}`);
  return toContactSummary(fresh);
}

export async function deleteContact(args: {
  tenantId: string;
  contactId: string;
}): Promise<void> {
  const result = await prisma.contact.deleteMany({
    where: { id: args.contactId, tenantId: args.tenantId },
  });
  if (result.count === 0) {
    throw new Error(`contact not found or not owned by tenant: ${args.contactId}`);
  }
}
