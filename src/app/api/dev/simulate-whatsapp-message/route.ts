import { type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  decryptCredentials,
  isEncryptedCredentials,
} from "@/server/channels/credentials";
import {
  parseWhatsAppChannelConfig,
  whatsappCredentialsSchema,
  type WhatsAppCredentials,
} from "@/lib/validators";
import { signWhatsAppPayload } from "@/server/channels/whatsapp/signatures";

/**
 * POST /api/dev/simulate-whatsapp-message — dev-only webhook simulator.
 *
 * Builds a Meta-shape inbound webhook payload from a tiny request body,
 * signs it with the calling tenant's stored webhookSecret, and POSTs it
 * to /api/whatsapp/webhook. End-to-end test of the inbound pipeline
 * without burning real WhatsApp messages.
 *
 * Dual-gated, both must hold or the route 404s as if it didn't exist:
 *
 *   - process.env.NODE_ENV !== "production"
 *   - process.env.DEV_WEBHOOK_SIMULATOR === "enabled"
 *
 * Two gates because NODE_ENV isn't always reliable on edge runtimes;
 * DEV_WEBHOOK_SIMULATOR is the hard switch. CLAUDE.md §6 documents
 * this so it never gets accidentally enabled in prod.
 *
 * Request body:
 *   {
 *     tenantSlug: string,         // workspace slug
 *     from: string,               // E.164 phone, e.g. "+213555111222"
 *     text: string,               // message body (TEXT only in this sim)
 *     profileName?: string,       // optional, sets contacts[].profile.name
 *   }
 *
 * Response on success:
 *   { ok: true, providerMessageId, webhookStatus }
 */

const bodySchema = z.object({
  tenantSlug: z.string().trim().min(1),
  from: z.string().trim().min(1),
  text: z.string().trim().min(1).max(4096),
  profileName: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  // Dual gate — 404 on either miss to look like the route doesn't exist.
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  if (process.env.DEV_WEBHOOK_SIMULATOR !== "enabled") {
    return new Response(null, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return new Response(
      JSON.stringify({ error: "NEXT_PUBLIC_APP_URL is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve the tenant's WhatsApp channel. Direct prisma read here (not
  // through requireTenantContext) because the simulator route is
  // unauthenticated for dev convenience — the dual gate is the security
  // boundary.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: body.tenantSlug },
    select: { id: true },
  });
  if (!tenant) {
    return new Response(JSON.stringify({ error: "tenant_not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const channel = await prisma.channel.findFirst({
    where: { tenantId: tenant.id, type: "WHATSAPP" },
  });
  if (!channel) {
    return new Response(
      JSON.stringify({
        error: "no_whatsapp_channel",
        detail: "Tenant has no WhatsApp channel — connect one first.",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Decrypt the channel's webhookSecret so the simulator signs payloads
  // the same way 360dialog will.
  if (!isEncryptedCredentials(channel.credentials)) {
    return new Response(
      JSON.stringify({
        error: "credentials_not_encrypted",
        detail: "Connect the WhatsApp channel via /channels/whatsapp first.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  let credentials: WhatsAppCredentials;
  try {
    credentials = whatsappCredentialsSchema.parse(
      decryptCredentials(channel.credentials),
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "credentials_decrypt_failed",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const cfg = parseWhatsAppChannelConfig(channel.config);

  // Build the Meta-shape inbound payload.
  const fromWaId = body.from.startsWith("+") ? body.from.slice(1) : body.from;
  const providerMessageId = `wamid.SIM_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: cfg.phoneNumberId,
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: cfg.phoneNumber ?? `+${fromWaId}`,
                phone_number_id: cfg.phoneNumberId,
              },
              contacts: body.profileName
                ? [{ wa_id: fromWaId, profile: { name: body.profileName } }]
                : [{ wa_id: fromWaId }],
              messages: [
                {
                  from: fromWaId,
                  id: providerMessageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: body.text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
  const rawBody = JSON.stringify(payload);
  const signature = signWhatsAppPayload({
    rawBody,
    secret: credentials.webhookSecret,
  });

  const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/whatsapp/webhook`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-360DIALOG-Signature": signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(30_000),
  });

  return new Response(
    JSON.stringify({
      ok: res.ok,
      providerMessageId,
      webhookStatus: res.status,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
