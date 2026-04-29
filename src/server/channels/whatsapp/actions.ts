"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  decryptWhatsAppCredentials,
  getWhatsAppChannel,
  mintWhatsAppWebhookSecret,
  rotateWhatsAppWebhookSecret as rotateWhatsAppWebhookSecretDb,
  updateChannelStatus,
  upsertWhatsAppChannel,
} from "@/server/db/channels";
import {
  whatsappChannelConfigSchema,
  whatsappCredentialsSchema,
} from "@/lib/validators";
import type {
  ConnectWhatsAppState,
  DisconnectWhatsAppState,
  RotateWhatsAppSecretState,
  TestWhatsAppConnectionState,
  UpdateWhatsAppConfigState,
} from "./state";

/**
 * Phase 6e WhatsApp channel server actions. Five surfaces:
 *
 *   connectWhatsAppChannel        — ADMIN — first-time setup. Creates
 *                                   the channel row, encrypts API key,
 *                                   mints HMAC webhookSecret. P2002 on
 *                                   the cross-tenant phoneNumberId
 *                                   partial unique → user-facing
 *                                   "phone number connected elsewhere".
 *   updateWhatsAppConfig          — AGENT — patch displayName /
 *                                   phoneNumber. Apple-token / phone-
 *                                   number-id are immutable post-
 *                                   connect (use disconnect+reconnect).
 *   rotateWhatsAppWebhookSecret   — ADMIN — replace the HMAC secret.
 *                                   Operator must paste the new value
 *                                   into 360dialog dashboard or
 *                                   incoming webhooks 401 instantly.
 *   disconnectWhatsAppChannel     — ADMIN — flip status to DISCONNECTED.
 *                                   Channel row + credentials kept so
 *                                   reconnect doesn't need re-paste.
 *   testWhatsAppConnection        — AGENT — config-validity check
 *                                   (encrypted credentials decrypt,
 *                                   secret format ok). Doesn't hit
 *                                   the provider — first real webhook
 *                                   is the network test. Useful to
 *                                   catch encryption-key drift after
 *                                   ENCRYPTION_KEY rotation.
 */

const connectSchema = z.object({
  tenantSlug: z.string().min(1),
  phoneNumberId: z.string().trim().min(1).max(64),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be E.164 (e.g. +213555123456)")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  displayName: z.string().trim().min(1).max(80),
  apiToken: z.string().trim().min(1).max(512),
});

export async function connectWhatsAppChannel(
  _prev: ConnectWhatsAppState,
  formData: FormData,
): Promise<ConnectWhatsAppState> {
  const result = connectSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    phoneNumberId: formData.get("phoneNumberId"),
    phoneNumber: formData.get("phoneNumber") ?? "",
    displayName: formData.get("displayName"),
    apiToken: formData.get("apiToken"),
  });
  if (!result.success) {
    const fieldErrors: NonNullable<
      Extract<ConnectWhatsAppState, { status: "error" }>["fieldErrors"]
    > = {};
    for (const issue of result.error.issues) {
      const k = issue.path[0];
      if (
        k === "phoneNumberId" ||
        k === "phoneNumber" ||
        k === "displayName" ||
        k === "apiToken"
      ) {
        fieldErrors[k] ??= issue.message;
      }
    }
    return { status: "error", fieldErrors };
  }

  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "ADMIN",
  });

  const webhookSecret = mintWhatsAppWebhookSecret();
  const config = whatsappChannelConfigSchema.parse({
    provider: "threesixtydialog",
    phoneNumberId: result.data.phoneNumberId,
    phoneNumber: result.data.phoneNumber,
    displayName: result.data.displayName,
  });
  const credentials = whatsappCredentialsSchema.parse({
    apiToken: result.data.apiToken,
    webhookSecret,
  });

  let channelId: string;
  try {
    const channel = await upsertWhatsAppChannel({
      tenantId: ctx.tenant.id,
      config,
      credentials,
    });
    channelId = channel.id;
  } catch (err) {
    // Cross-tenant phoneNumberId collision — the partial unique on
    // (config->>'phoneNumberId') WHERE type='WHATSAPP' rejects two
    // tenants registering the same number. Surface a user-facing error
    // rather than a 500.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        status: "error",
        fieldErrors: {
          phoneNumberId:
            "This phone number is already connected to another workspace. Contact support to transfer it.",
        },
      };
    }
    throw err;
  }

  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/whatsapp`);
  return { status: "connected", channelId, webhookSecret };
}

const updateConfigSchema = z.object({
  tenantSlug: z.string().min(1),
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be E.164 (e.g. +213555123456)")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  displayName: z.string().trim().min(1).max(80),
});

export async function updateWhatsAppConfig(
  _prev: UpdateWhatsAppConfigState,
  formData: FormData,
): Promise<UpdateWhatsAppConfigState> {
  const result = updateConfigSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    phoneNumber: formData.get("phoneNumber") ?? "",
    displayName: formData.get("displayName"),
  });
  if (!result.success) {
    const fieldErrors: NonNullable<
      Extract<UpdateWhatsAppConfigState, { status: "error" }>["fieldErrors"]
    > = {};
    for (const issue of result.error.issues) {
      const k = issue.path[0];
      if (k === "phoneNumber" || k === "displayName") {
        fieldErrors[k] ??= issue.message;
      }
    }
    return { status: "error", fieldErrors };
  }

  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "AGENT",
  });
  const channel = await getWhatsAppChannel(ctx.tenant.id);
  if (!channel) {
    return {
      status: "error",
      formMessage: "Connect WhatsApp first.",
    };
  }

  // Patch only the surface fields; preserve provider + phoneNumberId
  // (those are tied to credentials and shouldn't change without a
  // disconnect+reconnect).
  const currentConfig = whatsappChannelConfigSchema.parse(channel.config);
  const nextConfig = whatsappChannelConfigSchema.parse({
    ...currentConfig,
    displayName: result.data.displayName,
    phoneNumber: result.data.phoneNumber ?? currentConfig.phoneNumber,
  });
  const credentials = decryptWhatsAppCredentials(channel);
  await upsertWhatsAppChannel({
    tenantId: ctx.tenant.id,
    config: nextConfig,
    credentials,
  });

  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/whatsapp`);
  return { status: "saved" };
}

