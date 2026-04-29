"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  decryptMetaCredentials,
  getInstagramChannel,
  getMessengerChannel,
  updateChannelStatus,
  upsertInstagramChannel,
  upsertMessengerChannel,
} from "@/server/db/channels";
import {
  instagramChannelConfigSchema,
  messengerChannelConfigSchema,
  metaCredentialsSchema,
  parseInstagramChannelConfig,
  parseMessengerChannelConfig,
} from "@/lib/validators";
import { getMetaConnectClient } from "./connect";
import type {
  ConfigUpdateState,
  ConfirmMetaConnectState,
  DisconnectState,
  PreviewMetaConnectState,
  TestConnectionState,
} from "./state";

/**
 * Phase 7e Meta channel server actions.
 *
 * Two-step connect flow per Gate 1 H1:
 *
 *   previewFacebookPage  — ADMIN — Phase 1: validate token, fetch Page
 *                          details, return preview shape. No DB write.
 *   confirmFacebookPage  — ADMIN — Phase 2: re-validate, subscribe
 *                          webhooks, upsert MESSENGER and/or INSTAGRAM
 *                          rows. Re-validation per Gate 1 H8 — no
 *                          caching of preview state across the boundary.
 *
 * Per-channel maintenance (independent disconnect granularity, H3):
 *
 *   updateMessengerConfig / updateInstagramConfig — AGENT — patch
 *                                                   displayName.
 *   testConnection                                — AGENT — calls
 *                                                   validateAccessToken
 *                                                   against the live
 *                                                   Graph API; surfaces
 *                                                   token expiry.
 *   disconnectMessenger / disconnectInstagram     — ADMIN — flip status
 *                                                   to DISCONNECTED.
 *                                                   Channel row +
 *                                                   credentials kept.
 *   reconnectMessenger / reconnectInstagram       — ADMIN — flip back
 *                                                   to CONNECTED.
 *
 * Cross-tenant collisions (P2002 on the partial unique indexes from
 * Phase 7a) surface as user-facing "already connected to another
 * workspace" messages, scoped to whichever channel collided.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Preview
// ─────────────────────────────────────────────────────────────────────────────

const previewSchema = z.object({
  tenantSlug: z.string().min(1),
  token: z.string().trim().min(1).max(2048),
});

export async function previewFacebookPage(
  _prev: PreviewMetaConnectState,
  formData: FormData,
): Promise<PreviewMetaConnectState> {
  const result = previewSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    token: formData.get("token"),
  });
  if (!result.success) {
    return {
      status: "error",
      fieldErrors: { token: "Paste your Page Access Token." },
    };
  }

  await requireTenantContext(result.data.tenantSlug, { minRole: "ADMIN" });

  const client = getMetaConnectClient();
  let pageId: string;
  try {
    const me = await client.validateAccessToken({ token: result.data.token });
    pageId = me.id;
  } catch (err) {
    return {
      status: "error",
      fieldErrors: {
        token:
          err instanceof Error
            ? `Token validation failed: ${err.message}`
            : "Token validation failed.",
      },
    };
  }

  try {
    const details = await client.fetchPageDetails({
      pageId,
      token: result.data.token,
    });
    const igAvailable = Boolean(details.instagram_business_account?.id);
    return {
      status: "preview",
      pageId: details.id,
      pageName: details.name,
      igAvailable,
      igUserId: details.instagram_business_account?.id,
      igUsername: details.instagram_business_account?.username,
    };
  } catch (err) {
    return {
      status: "error",
      formMessage:
        err instanceof Error
          ? `Couldn't fetch Page details: ${err.message}`
          : "Couldn't fetch Page details.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Confirm
// ─────────────────────────────────────────────────────────────────────────────

const confirmSchema = z.object({
  tenantSlug: z.string().min(1),
  token: z.string().trim().min(1).max(2048),
  pageId: z.string().trim().min(1).max(64),
  pageName: z.string().trim().min(1).max(120),
  connectMessenger: z.string().optional(),
  connectInstagram: z.string().optional(),
  igUserId: z.string().trim().min(1).max(64).optional().or(z.literal("")),
  igUsername: z.string().trim().min(1).max(120).optional().or(z.literal("")),
});

const SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
];

export async function confirmFacebookPage(
  _prev: ConfirmMetaConnectState,
  formData: FormData,
): Promise<ConfirmMetaConnectState> {
  // FormData.get returns null for absent keys — coerce to undefined so the
  // schema's `.optional()` accepts them (z.string().optional() rejects
  // null). For checkbox fields the convention is "absent → unchecked".
  const result = confirmSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    token: formData.get("token"),
    pageId: formData.get("pageId"),
    pageName: formData.get("pageName"),
    connectMessenger: formData.get("connectMessenger") ?? undefined,
    connectInstagram: formData.get("connectInstagram") ?? undefined,
    igUserId: formData.get("igUserId") ?? "",
    igUsername: formData.get("igUsername") ?? "",
  });
  if (!result.success) {
    return {
      status: "error",
      formMessage: "Invalid request — re-run the preview.",
    };
  }

  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "ADMIN",
  });

  // Re-validate on confirm per Gate 1 H8. No caching of preview state
  // across the form boundary — the operator may have rotated the token
  // between preview and confirm, and we'd rather fail loud here than
  // silently persist stale credentials.
  const client = getMetaConnectClient();
  try {
    await client.validateAccessToken({ token: result.data.token });
  } catch (err) {
    return {
      status: "error",
      fieldErrors: {
        token:
          err instanceof Error
            ? `Token re-validation failed: ${err.message}`
            : "Token re-validation failed.",
      },
    };
  }

  const wantMessenger = result.data.connectMessenger === "on";
  const wantInstagram = result.data.connectInstagram === "on";
  if (!wantMessenger && !wantInstagram) {
    return {
      status: "error",
      formMessage: "Select at least one channel to connect.",
    };
  }

  // Subscribe webhook fields on the Page. Idempotent — Meta returns
  // success whether new or already present. Stub no-ops per H5.
  try {
    await client.subscribeWebhooks({
      pageId: result.data.pageId,
      token: result.data.token,
      subscribedFields: SUBSCRIBED_FIELDS,
    });
  } catch (err) {
    return {
      status: "error",
      formMessage:
        err instanceof Error
          ? `Webhook subscription failed: ${err.message}`
          : "Webhook subscription failed.",
    };
  }

  const credentials = metaCredentialsSchema.parse({
    pageAccessToken: result.data.token,
  });

  let messengerChannelId: string | undefined;
  let instagramChannelId: string | undefined;
  const fieldErrors: { messenger?: string; instagram?: string } = {};

  // Messenger upsert.
  if (wantMessenger) {
    const cfg = messengerChannelConfigSchema.parse({
      provider: "meta-cloud",
      pageId: result.data.pageId,
      pageName: result.data.pageName,
    });
    try {
      const channel = await upsertMessengerChannel({
        tenantId: ctx.tenant.id,
        config: cfg,
        credentials,
      });
      messengerChannelId = channel.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        fieldErrors.messenger =
          "This Facebook Page is already connected to another workspace. Contact support to transfer it.";
      } else {
        throw err;
      }
    }
  }

  // Instagram upsert. Independent of Messenger result — H3 says the two
  // are decoupled. If Messenger succeeded but IG collides, we still
  // return "connected" for messenger and "error" for instagram so the
  // operator sees what landed.
  if (wantInstagram) {
    if (!result.data.igUserId) {
      fieldErrors.instagram =
        "Missing Instagram user id from preview — re-run the preview.";
    } else {
      const cfg = instagramChannelConfigSchema.parse({
        provider: "meta-cloud",
        igUserId: result.data.igUserId,
        igUsername: result.data.igUsername || undefined,
        pageId: result.data.pageId,
      });
      try {
        const channel = await upsertInstagramChannel({
          tenantId: ctx.tenant.id,
          config: cfg,
          credentials,
        });
        instagramChannelId = channel.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          fieldErrors.instagram =
            "This Instagram account is already connected to another workspace. Contact support to transfer it.";
        } else {
          throw err;
        }
      }
    }
  }

  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/messenger`);
  revalidatePath(`/${ctx.tenant.slug}/channels/instagram`);

  // Surface partial-success: if at least one channel succeeded, return
  // connected with whichever ids landed. fieldErrors carries the per-
  // channel collision message for the failed side. If both failed,
  // return error.
  if (messengerChannelId || instagramChannelId) {
    return {
      status: "connected",
      messengerChannelId,
      instagramChannelId,
    };
  }
  return { status: "error", fieldErrors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display-name updates
// ─────────────────────────────────────────────────────────────────────────────

const configUpdateSchema = z.object({
  tenantSlug: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
});

export async function updateMessengerConfig(
  _prev: ConfigUpdateState,
  formData: FormData,
): Promise<ConfigUpdateState> {
  const result = configUpdateSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    displayName: formData.get("displayName"),
  });
  if (!result.success) {
    const fieldErrors: { displayName?: string } = {};
    for (const issue of result.error.issues) {
      if (issue.path[0] === "displayName") {
        fieldErrors.displayName ??= issue.message;
      }
    }
    return { status: "error", fieldErrors };
  }
  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "AGENT",
  });
  const channel = await getMessengerChannel(ctx.tenant.id);
  if (!channel) {
    return { status: "error", formMessage: "Connect Messenger first." };
  }
  const current = parseMessengerChannelConfig(channel.config);
  const next = messengerChannelConfigSchema.parse({
    ...current,
    displayName: result.data.displayName,
  });
  const credentials = decryptMetaCredentials(channel);
  await upsertMessengerChannel({
    tenantId: ctx.tenant.id,
    config: next,
    credentials,
  });
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/messenger`);
  return { status: "saved" };
}

export async function updateInstagramConfig(
  _prev: ConfigUpdateState,
  formData: FormData,
): Promise<ConfigUpdateState> {
  const result = configUpdateSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    displayName: formData.get("displayName"),
  });
  if (!result.success) {
    const fieldErrors: { displayName?: string } = {};
    for (const issue of result.error.issues) {
      if (issue.path[0] === "displayName") {
        fieldErrors.displayName ??= issue.message;
      }
    }
    return { status: "error", fieldErrors };
  }
  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "AGENT",
  });
  const channel = await getInstagramChannel(ctx.tenant.id);
  if (!channel) {
    return { status: "error", formMessage: "Connect Instagram first." };
  }
  const current = parseInstagramChannelConfig(channel.config);
  const next = instagramChannelConfigSchema.parse({
    ...current,
    displayName: result.data.displayName,
  });
  const credentials = decryptMetaCredentials(channel);
  await upsertInstagramChannel({
    tenantId: ctx.tenant.id,
    config: next,
    credentials,
  });
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/instagram`);
  return { status: "saved" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test connection — calls validateAccessToken against the live API
// ─────────────────────────────────────────────────────────────────────────────

const tenantSlugAndPlatformSchema = z.object({
  tenantSlug: z.string().min(1),
  platform: z.enum(["messenger", "instagram"]),
});

export async function testConnection(
  _prev: TestConnectionState,
  formData: FormData,
): Promise<TestConnectionState> {
  const parsed = tenantSlugAndPlatformSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    platform: formData.get("platform"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "AGENT",
  });
  const channel =
    parsed.data.platform === "messenger"
      ? await getMessengerChannel(ctx.tenant.id)
      : await getInstagramChannel(ctx.tenant.id);
  if (!channel) {
    return {
      status: "error",
      message: `Connect ${parsed.data.platform === "messenger" ? "Messenger" : "Instagram"} first.`,
    };
  }

  let credentials;
  try {
    credentials = decryptMetaCredentials(channel);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Decryption failed.",
    };
  }

  const client = getMetaConnectClient();
  try {
    const me = await client.validateAccessToken({
      token: credentials.pageAccessToken,
    });
    return { status: "ok", pageId: me.id, pageName: me.name };
  } catch (err) {
    return {
      status: "error",
      message:
        err instanceof Error
          ? `Token validation failed: ${err.message}`
          : "Token validation failed.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect / reconnect — flip status, preserve row + credentials
// ─────────────────────────────────────────────────────────────────────────────

const tenantSlugOnlySchema = z.object({
  tenantSlug: z.string().min(1),
});

async function setMetaChannelStatus(args: {
  tenantSlug: string;
  platform: "messenger" | "instagram";
  status: "CONNECTED" | "DISCONNECTED";
}): Promise<DisconnectState> {
  const ctx = await requireTenantContext(args.tenantSlug, {
    minRole: "ADMIN",
  });
  const channel =
    args.platform === "messenger"
      ? await getMessengerChannel(ctx.tenant.id)
      : await getInstagramChannel(ctx.tenant.id);
  if (!channel) {
    return {
      status: "error",
      message: `Connect ${args.platform === "messenger" ? "Messenger" : "Instagram"} first.`,
    };
  }
  await updateChannelStatus(ctx.tenant.id, channel.id, args.status);
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/${args.platform}`);
  return { status: "ok" };
}

export async function disconnectMessenger(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };
  return setMetaChannelStatus({
    tenantSlug: parsed.data.tenantSlug,
    platform: "messenger",
    status: "DISCONNECTED",
  });
}

export async function reconnectMessenger(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };
  return setMetaChannelStatus({
    tenantSlug: parsed.data.tenantSlug,
    platform: "messenger",
    status: "CONNECTED",
  });
}

export async function disconnectInstagram(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };
  return setMetaChannelStatus({
    tenantSlug: parsed.data.tenantSlug,
    platform: "instagram",
    status: "DISCONNECTED",
  });
}

export async function reconnectInstagram(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };
  return setMetaChannelStatus({
    tenantSlug: parsed.data.tenantSlug,
    platform: "instagram",
    status: "CONNECTED",
  });
}
