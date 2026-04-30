import { type NextRequest } from "next/server";
import {
  decryptCredentials,
  isEncryptedCredentials,
} from "@/server/channels/credentials";
import {
  parseWhatsAppWebhook,
  type ParsedInboundMessage,
} from "@/server/channels/whatsapp/parse";
import { resolveWhatsAppChannelFromEnvelope } from "@/server/channels/whatsapp/routing";
import { verifyWhatsAppSignature } from "@/server/channels/whatsapp/signatures";
import {
  whatsappCredentialsSchema,
  type WhatsAppCredentials,
} from "@/lib/validators";
import {
  findMessageByProviderId,
  loadHistoryTurns,
  markConversationForHandoff,
  recordAiMessage,
  recordInboundMessage,
  resolveOrCreateConversation,
  updateMessageDeliveryStatus,
  type MessageAiMetadata,
} from "@/server/db/conversations";
import { runBrain } from "@/server/ai/orchestrator";
import { logGapIfOutsideScope } from "@/server/knowledge/gap-logger";

/**
 * POST /api/whatsapp/webhook — single ingress for 360dialog (Meta-shape)
 * webhooks. Handles both inbound messages and outbound delivery-status
 * updates in the same payload.
 *
 * Order of operations is load-bearing for security:
 *
 *   1. req.text() ONCE. Never call req.json() before HMAC verification —
 *      re-stringifying parsed JSON produces a different byte sequence
 *      and the HMAC fails.
 *   2. Lightweight extraction of phone_number_id (no Zod parse yet).
 *   3. Channel lookup. 404 on miss with no signature check — avoids
 *      leaking channel existence via response timing.
 *   4. Decrypt the channel's credentials → webhookSecret.
 *   5. HMAC verification with timingSafeEqual. 401 on miss.
 *   6. THEN run the structured parser, replay check, dispatch.
 *
 * Replay protection: each message / status update carries a unix-second
 * timestamp; we reject anything older than 5 minutes from `now`. This
 * isn't crypto-strong (an attacker with a leaked signature can still
 * replay within 5 minutes) but it raises the bar against passive
 * signature leak attacks.
 *
 * Idempotency: 360dialog retries on 5xx. Each inbound message is keyed
 * by providerMessageId; findMessageByProviderId short-circuits before
 * recordInboundMessage.
 */