const tenantSlugOnlySchema = z.object({
  tenantSlug: z.string().min(1),
});

export async function rotateWhatsAppWebhookSecret(
  _prev: RotateWhatsAppSecretState,
  formData: FormData,
): Promise<RotateWhatsAppSecretState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
  });
  const channel = await getWhatsAppChannel(ctx.tenant.id);
  if (!channel) {
    return { status: "error", message: "Connect WhatsApp first." };
  }
  const { webhookSecret } = await rotateWhatsAppWebhookSecretDb(ctx.tenant.id);
  revalidatePath(`/${ctx.tenant.slug}/channels/whatsapp`);
  return { status: "rotated", webhookSecret };
}

export async function disconnectWhatsAppChannel(
  _prev: DisconnectWhatsAppState,
  formData: FormData,
): Promise<DisconnectWhatsAppState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
  });
  const channel = await getWhatsAppChannel(ctx.tenant.id);
  if (!channel) return { status: "error", message: "Connect WhatsApp first." };

  await updateChannelStatus(ctx.tenant.id, channel.id, "DISCONNECTED");
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/whatsapp`);
  return { status: "ok" };
}

export async function reconnectWhatsAppChannel(
  _prev: DisconnectWhatsAppState,
  formData: FormData,
): Promise<DisconnectWhatsAppState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
  });
  const channel = await getWhatsAppChannel(ctx.tenant.id);
  if (!channel) return { status: "error", message: "Connect WhatsApp first." };

  await updateChannelStatus(ctx.tenant.id, channel.id, "CONNECTED");
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/whatsapp`);
  return { status: "ok" };
}

export async function testWhatsAppConnection(
  _prev: TestWhatsAppConnectionState,
  formData: FormData,
): Promise<TestWhatsAppConnectionState> {
  const parsed = tenantSlugOnlySchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "AGENT",
  });
  const channel = await getWhatsAppChannel(ctx.tenant.id);
  if (!channel) {
    return { status: "error", message: "Connect WhatsApp first." };
  }

  // Config-validity check: decrypt round-trips, schema validates. We
  // intentionally don't probe the provider here — that's what the
  // first real webhook (or the dev simulator) does. This action is for
  // catching ENCRYPTION_KEY drift / corrupted-blob / bad-secret-length
  // before they manifest at webhook-time.
  try {
    const credentials = decryptWhatsAppCredentials(channel);
    whatsappCredentialsSchema.parse(credentials);
    whatsappChannelConfigSchema.parse(channel.config);
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Validation failed.",
    };
  }
}
