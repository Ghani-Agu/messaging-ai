import { z } from "zod";
import {
  authenticateAndAuthorize,
  widgetAllowMethods,
  widgetAllowHeaders,
} from "@/server/channels/widget/ingress";
import { parseWidgetChannelConfig } from "@/lib/validators";
import {
  loadHistoryTurns,
  markConversationForHandoff,
  recordAiMessage,
  recordInboundMessage,
  resolveOrCreateConversation,
  type MessageAiMetadata,
} from "@/server/db/conversations";
import { runBrainStream, type BrainResult } from "@/server/ai/orchestrator";
import { logGapIfOutsideScope } from "@/server/knowledge/gap-logger";

/**
 * POST /api/widget/messages — single ingress for widget messages.
 *
 * Wire shape locked at Phase-5 commit c5b3e8b (widget/src/types.ts):
 *   request:  StreamRequest { widgetKey, conversationId?, message, customerExternalId }
 *   response: text/event-stream-shaped chunks over a regular HTTP response
 *   events:   { type: "delta", text }
 *             { type: "done",  conversationId, reply, language, citations,
 *                              computedConfidence, escalation, displayName? }
 *
 * Pipeline (per Phase 6c approval):
 *   1. authenticateAndAuthorize  (auth + CORS + status + rate-limit)
 *   2. resolveOrCreateConversation
 *   3. recordInboundMessage
 *   4. open ReadableStream
 *   5. for each runBrainStream event: enqueue SSE-shaped JSON
 *   6. on `done`: recordAiMessage; markConversationForHandoff if escalating;
 *                 enqueue terminal `done` event
 *   7. close stream
 *
 * The dashboard's live-conversations view (6f) catches both the inbound
 * and the AI message via 4s polling — real-time-er handoff is Phase 8.
 *
 * GET-with-side-effects is intentionally avoided: EventSource's auto-
 * retry on disconnect would re-run the brain with no dedup. POST + body
 * + a single fetched ReadableStream is the right shape.
 */

const MAX_MESSAGE_CHARS = 4000;