const SIGNATURE_HEADER = "X-360DIALOG-Signature";
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Raw body once. No req.json() before this. (CLAUDE.md §3 webhook
  //    rule — re-stringifying after json() breaks the HMAC.)
  const rawBody = await req.text();

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. + 3. Resolve channel from envelope phone_number_id. 404 on miss
  //    with no signature check — don't reveal that a phoneNumberId is
  //    unknown via different timings.
  const channel = await resolveWhatsAppChannelFromEnvelope(envelope);
  if (!channel) {
    return new Response(null, { status: 404 });
  }

  // 4. Decrypt credentials. If encryption fails (key missing, blob
  //    malformed, tag tampering), we treat it as a server-side problem,
  //    not a client problem — 500 alerts the operator.
  if (!isEncryptedCredentials(channel.credentials)) {
    console.error(
      `whatsapp/webhook: channel ${channel.id} has unencrypted credentials`,
    );
    return new Response(null, { status: 500 });
  }
  let credentials: WhatsAppCredentials;
  try {
    const decrypted = decryptCredentials<WhatsAppCredentials>(
      channel.credentials,
    );
    credentials = whatsappCredentialsSchema.parse(decrypted);
  } catch (err) {
    console.error(
      `whatsapp/webhook: failed to decrypt/parse credentials for channel ${channel.id}:`,
      err,
    );
    return new Response(null, { status: 500 });
  }

  // 5. HMAC verification.
  const signatureHeader = req.headers.get(SIGNATURE_HEADER);
  const valid = verifyWhatsAppSignature({
    rawBody,
    signatureHeader,
    secret: credentials.webhookSecret,
  });
  if (!valid) {
    return new Response(null, { status: 401 });
  }

  // 6. Structured parse — only AFTER verification.
  let parsed;
  try {
    parsed = parseWhatsAppWebhook(envelope);
  } catch (err) {
    console.warn("whatsapp/webhook: parse failed:", err);
    return new Response(JSON.stringify({ error: "invalid_payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Date.now();

  // ───────────────────────────────────────────────────────────────────────
  // Inbound messages — record + run brain (TEXT only) + record AI reply.
  // 6c does NOT yet send the AI reply via the provider; the outbound hook
  // lands in 6d.
  // ───────────────────────────────────────────────────────────────────────
  for (const inbound of parsed.inbound) {
    if (Math.abs(now - inbound.timestamp * 1000) > REPLAY_WINDOW_MS) {
      console.warn(
        `whatsapp/webhook: dropping replay (>5min) for ${inbound.providerMessageId}`,
      );
      continue;
    }
    try {
      await dispatchInboundMessage({ channel, inbound });
    } catch (err) {
      // Per-message failures get logged but don't fail the whole batch —
      // 360dialog otherwise retries the WHOLE batch including messages
      // that already succeeded. Idempotency catches dupes on retry.
      console.error(
        `whatsapp/webhook: dispatchInboundMessage failed for ${inbound.providerMessageId}:`,
        err,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Status updates — patch the matching outbound row's delivery status.
  // ───────────────────────────────────────────────────────────────────────
  for (const status of parsed.statuses) {
    if (Math.abs(now - status.timestamp * 1000) > REPLAY_WINDOW_MS) continue;
    try {
      await updateMessageDeliveryStatus({
        tenantId: channel.tenantId,
        providerMessageId: status.providerMessageId,
        status: status.status,
      });
    } catch (err) {
      console.error(
        `whatsapp/webhook: status update failed for ${status.providerMessageId}:`,
        err,
      );
    }
  }

  return new Response(null, { status: 200 });
}

/**
 * GET /api/whatsapp/webhook — Meta-style verify-token challenge.
 *
 * 360dialog uses the same handshake as Meta's Cloud API: when
 * registering the webhook URL, the platform sends:
 *
 *   GET /webhook?hub.mode=subscribe
 *               &hub.verify_token=<your_token>
 *               &hub.challenge=<random>
 *
 * We compare hub.verify_token against META_VERIFY_TOKEN and echo the
 * challenge if it matches; otherwise 403.
 *
 * The verify token is global in v1 (one shared token across all
 * tenants) — it's just an identifier proving the webhook URL is ours,
 * not a security boundary. The HMAC signature on inbound POSTs is the
 * actual security.
 */
export function GET(req: NextRequest): Response {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  const expected = process.env.META_VERIFY_TOKEN;
  if (!expected) {
    console.error("whatsapp/webhook GET: META_VERIFY_TOKEN is not set");
    return new Response(null, { status: 500 });
  }

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response(null, { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound message dispatch — extracted for clarity
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchInboundMessage(args: {
  channel: { id: string; tenantId: string };
  inbound: ParsedInboundMessage;
}): Promise<void> {
  const { channel, inbound } = args;

  // Idempotency — 360dialog retries on 5xx; the providerMessageId
  // catches dupes before we run the brain a second time.
  const existing = await findMessageByProviderId({
    tenantId: channel.tenantId,
    providerMessageId: inbound.providerMessageId,
  });
  if (existing) return;

  const { conversation, customer } = await resolveOrCreateConversation({
    tenantId: channel.tenantId,
    channelId: channel.id,
    channelType: "WHATSAPP",
    externalId: inbound.customerWaId,
    customerHints: {
      name: inbound.profileName ?? undefined,
      phone: inbound.customerPhoneNumber,
    },
  });

  const inboundMessage = await recordInboundMessage({
    tenantId: channel.tenantId,
    conversationId: conversation.id,
    customerId: customer.id,
    content: inbound.content,
    contentType: inbound.contentType,
    mediaUrl: inbound.mediaUrl ?? undefined,
    providerMessageId: inbound.providerMessageId,
  });

  // Brain runs only on TEXT in v1. Voice/image/file rows persist with
  // the right contentType so the dashboard renders them; v1.1 will add
  // STT for voice. Non-text inbound just sits in the conversation with
  // no AI reply — operator sees it and can take over manually in
  // Phase 8.
  if (inbound.contentType !== "TEXT") return;

  const history = await loadHistoryTurns({
    tenantId: channel.tenantId,
    conversationId: conversation.id,
    excludeMessageId: inboundMessage.id,
    limit: 8,
  });

  const result = await runBrain({
    tenantId: channel.tenantId,
    message: inbound.content,
    history,
  });

  const aiMetadata: MessageAiMetadata = {
    modelId: result.aiMetadata.modelId,
    language: result.language,
    groundedness: result.groundedness,
    confidence: result.confidence,
    escalation: result.escalation,
    claudeRecommendedEscalation: result.aiMetadata.claudeRecommendedEscalation,
    claudeReason: result.aiMetadata.claudeReason,
    topChunkSimilarity: result.aiMetadata.topChunkSimilarity,
    usage: result.aiMetadata.usage,
    citations: result.citations,
    citationsUsed: result.citationsUsed,
  };
  await recordAiMessage({
    tenantId: channel.tenantId,
    conversationId: conversation.id,
    content: result.reply,
    aiMetadata,
  });
  if (result.escalation) {
    await markConversationForHandoff({
      tenantId: channel.tenantId,
      conversationId: conversation.id,
      reason: result.escalation,
    });
  }
  // Phase 8g-2 / Gate-1 K6: caller-side, fire-and-forget. logGapIfOutsideScope
  // is a no-op for non-OUTSIDE_SCOPE replies and never throws.
  void logGapIfOutsideScope({
    tenantId: channel.tenantId,
    conversationId: conversation.id,
    customerMessage: inbound.content,
    brainResult: result,
  });
}
