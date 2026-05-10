import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  runBrainStream,
  type BrainResult,
  type BrainHistoryTurn,
} from "@/server/ai/orchestrator";
import { SUPPORTED_LANGUAGES } from "@/lib/validators";

/**
 * POST /api/playground/messages — operator-facing chat surface for the
 * Playground page. Mirrors the widget endpoint's SSE wire shape so the
 * client can demux the same { delta | done } events, but with three
 * meaningful differences:
 *
 *   1. Auth: operator JWT via requireTenantContext(slug) — NOT the widget
 *      public key. The slug is supplied in the request body so the route
 *      itself stays slug-agnostic.
 *   2. No DB persistence. Playground sessions are scratchpads. The client
 *      keeps the message thread in component state and forwards prior
 *      turns as `history` on each request. Skipping persistence avoids
 *      polluting /conversations, dashboard metrics, and gap-logger
 *      surfaces. Cost: refresh wipes history (acceptable per spec).
 *   3. No escalation handoff. There's no customer to hand off to —
 *      escalation is informational only (rendered as a badge alongside
 *      the message bubble for the operator).
 *
 * The orchestrator's `conversationId` field is still threaded through —
 * it's an opaque session ID used by the conversation-retry-budget tracker
 * (Gate-1 K5). The client mints a UUID per session ("New session" → new
 * UUID) and we pass it forward; nothing reads it from the DB.
 *
 * Streaming: yields `data: {"type":"delta","text":"..."}\n\n` repeatedly,
 * then a single terminal `data: {"type":"done", ...}\n\n` carrying the
 * full BrainResult (reply + language + citations + confidence +
 * escalation + modelId). Pre-stream errors return JSON; stream-time
 * errors close the connection without a `done` event (client surfaces
 * "stream interrupted" — same shape as widget).
 */

const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 16;

const historyTurnSchema = z.object({
  role: z.enum(["customer", "you"]),
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

const bodySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(40),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  /**
   * Soft hint from the language toggle. The orchestrator detects language
   * from the message itself; we accept this for forward-compat (and to
   * surface in logs) but don't override the brain's detection.
   */
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  conversationId: z.string().trim().min(1).max(64).optional(),
  history: z.array(historyTurnSchema).max(MAX_HISTORY_TURNS).optional(),
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
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

  // Auth + tenant resolution. Throws ForbiddenError on role mismatch (we
  // floor at VIEWER, matching /conversations); redirects on no-session
  // (irrelevant inside an API route — the layout-side guard covers
  // navigation, and the request will simply 401 if the cookie is absent
  // because resolveContext will throw).
  let ctx;
  try {
    ctx = await requireTenantContext(body.tenantSlug, {
      minRole: "VIEWER",
      requiredPermission: "playground:view",
    });
  } catch (err) {
    // Either no session, no membership, or role too low. We don't
    // distinguish — the page-level guard makes this unreachable in
    // normal nav.
    console.error("playground/messages: auth failed", err);
    return jsonResponse(401, { error: "unauthorized" });
  }

  const tenantId = ctx.tenant.id;
  const userMessage = body.message;
  const history: BrainHistoryTurn[] = body.history ?? [];

  // ReadableStream cancel → abort the upstream Anthropic call. Same
  // pattern as the widget endpoint: closing the operator's connection
  // mid-stream stops billing for tokens nobody will see.
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        let lastResult: BrainResult | null = null;
        for await (const event of runBrainStream({
          tenantId,
          conversationId: body.conversationId,
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

        send({
          type: "done",
          conversationId: body.conversationId,
          reply: lastResult.reply,
          language: lastResult.language,
          // Match the widget route's flattened wire shape so future
          // shared client code can demux either source identically.
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
          groundedness: lastResult.groundedness,
          escalation: lastResult.escalation,
          modelId: lastResult.aiMetadata.modelId,
        });
      } catch (err) {
        console.error("playground/messages: stream failed", err);
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
