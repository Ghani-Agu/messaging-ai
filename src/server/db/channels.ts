import "server-only";
import { randomBytes } from "node:crypto";
import type { Channel, ChannelStatus, Prisma } from "@prisma/client";
import { prisma } from "./client";
import {
  parseWidgetChannelConfig,
  type WidgetChannelConfig,
  WIDGET_PUBLIC_KEY_REGEX,
} from "@/lib/validators";

/**
 * Phase-6 Channel DB helper layer. All app code (routes, Server Actions,
 * dashboard pages) reaches the Channel table through this module — no raw
 * prisma.channel.* outside src/server/db, per CLAUDE.md §3.
 *
 * displayName precedence (server > client) — the embed's `data-name`
 * attribute is a transient placeholder shown until the first stream
 * response. When `Channel.config.displayName` is set, the route's
 * `done` event includes it and the widget overwrites its panel header
 * with the server-confirmed value. Operator-controlled name always wins.
 */

export { type WidgetChannelConfig } from "@/lib/validators";

// ─────────────────────────────────────────────────────────────────────────────
// Public-key minting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a fresh widget public key. Format: "wgt_pk_" + 32 lowercase hex
 * chars (16 random bytes). Matches WIDGET_PUBLIC_KEY_REGEX.
 */
export function mintWidgetPublicKey(): string {
  return "wgt_pk_" + randomBytes(16).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** All channels for a tenant, ordered by createdAt asc. Used by the channels page. */
export function listChannels(tenantId: string): Promise<Channel[]> {
  return prisma.channel.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
}

/** Tenant-scoped fetch by id; null if not found or not in this tenant. */
export function getChannel(
  tenantId: string,
  channelId: string,
): Promise<Channel | null> {
  return prisma.channel.findFirst({
    where: { id: channelId, tenantId },
  });
}

/** The (single) WIDGET channel for a tenant. Null if none yet. */
export function getWidgetChannel(tenantId: string): Promise<Channel | null> {
  return prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type: "WIDGET" } },
  });
}

/**
 * Resolve a widget public key → Channel. Hot path: every widget API request
 * does this once. Backed by the Channel_widget_publicKey_unique partial
 * unique index. Returns the row regardless of status — callers must
 * differentiate the three outcomes themselves:
 *   - null              → key genuinely unknown (likely 401)
 *   - status=CONNECTED  → proceed normally
 *   - DISCONNECTED/ERROR → channel paused / operator alert (503)
 *
 * Don't conflate "paused" with "unknown" — operators need to see the key
 * is valid but their channel is in a degraded state.
 */
export function getChannelByWidgetPublicKey(
  publicKey: string,
): Promise<Channel | null> {
  // Defensive: the index is partial on type='WIDGET' AND key NOT NULL, so
  // a malformed input can't even hit it; short-circuit before the query.
  if (!WIDGET_PUBLIC_KEY_REGEX.test(publicKey)) return Promise.resolve(null);
  return prisma.channel.findFirst({
    where: {
      type: "WIDGET",
      // Prisma JSON path filter; PG plans this against the partial unique
      // index (verified by scripts/verify-channels-schema.mjs EXPLAIN).
      config: { path: ["publicKey"], equals: publicKey },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent create-or-update of the tenant's WIDGET channel. On first
 * call mints a fresh publicKey via mintWidgetPublicKey(). On subsequent
 * calls the existing publicKey is preserved — only the surface fields
 * (displayName, themeAccent, originsAllowlist) are patched. To rotate
 * the key, call rotateWidgetChannelKey() instead.
 */
export async function upsertWidgetChannel(args: {
  tenantId: string;
  displayName: string;
  themeAccent?: string;
  originsAllowlist?: string[];
}): Promise<Channel> {
  const { tenantId, displayName, themeAccent, originsAllowlist } = args;
  const existing = await getWidgetChannel(tenantId);
  if (existing) {
    const current = parseWidgetChannelConfig(existing.config);
    const nextConfig: WidgetChannelConfig = {
      publicKey: current.publicKey,
      displayName,
      themeAccent: themeAccent ?? current.themeAccent,
      originsAllowlist: originsAllowlist ?? current.originsAllowlist,
    };
    return prisma.channel.update({
      where: { id: existing.id },
      data: {
        displayName,
        config: nextConfig as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const newConfig: WidgetChannelConfig = {
    publicKey: mintWidgetPublicKey(),
    displayName,
    themeAccent,
    originsAllowlist: originsAllowlist ?? [],
  };
  return prisma.channel.create({
    data: {
      tenantId,
      type: "WIDGET",
      displayName,
      status: "CONNECTED",
      config: newConfig as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Replace the widget channel's publicKey with a fresh one. Used by the
 * channels page "Reset key" button. Throws if no WIDGET channel exists
 * (caller should upsert first). Returns the new key so the UI can render
 * the new snippet immediately.
 */
export async function rotateWidgetChannelKey(
  tenantId: string,
): Promise<{ publicKey: string }> {
  const existing = await getWidgetChannel(tenantId);
  if (!existing) {
    throw new Error(
      `rotateWidgetChannelKey: no WIDGET channel for tenant ${tenantId} — call upsertWidgetChannel first`,
    );
  }
  const current = parseWidgetChannelConfig(existing.config);
  const nextKey = mintWidgetPublicKey();
  const nextConfig: WidgetChannelConfig = { ...current, publicKey: nextKey };
  await prisma.channel.update({
    where: { id: existing.id },
    data: { config: nextConfig as unknown as Prisma.InputJsonValue },
  });
  return { publicKey: nextKey };
}

/** Flip status to CONNECTED / DISCONNECTED / ERROR. Tenant-scoped. */
export async function updateChannelStatus(
  tenantId: string,
  channelId: string,
  status: ChannelStatus,
): Promise<void> {
  await prisma.channel.updateMany({
    where: { id: channelId, tenantId },
    data: { status },
  });
}
