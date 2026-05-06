"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireOwnerContext } from "@/server/tenancy/context";
import { encryptConfig, decryptConfig } from "./crypto";
import { syncSource } from "./dispatch";
import { OdooConfigSchema, type OdooConfig } from "./odoo/config-schema";
import { testOdooConnection } from "./odoo/test-connection";

/**
 * Server Actions for the Live Data Sources operator UI. All write
 * actions floor at OWNER (per CLAUDE.md / project policy: credential
 * surfaces are an OWNER concern; admins/agents/viewers can see status
 * via the page render but cannot mutate).
 *
 * Returns are intentionally narrow — never include cleartext config,
 * never include the password back to the client, never echo the
 * encrypted blob. The list-side render reads sources via Prisma in
 * the page itself; these actions only confirm "ok" + ids.
 */

// ── Test connection (no DB write) ──────────────────────────────────────────

export type TestOdooConnectionInput = {
  tenantSlug: string;
  url: string;
  database: string;
  username: string;
  password: string;
  brandField?: string;
};

export async function testOdooConnectionAction(input: TestOdooConnectionInput) {
  await requireOwnerContext(input.tenantSlug);
  const config: OdooConfig = OdooConfigSchema.parse({
    url: input.url,
    database: input.database,
    username: input.username,
    password: input.password,
    additionalFields: input.brandField
      ? { brandField: input.brandField }
      : undefined,
  });
  return testOdooConnection(config);
}

// ── Save (creates a new source, fires initial sync) ────────────────────────

export type SaveOdooSourceInput = {
  tenantSlug: string;
  name: string;
  url: string;
  database: string;
  username: string;
  password: string;
  brandField?: string;
};

export async function saveOdooSourceAction(input: SaveOdooSourceInput) {
  const ctx = await requireOwnerContext(input.tenantSlug);
  const config: OdooConfig = OdooConfigSchema.parse({
    url: input.url,
    database: input.database,
    username: input.username,
    password: input.password,
    additionalFields: input.brandField
      ? { brandField: input.brandField }
      : undefined,
  });

  const source = await prisma.liveDataSource.create({
    data: {
      tenantId: ctx.tenant.id,
      type: "ODOO",
      name: input.name,
      encryptedConfig: encryptConfig(JSON.stringify(config)),
      status: "PENDING_TEST",
    },
  });

  // Fire-and-forget initial sync. The status flips to CONNECTED on
  // success or ERROR on failure; the operator sees the result on the
  // next page load (the source-card polls / re-renders post-action).
  // Never await — a slow Odoo cold start would block the action and
  // the modal-close UX.
  void syncSource(source).catch((err: unknown) => {
    console.error("Initial Live Data sync failed", {
      sourceId: source.id,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  revalidatePath(`/${input.tenantSlug}/knowledge/live-data`);
  return { ok: true as const, id: source.id };
}

// ── Sync now (manual trigger from source card) ─────────────────────────────

export async function syncNowAction(tenantSlug: string, sourceId: string) {
  const ctx = await requireOwnerContext(tenantSlug);
  const source = await prisma.liveDataSource.findFirst({
    where: { id: sourceId, tenantId: ctx.tenant.id },
  });
  if (!source) throw new Error("Source not found");
  const result = await syncSource(source);
  revalidatePath(`/${tenantSlug}/knowledge/live-data`);
  return result;
}

// ── Edit (partial update; blank password keeps existing) ───────────────────

export type EditOdooSourceInput = {
  tenantSlug: string;
  sourceId: string;
  name?: string;
  url?: string;
  database?: string;
  username?: string;
  /** Empty / whitespace-only password is treated as "keep existing." */
  password?: string;
  /** undefined = keep existing config; "" = clear; non-empty = set. */
  brandField?: string;
};

export async function editOdooSourceAction(input: EditOdooSourceInput) {
  const ctx = await requireOwnerContext(input.tenantSlug);
  const existing = await prisma.liveDataSource.findFirst({
    where: { id: input.sourceId, tenantId: ctx.tenant.id },
  });
  if (!existing) throw new Error("Source not found");

  const oldConfig: OdooConfig = OdooConfigSchema.parse(
    JSON.parse(decryptConfig(existing.encryptedConfig)),
  );

  // Password merge: only replace if a non-empty value was supplied.
  // The Edit modal sends the textbox content verbatim — leaving it
  // blank keeps the existing encrypted password.
  const nextPassword =
    input.password && input.password.length > 0
      ? input.password
      : oldConfig.password;

  // brandField merge:
  //   undefined → keep existing additionalFields wholesale
  //   ""        → clear (no brand field configured)
  //   non-empty → set
  let nextAdditionalFields: OdooConfig["additionalFields"];
  if (input.brandField === undefined) {
    nextAdditionalFields = oldConfig.additionalFields;
  } else if (input.brandField.length === 0) {
    nextAdditionalFields = undefined;
  } else {
    nextAdditionalFields = { brandField: input.brandField };
  }

  const newConfig: OdooConfig = OdooConfigSchema.parse({
    url: input.url ?? oldConfig.url,
    database: input.database ?? oldConfig.database,
    username: input.username ?? oldConfig.username,
    password: nextPassword,
    additionalFields: nextAdditionalFields,
  });

  await prisma.liveDataSource.update({
    where: { id: input.sourceId },
    data: {
      name: input.name ?? existing.name,
      encryptedConfig: encryptConfig(JSON.stringify(newConfig)),
    },
  });

  revalidatePath(`/${input.tenantSlug}/knowledge/live-data`);
  return { ok: true as const };
}

// ── Disconnect (soft-stop sync; keeps synced KnowledgeItems intact) ────────

export async function disconnectSourceAction(
  tenantSlug: string,
  sourceId: string,
) {
  const ctx = await requireOwnerContext(tenantSlug);
  // Scope by tenantId in the where to guarantee no cross-tenant reach.
  await prisma.liveDataSource.updateMany({
    where: { id: sourceId, tenantId: ctx.tenant.id },
    data: { status: "DISCONNECTED" },
  });
  revalidatePath(`/${tenantSlug}/knowledge/live-data`);
  return { ok: true as const };
}
