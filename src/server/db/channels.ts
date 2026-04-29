import "server-only";
import { randomBytes } from "node:crypto";
import type { Channel, ChannelStatus, Prisma } from "@prisma/client";
import { prisma } from "./client";
import {
  parseWidgetChannelConfig,
  type WhatsAppChannelConfig,
  type WhatsAppCredentials,
  type WidgetChannelConfig,
  WIDGET_PUBLIC_KEY_REGEX,
} from "@/lib/validators";
import {
  encryptCredentials,
  decryptCredentials,
  isEncryptedCredentials,
  type EncryptedCredentials,
} from "@/server/channels/credentials";

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

/**
 * Resolve a WhatsApp WABA phone-number-id → Channel. Hot path: every
 * inbound WhatsApp webhook does this once before signature verification.
 * Backed by the Channel_whatsapp_phoneNumberId_unique partial unique
 * index. Returns the row regardless of status; webhook handler 404s on
 * null (no signature check on miss — avoids leaking channel existence
 * via timing).
 */
export function getChannelByWhatsAppPhoneNumberId(
  phoneNumberId: string,
): Promise<Channel | null> {
  if (!phoneNumberId || phoneNumberId.length === 0) {
    return Promise.resolve(null);
  }
  return prisma.channel.findFirst({
    where: {
      type: "WHATSAPP",
      config: { path: ["phoneNumberId"], equals: phoneNumberId },
    },
  });
}

/**
 * Resolve a Facebook Page ID → MESSENGER Channel. Hot path: every inbound
 * Meta webhook with `object: "page"` does this once per inbound entry.
 * Backed by the Channel_messenger_pageId_unique partial unique index from
 * 20260429020000_phase7a_corrective_restore_hnsw_add_meta_indexes.
 *
 * Unlike WhatsApp's per-channel webhookSecret model, the Meta webhook
 * handler verifies HMAC against META_APP_SECRET (global) BEFORE this
 * lookup runs — so a miss here is safe to surface as a structured 200+log
 * (per Gate 1 H4: drop unknown pageId AFTER signature verification).
 */
export function getChannelByMessengerPageId(
  pageId: string,
): Promise<Channel | null> {
  if (!pageId || pageId.length === 0) {
    return Promise.resolve(null);
  }
  return prisma.channel.findFirst({
    where: {
      type: "MESSENGER",
      config: { path: ["pageId"], equals: pageId },
    },
  });
}

/**
 * Resolve an Instagram User ID → INSTAGRAM Channel. Hot path: every
 * inbound Meta webhook with `object: "instagram"` does this once per
 * inbound entry. Backed by the Channel_instagram_igUserId_unique partial
 * unique index. Same post-HMAC drop semantics as the messenger lookup.
 */