const bodySchema = z.object({
  widgetKey: z.string().trim().min(1).max(80),
  conversationId: z.string().trim().min(1).max(40).nullish(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  customerExternalId: z.string().trim().min(1).max(80),
  hints: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      email: z.string().trim().email().max(200).optional(),
      phone: z.string().trim().min(1).max(40).optional(),
    })
    .optional(),
});

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Headers,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function POST(req: Request): Promise<Response> {
  const requestOrigin = req.headers.get("origin");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse(400, { error: "bad_request", reason: "invalid_json" });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "bad_request",
      reason: "invalid_body",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  const body = parsed.data;

  const ingress = await authenticateAndAuthorize({
    publicKey: body.widgetKey,
    requestOrigin,
  });
  if (ingress.kind === "fail") return ingress.response;
  const { channel, corsHeaders: cors } = ingress;

  // Resolve-or-create + record inbound. These run before the stream
  // opens so a 5xx here is a clean JSON error rather than a half-open
  // stream the widget has to recover from.
  let resolved: Awaited<ReturnType<typeof resolveOrCreateConversation>>;
  let inbound: Awaited<ReturnType<typeof recordInboundMessage>>;
  try {
    resolved = await resolveOrCreateConversation({
      tenantId: channel.tenantId,
      channelId: channel.id,
      channelType: "WIDGET",
      externalId: body.customerExternalId,
      customerHints: body.hints,
    });
    inbound = await recordInboundMessage({
      tenantId: channel.tenantId,
      conversationId: resolved.conversation.id,
      customerId: resolved.customer.id,
      content: body.message,
    });
  } catch (err) {
    console.error("widget/messages: persist-inbound failed", err);
    return jsonResponse(500, { error: "internal_error" }, cors);
  }

  // Server-confirmed display name (precedence: Channel.config.displayName
  // > channel.displayName fallback). Sent on `done` so the widget can
  // overwrite its data-name placeholder live.
  let serverDisplayName: string = channel.displayName;
  try {
    const cfg = parseWidgetChannelConfig(channel.config);
    if (cfg.displayName) serverDisplayName = cfg.displayName;
  } catch {
    // Tolerant: if config is malformed, fall back to the column.
  }

  const tenantId = channel.tenantId;
  const conversationId = resolved.conversation.id;
  const inboundId = inbound.id;
  const userMessage = body.message;

  // P4r-4: ReadableStream cancel → abort the upstream Anthropic call.
  // When the customer closes the connection mid-stream, this controller
  // fires; runBrainStream → client.streamReply → SDK abort signal closes
  // the upstream socket. Without this, the brain keeps running (and
  // billing) for replies the customer will never see.
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const history = await loadHistoryTurns({
          tenantId,
          conversationId,
          excludeMessageId: inboundId,
          limit: 8,
        });

        let lastResult: BrainResult | null = null;
        for await (const event of runBrainStream({
          tenantId,
          conversationId,
          message: userMessage,
          history,
          signal: abortController.signal,
        })) {
          if (event.type === "delta") {
            send({ type: "delta", text: event.text });
          } else {
            lastResult = event.result;
          }
        }
        if (!lastResult) {
          throw new Error("runBrainStream completed without `done`");
        }

        const aiMetadata: MessageAiMetadata = {
          modelId: lastResult.aiMetadata.modelId,
          language: lastResult.language,
          groundedness: lastResult.groundedness,
          confidence: lastResult.confidence,
          escalation: lastResult.escalation,
          claudeRecommendedEscalation:
            lastResult.aiMetadata.claudeRecommendedEscalation,
          claudeReason: lastResult.aiMetadata.claudeReason,
          topChunkSimilarity: lastResult.aiMetadata.topChunkSimilarity,
          usage: lastResult.aiMetadata.usage,
          citations: lastResult.citations,
          citationsUsed: lastResult.citationsUsed,
        };
        await recordAiMessage({
          tenantId,
          conversationId,
          content: lastResult.reply,
          aiMetadata,
        });
        if (lastResult.escalation) {
          await markConversationForHandoff({
            tenantId,
            conversationId,
            reason: lastResult.escalation,
            notificationContext: {
              customerMessage: userMessage,
              customerIdentifier: body.customerExternalId,
              channel: "widget",
            },
          });
        }
        // Phase 8g-2 / Gate-1 K6: caller-side, fire-and-forget gap log.
        void logGapIfOutsideScope({
          tenantId,
          conversationId,
          customerMessage: userMessage,
          brainResult: lastResult,
        });

        send({
          type: "done",
          conversationId,
          reply: lastResult.reply,
          language: lastResult.language,
          // Phase 8c: BrainResult.citations is now a discriminated union
          // (chunk | item | qna | operational_fact). Map to a wire shape
          // that's backward-compatible with the widget client (sourceName
          // always present; sourceUrl only when meaningful) and additively
          // includes `kind` so future widget UI can show kind-aware badges.
          citations: lastResult.citations.map((c) => {
            const base = { index: c.index, kind: c.kind, preview: c.preview };
            switch (c.kind) {
              case "chunk":
                return {
                  ...base,
                  sourceName: c.sourceName,
                  sourceUrl: c.sourceUrl,
                };
              case "item":
                return {
                  ...base,
                  sourceName: c.brand ? `${c.name} (${c.brand})` : c.name,
                  sourceUrl: undefined as string | undefined,
                };
              case "qna":
                return {
                  ...base,
                  sourceName: `Q&A: ${c.question.slice(0, 60)}`,
                  sourceUrl: undefined as string | undefined,
                };
              case "operational_fact":
                return {
                  ...base,
                  sourceName: `Operational fact: ${c.field}`,
                  sourceUrl: undefined as string | undefined,
                };
              case "contact":
                return {
                  ...base,
                  sourceName: `Contact: ${c.name}`,
                  sourceUrl: undefined as string | undefined,
                };
            }
          }),
          computedConfidence: lastResult.confidence,
          escalation: lastResult.escalation,
          displayName: serverDisplayName,
        });
      } catch (err) {
        // Stream-time errors close the connection without `done`. The
        // widget detects "stream ended without done" and renders the
        // generic connection-lost banner. (Pre-stream errors land as
        // JSON above with distinct error codes.)
        console.error("widget/messages: stream failed", err);
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Customer closed the connection mid-stream. Abort the upstream
      // Anthropic call so we stop billing for tokens nobody will see.
      abortController.abort();
    },
  });

  const responseHeaders = new Headers(cors);
  responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-cache, no-transform");
  responseHeaders.set("X-Accel-Buffering", "no");
  return new Response(stream, { status: 200, headers: responseHeaders });
}

export async function OPTIONS(req: Request): Promise<Response> {
  const requestOrigin = req.headers.get("origin");
  // We need the channel to evaluate origin allowlist on preflight.
  // Browsers send the publicKey in the request body, not on preflight,
  // so we can't resolve the channel here. Fall back to the lenient
  // policy: if any origin is permitted by *any* widget channel in v1
  // (no-allowlist default), let the preflight succeed. The actual
  // POST then enforces the full ingress check.
  //
  // We still need a valid Channel object to satisfy handleCorsPreflight
  // — synthesize a "permissive" stand-in by returning headers that
  // mirror the origin without an allowlist check. Since v1's default is
  // "no allowlist", this matches POST-time behavior for the common
  // case. Channels that DO set an allowlist will fail at POST-time
  // against the body's publicKey, which is the correct point of
  // enforcement.
  if (!requestOrigin) {
    return jsonResponse(403, { error: "missing_origin" });
  }
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", requestOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", widgetAllowMethods.join(", "));
  headers.set("Access-Control-Allow-Headers", widgetAllowHeaders.join(", "));
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

