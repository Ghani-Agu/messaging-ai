import "server-only";
import type { BrainResult } from "@/server/ai/orchestrator";
import { recordKnowledgeGap } from "@/server/db/knowledge-gaps";

/**
 * Caller-side gap-log hook (Phase 8g-2 / Gate-1 K6).
 *
 * Fire-and-forget side effect from the channel webhook handlers
 * (whatsapp / meta / widget) — when the brain says the customer asked
 * something it couldn't answer from the knowledge base, record a
 * KnowledgeGap so the operator sees what to add. The embed worker
 * picks up the gap, embeds the question, and runs cluster-on-write
 * (see workers/embed.ts handleEmbedGapsBatch).
 *
 * THE OUTSIDE_SCOPE SIGNAL CAN ARRIVE TWO WAYS:
 *   1. brainResult.escalation === "OUTSIDE_SCOPE" — Claude flagged it
 *      AND confidence stayed above threshold (orchestrator preserved
 *      Claude's reason).
 *   2. brainResult.aiMetadata.claudeReason === "OUTSIDE_SCOPE" —
 *      Claude flagged it but confidence dropped below threshold and
 *      decideEscalation() overrode the final escalation to
 *      LOW_CONFIDENCE. The original signal is still there in
 *      aiMetadata.claudeReason; the LOW_CONFIDENCE override is a
 *      safety upgrade, not a different finding.
 *
 * We log on EITHER signal. Pure LOW_CONFIDENCE without an underlying
 * OUTSIDE_SCOPE intent isn't a knowledge gap — it's ambiguity, poor
 * retrieval, or a partially-relevant question that Claude could
 * partially answer. Those don't belong in the gap log.
 *
 * Per Gate-1 K6 the hook lives at the runBrain caller, not inside
 * runBrain itself — keeps the brain pure (returns a BrainResult; the
 * caller decides what to log/persist/dispatch — same shape as
 * recordAiMessage and dispatchOutboundReply).
 *
 * NEVER throws. A failure to log a gap mustn't disrupt the customer
 * reply that's being persisted in the same handler call. Errors are
 * console.warn'd and swallowed.
 */
export async function logGapIfOutsideScope(args: {
  tenantId: string;
  conversationId: string;
  customerMessage: string;
  brainResult: BrainResult;
}): Promise<void> {
  const isOutsideScope =
    args.brainResult.escalation === "OUTSIDE_SCOPE" ||
    args.brainResult.aiMetadata.claudeReason === "OUTSIDE_SCOPE";
  if (!isOutsideScope) return;
  try {
    await recordKnowledgeGap({
      tenantId: args.tenantId,
      input: {
        question: args.customerMessage,
        // Use the brain's reported language — orchestrator's authoritative
        // signal is the one Claude self-detected (or the stub's regex
        // detection). Fine to be approximate; the gap log is operator-
        // facing diagnostic, not a hot retrieval input.
        language: args.brainResult.language,
        // Only set conversationId when it's non-empty. The schema's FK
        // expects a real Conversation row; passing an empty string would
        // fail the Zod min(1) check, and an unknown ID would fail the
        // Prisma FK check. Tolerating undefined lets test harnesses log
        // gaps without a conversation context.
        conversationId: args.conversationId || undefined,
      },
    });
  } catch (err) {
    // Don't propagate. The gap log is operator-facing; failing to record
    // it shouldn't disrupt the customer reply that already landed.
    console.warn(
      `[gap-logger] failed to record gap for tenant=${args.tenantId} ` +
        `conversation=${args.conversationId}:`,
      err,
    );
  }
}
