import { type NextRequest } from "next/server";
import type { Channel, ChannelType } from "@prisma/client";
import {
  parseMetaWebhook,
  type ParsedMetaInbound,
  type ParsedMetaWebhook,
} from "@/server/channels/meta/parse";
import {
  getMetaAppSecret,
  verifyMetaSignature,
} from "@/server/channels/meta/signatures";
import {
  getChannelByInstagramIgUserId,
  getChannelByMessengerPageId,
} from "@/server/db/channels";
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

/**
 * POST /api/meta/webhook — single ingress for Meta Graph API webhooks.
 * One endpoint serves both products via the envelope.object discriminator
 * Meta sets on every payload:
 *
 *   { object: "page",      ... }   → Messenger DMs
 *   { object: "instagram", ... }   → Instagram DMs
 *
 * Order of operations is load-bearing for security (mirrors Phase 6 with
 * one deviation — see the per-channel-secret note):
 *
 *   1. req.text() ONCE. Never call req.json() before HMAC verification —
 *      re-stringifying parsed JSON produces a different byte sequence and
 *      the HMAC fails (CLAUDE.md §6 webhook-security checklist rule 1).
 *   2. HMAC verification with timingSafeEqual against META_APP_SECRET
 *      (env var, GLOBAL across all Pages and IG accounts on the Meta
 *      app). 401 on miss.
 *   3. JSON.parse + envelope shape sniff. 400 on bad JSON.
 *   4. Switch on envelope.object → parseMetaWebhook + dispatch by kind.
 *      Unknown envelope.object values are 200-acked with a log entry —
 *      we don't 4xx because Meta forwards account/system events with
 *      other object values too and we don't want them retrying.
 *   5. THEN parse + dispatch. Per-message dispatch failure ≠ batch
 *      failure (CLAUDE.md §6 rule 7) — log and continue; idempotency
 *      catches dupes on Meta's batch retry.
 *
 * Phase 7 deviation from Phase 6's per-channel-webhookSecret model:
 * because META_APP_SECRET is global, HMAC verification runs BEFORE
 * channel resolution. The Phase 6 rule "404 on unknown routing key, no
 * signature check on lookup miss" doesn't apply here — instead we use
 * 200+structured-log+drop on unknown pageId/igUserId AFTER the signature
 * passes (Gate 1 H4). 200 prevents Meta from retrying the unknown payload
 * indefinitely; the log lets the operator see late-arriving traffic for
 * a Page that was disconnected.
 *
 * Replay protection: each inbound + status carries a millisecond
 * timestamp; we reject anything outside ±5 min from `now`. Not
 * crypto-strong but raises the bar against passive signature leak
 * attacks (CLAUDE.md §6 rule 3).
 *
 * Idempotency: Meta retries on 5xx (sometimes on slow 2xx too). Each
 * inbound message is keyed by providerMessageId (the `mid`);
 * findMessageByProviderId short-circuits before recordInboundMessage
 * (CLAUDE.md §6 rule 5).
 */

const SIGNATURE_HEADER = "X-Hub-Signature-256";
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Raw body once. No req.json() before HMAC verify.
  const rawBody = await req.text();

  // 2. HMAC verify FIRST — channel-agnostic global secret.
  let secret: string;
  try {
    secret = getMetaAppSecret();
  } catch (err) {
    // Production with META_APP_SECRET unset throws here. Operational
    // misconfiguration → 500, not 401. Helps the operator notice the
    // env is wrong rather than masking it as a signature failure.
    console.error("meta/webhook: META_APP_SECRET not configured:", err);
    return new Response(null, { status: 500 });
  }
  const sigHeader = req.headers.get(SIGNATURE_HEADER);
  if (
    !verifyMetaSignature({
      rawBody,
      signatureHeader: sigHeader,
      secret,
    })
  ) {
    return new Response(null, { status: 401 });
  }

  // 3. JSON.parse — only after the body's signature is valid.
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "invalid_json");
  }

  // 4. Switch on envelope.object. Unknown values get 200+log so Meta
  //    stops retrying — they may be account/system events we don't model.
  const obj = (envelope as { object?: unknown } | null)?.object;
  if (obj !== "page" && obj !== "instagram") {
    console.info(
      `meta/webhook: 200 ack for unknown envelope.object=${JSON.stringify(obj)}`,
    );
    return new Response(null, { status: 200 });
  }

  // 5. Structured parse — schema errors 400 (the body validates as JSON
  //    but the shape is wrong; 400 lets Meta surface this in their tools).
  let parsed: ParsedMetaWebhook;
  try {
    parsed = parseMetaWebhook(envelope);
  } catch (err) {
    console.warn("meta/webhook: parse failed:", err);
    return jsonError(400, "invalid_payload");
  }

  const now = Date.now();
  if (obj === "page") {
    await dispatchBatch({
      parsed,
      now,
      channelKind: "messenger",
      channelType: "MESSENGER",
      resolveChannel: getChannelByMessengerPageId,
    });
  } else {
    await dispatchBatch({
      parsed,
      now,
      channelKind: "instagram",
      channelType: "INSTAGRAM",
      resolveChannel: getChannelByInstagramIgUserId,
    });
  }

  return new Response(null, { status: 200 });
}

