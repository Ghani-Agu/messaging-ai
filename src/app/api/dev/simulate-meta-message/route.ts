import { type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  parseInstagramChannelConfig,
  parseMessengerChannelConfig,
} from "@/lib/validators";
import {
  getMetaAppSecret,
  signMetaPayload,
} from "@/server/channels/meta/signatures";

/**
 * POST /api/dev/simulate-meta-message — dev-only Meta webhook simulator.
 *
 * Builds a Meta-shape inbound webhook payload (`object: "page"` for
 * Messenger or `object: "instagram"` for Instagram) from a tiny request
 * body, signs it with `getMetaAppSecret()` (the same accessor the real
 * webhook handler uses — no bypass), and POSTs it to /api/meta/webhook.
 * End-to-end test of the inbound pipeline without burning real Meta
 * sends or real customer accounts.
 *
 * Dual-gated, both must hold or the route 404s as if it didn't exist:
 *
 *   - process.env.NODE_ENV !== "production"
 *   - process.env.DEV_WEBHOOK_SIMULATOR === "enabled"
 *
 * Two gates because NODE_ENV isn't always reliable on edge runtimes;
 * DEV_WEBHOOK_SIMULATOR is the hard switch. CLAUDE.md §6 documents this
 * so it never gets accidentally enabled in prod. Same shape as the
 * Phase 6c WhatsApp simulator.
 *
 * Request body:
 *   {
 *     tenantSlug: string,                       // workspace slug
 *     platform: "messenger" | "instagram",      // which channel
 *     from: string,                             // PSID (messenger) or
 *                                               //   IGSID (instagram)
 *     text: string,                             // message body (TEXT only)
 *     profileName?: string,                     // accepted for parity with
 *                                               //   the WhatsApp simulator;
 *                                               //   unused — Meta's inbound
 *                                               //   payloads don't carry
 *                                               //   profile names.
 *   }
 *
 * Response on success:
 *   { ok, providerMessageId, webhookStatus }
 */

const bodySchema = z.object({
  tenantSlug: z.string().trim().min(1),
  platform: z.enum(["messenger", "instagram"]),
  from: z.string().trim().min(1).max(64),
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
    return jsonError(500, "NEXT_PUBLIC_APP_URL is not set");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return jsonError(
      400,
      "invalid_request",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Resolve the tenant + the channel for the requested platform. Direct
  // prisma read here (not through requireTenantContext) because the
  // simulator route is unauthenticated for dev convenience — the dual
  // gate above is the security boundary.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: body.tenantSlug },
    select: { id: true },
  });
  if (!tenant) {
    return jsonError(404, "tenant_not_found");
  }

  const channelType = body.platform === "messenger" ? "MESSENGER" : "INSTAGRAM";
  const channel = await prisma.channel.findFirst({
    where: { tenantId: tenant.id, type: channelType },
  });
  if (!channel) {
    return jsonError(
      404,
      `no_${body.platform}_channel`,
      `Tenant has no ${channelType} channel — connect one first.`,
    );
  }

  // Build the platform-specific Meta-shape payload. Both products use
  // the same envelope structure (object + entry[].messaging[]) — only
  // the routing IDs and the envelope.object discriminator differ.
  let payload: unknown;
  let providerMessageId: string;
  if (body.platform === "messenger") {
    const cfg = parseMessengerChannelConfig(channel.config);
    providerMessageId = `mid.SIM_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    payload = {
      object: "page",
      entry: [
        {
          id: cfg.pageId,
          time: Date.now(),
          messaging: [
            {
              sender: { id: body.from },
              recipient: { id: cfg.pageId },
              timestamp: Date.now(),
              message: { mid: providerMessageId, text: body.text },
            },
          ],
        },
      ],
    };
  } else {
    const cfg = parseInstagramChannelConfig(channel.config);
    providerMessageId = `mid.SIM_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    payload = {
      object: "instagram",
      entry: [
        {
          id: cfg.igUserId,
          time: Date.now(),
          messaging: [
            {
              sender: { id: body.from },
              recipient: { id: cfg.igUserId },
              timestamp: Date.now(),
              message: { mid: providerMessageId, text: body.text },
            },
          ],
        },
      ],
    };
  }

  // Sign with the same accessor the real webhook handler validates
  // against. In dev with no META_APP_SECRET set, both sides land on
  // STUB_META_APP_SECRET and the roundtrip succeeds.
  const rawBody = JSON.stringify(payload);
  const signature = signMetaPayload({
    rawBody,
    secret: getMetaAppSecret(),
  });

  const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/meta/webhook`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
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

function jsonError(status: number, error: string, detail?: string): Response {
  return new Response(
    JSON.stringify(detail ? { error, detail } : { error }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