export function getChannelByInstagramIgUserId(
  igUserId: string,
): Promise<Channel | null> {
  if (!igUserId || igUserId.length === 0) {
    return Promise.resolve(null);
  }
  return prisma.channel.findFirst({
    where: {
      type: "INSTAGRAM",
      config: { path: ["igUserId"], equals: igUserId },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default displayName used on first create when the caller doesn't provide
 * one (the "enable" path — mints the row but doesn't yet collect surface
 * fields). Visible in the dashboard until an operator overrides it via
 * updateWidgetConfig.
 */
const WIDGET_DEFAULT_DISPLAY_NAME = "Website chat";

/**
 * Idempotent create-or-update of the tenant's WIDGET channel. On first
 * call mints a fresh publicKey via mintWidgetPublicKey(). On subsequent
 * calls the existing publicKey is preserved — only the surface fields
 * (displayName, themeAccent, originsAllowlist) explicitly passed are
 * patched; omitted fields keep their current value. To rotate the key,
 * call rotateWidgetChannelKey() instead.
 *
 * All surface fields are optional. Calling with just `{ tenantId }` is
 * the "enable" path: creates the row with defaults if missing, no-op if
 * present. Calling with surface fields is the "update" path; consumers
 * that require an existing row (updateWidgetConfig) check getWidgetChannel
 * themselves before delegating here.
 */
export async function upsertWidgetChannel(args: {
  tenantId: string;
  displayName?: string;
  themeAccent?: string;
  originsAllowlist?: string[];
}): Promise<Channel> {
  const { tenantId, displayName, themeAccent, originsAllowlist } = args;
  const existing = await getWidgetChannel(tenantId);
  if (existing) {
    const current = parseWidgetChannelConfig(existing.config);
    const nextConfig: WidgetChannelConfig = {
      publicKey: current.publicKey,
      displayName: displayName ?? current.displayName,
      themeAccent: themeAccent ?? current.themeAccent,
      originsAllowlist: originsAllowlist ?? current.originsAllowlist,
    };
    return prisma.channel.update({
      where: { id: existing.id },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        config: nextConfig as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const resolvedDisplayName = displayName ?? WIDGET_DEFAULT_DISPLAY_NAME;
  const newConfig: WidgetChannelConfig = {
    publicKey: mintWidgetPublicKey(),
    displayName: resolvedDisplayName,
    themeAccent,
    originsAllowlist: originsAllowlist ?? [],
  };
  return prisma.channel.create({
    data: {
      tenantId,
      type: "WIDGET",
      displayName: resolvedDisplayName,
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

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp channel CRUD (Phase 6e)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a fresh HMAC webhook secret. 32 bytes hex-encoded (64 chars) —
 * comfortably above 360dialog's minimum and matches the format we're
 * already using in dev for stub channels.
 */
export function mintWhatsAppWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

/** The (single) WHATSAPP channel for a tenant. Null if none yet. */
export function getWhatsAppChannel(
  tenantId: string,
): Promise<Channel | null> {
  return prisma.channel.findUnique({
    where: { tenantId_type: { tenantId, type: "WHATSAPP" } },
  });
}

/**
 * Read + decrypt a WhatsApp channel's credentials. Throws if the row's
 * credentials column isn't a well-formed encrypted envelope, or if the
 * envelope can't be decrypted (key mismatch / tampering). Caller-side
 * try/catch is expected — failures here mean the operator needs to
 * re-paste credentials.
 */
export function decryptWhatsAppCredentials(
  channel: Channel,
): WhatsAppCredentials {
  if (!isEncryptedCredentials(channel.credentials)) {
    throw new Error(
      `decryptWhatsAppCredentials: channel ${channel.id} credentials are not encrypted`,
    );
  }
  return decryptCredentials<WhatsAppCredentials>(channel.credentials);
}

/**
 * Idempotent create-or-update of a tenant's WhatsApp channel.
 *
 * On first call (no row exists): mints a fresh webhookSecret, encrypts
 * the credentials envelope, creates the row CONNECTED.
 *
 * On subsequent calls (row exists): preserves the existing webhookSecret
 * unless the caller explicitly passes a fresh one (rotate path), and
 * preserves any field the caller doesn't pass.
 *
 * Throws on cross-tenant phoneNumberId collision (Postgres P2002 on
 * Channel_whatsapp_phoneNumberId_unique). The caller maps this to a
 * user-facing "phone number is already connected to another workspace"
 * message — see src/server/channels/whatsapp/actions.ts.
 */
export async function upsertWhatsAppChannel(args: {
  tenantId: string;
  config: WhatsAppChannelConfig;
  credentials: WhatsAppCredentials;
}): Promise<Channel> {
  const existing = await getWhatsAppChannel(args.tenantId);
  const encrypted = encryptCredentials(args.credentials);
  const displayName = args.config.displayName ?? "WhatsApp";

  if (existing) {
    return prisma.channel.update({
      where: { id: existing.id },
      data: {
        displayName,
        config: args.config as unknown as Prisma.InputJsonValue,
        credentials: encrypted as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.channel.create({
    data: {
      tenantId: args.tenantId,
      type: "WHATSAPP",
      displayName,
      status: "CONNECTED",
      config: args.config as unknown as Prisma.InputJsonValue,
      credentials: encrypted as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Replace the WhatsApp channel's webhookSecret with a fresh one,
 * preserving the apiToken. Used by the channels page "Rotate secret"
 * button. Returns the new secret so the UI can render the value the
 * operator must paste back into 360dialog's dashboard.
 */
export async function rotateWhatsAppWebhookSecret(
  tenantId: string,
): Promise<{ webhookSecret: string }> {
  const existing = await getWhatsAppChannel(tenantId);
  if (!existing) {
    throw new Error(
      `rotateWhatsAppWebhookSecret: no WhatsApp channel for tenant ${tenantId}`,
    );
  }
  const current = decryptWhatsAppCredentials(existing);
  const nextSecret = mintWhatsAppWebhookSecret();
  const encrypted = encryptCredentials({
    ...current,
    webhookSecret: nextSecret,
  });
  await prisma.channel.update({
    where: { id: existing.id },
    data: {
      credentials: encrypted as unknown as Prisma.InputJsonValue,
    },
  });
  return { webhookSecret: nextSecret };
}

// Re-export for downstream consumers that want the EncryptedCredentials shape.
export { type EncryptedCredentials };