/**
 * GET /api/meta/webhook — Meta verify-token challenge.
 *
 * When subscribing the webhook URL in App Dashboard → Webhooks, Meta
 * sends:
 *
 *   GET /api/meta/webhook?hub.mode=subscribe
 *                       &hub.verify_token=<your_token>
 *                       &hub.challenge=<random>
 *
 * Echo hub.challenge if hub.verify_token matches META_VERIFY_TOKEN.
 * 403 on mismatch. 500 if the env var isn't set (refuse to confirm a
 * URL we can't validate later).
 *
 * The verify token is global across all Pages and IG accounts on the
 * Meta app — same shape and semantics as Phase 6's WhatsApp handshake.
 * It identifies the URL as ours; the HMAC on inbound POSTs is the real
 * security boundary.
 */
export function GET(req: NextRequest): Response {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  const expected = process.env.META_VERIFY_TOKEN;
  if (!expected) {
    console.error("meta/webhook GET: META_VERIFY_TOKEN is not set");
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
// Batch dispatch — one helper, parameterized by channel kind
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchBatch(args: {
  parsed: ParsedMetaWebhook;
  now: number;
  channelKind: "messenger" | "instagram";
  channelType: ChannelType;
  resolveChannel: (id: string) => Promise<Channel | null>;
}): Promise<void> {
  const { parsed, now, channelKind, channelType, resolveChannel } = args;

  // Inbound — record + run brain on TEXT.
  for (const inbound of parsed.inbound) {
    if (inbound.channelKind !== channelKind) continue;
    if (Math.abs(now - inbound.timestamp) > REPLAY_WINDOW_MS) {
      console.warn(
        `meta/webhook: dropping replay (>5min) ${inbound.providerMessageId}`,
      );
      continue;
    }
    const channel = await resolveChannel(inbound.externalAccountId);
    if (!channel) {
      // Gate 1 H4 — 200+log+drop AFTER signature passes. Could be a
      // disconnected Page still forwarding webhooks, or a mid-onboarding
      // Page on a Meta app that we share with another tenant.
      console.info(
        `meta/webhook: drop unknown ${channelKind} externalAccountId=${inbound.externalAccountId} mid=${inbound.providerMessageId}`,
      );
      continue;
    }
    try {
      await dispatchInboundMessage({ channel, channelType, inbound });
    } catch (err) {
      // Per-message failure shouldn't tank the batch. Idempotency catches
      // dupes when Meta retries the whole batch.
      console.error(
        `meta/webhook: ${channelKind} dispatch failed for ${inbound.providerMessageId}:`,
        err,
      );
    }
  }

  // Delivery status — patch the matching outbound row. Meta delivery
  // events arrive as one mid per status; the parser already expanded
  // delivery.mids[] into individual ParsedMetaDeliveryStatus rows.
  for (const status of parsed.statuses) {
    if (status.channelKind !== channelKind) continue;
    if (Math.abs(now - status.timestamp) > REPLAY_WINDOW_MS) continue;
    const channel = await resolveChannel(status.externalAccountId);
    if (!channel) continue;
    try {
      await updateMessageDeliveryStatus({
        tenantId: channel.tenantId,
        providerMessageId: status.providerMessageId,
        status: status.status,
      });
    } catch (err) {
      console.error(
        `meta/webhook: ${channelKind} status update failed for ${status.providerMessageId}:`,
        err,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-message inbound dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchInboundMessage(args: {
  channel: { id: string; tenantId: string };
  channelType: ChannelType;
  inbound: ParsedMetaInbound;
}): Promise<void> {
  const { channel, channelType, inbound } = args;

  // Idempotency — Meta retries on 5xx. providerMessageId catches dupes
  // before we run the brain a second time.
  const existing = await findMessageByProviderId({
    tenantId: channel.tenantId,
    providerMessageId: inbound.providerMessageId,
  });
  if (existing) return;

  // 7c skips getProfile — Meta inbound payloads don't carry profile name
  // (unlike WhatsApp's contacts[].profile.name). The leaf clients have
  // typed getProfile methods ready, but invoking them requires decrypted
  // credentials and adds a 100-300ms network call per first-time
  // customer. Wiring it lands in 7e (connect-form preview) or 7d
  // (outbound), where credentials are guaranteed valid. For now the
  // Customer row is created with externalId only; the dashboard renders
  // the externalId as a placeholder name until then.
  const { conversation, customer } = await resolveOrCreateConversation({
    tenantId: channel.tenantId,
    channelId: channel.id,
    channelType,
    externalId: inbound.customerExternalId,
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

  // Brain runs on TEXT only in v1. Voice/image/file rows persist with
  // the right contentType so the dashboard renders them; v1.1 will add
  // STT for voice. Operator can take over manually in Phase 8.
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
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
