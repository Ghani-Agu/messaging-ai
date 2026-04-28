import "server-only";

/**
 * Deterministic post-tool-call confidence + escalation logic.
 *
 * The system prompt asks Claude for `groundedness` (a self-report of how
 * thoroughly the reply is supported by the cited chunks). Confidence is a
 * separate, deterministic combination of that self-report with retrieval
 * signals the orchestrator can verify without trusting the model.
 *
 * Formula (v1, weights confirmed by project lead at Phase-4 Gate 1):
 *
 *   confidence = clamp(
 *       0.50 · groundedness
 *     + 0.25 · topChunkSimilarity                         // 0..1, vector top-1
 *     + 0.15 · min(citations_used.length, 3) / 3          // saturates at 3
 *     − 0.30 · (escalation_recommended ? 1 : 0)
 *     − 0.20 · (citations_used.length === 0 ? 1 : 0)
 *   , 0, 1)
 *
 * Why this shape:
 *   - groundedness dominates (0.50): Claude has the most context — the
 *     full reply, the citations, the brand voice — to judge support.
 *   - topChunkSimilarity (0.25): cheap retrieval-truth check. If the
 *     top vector hit is ~0.85+ we trust the corpus had something close;
 *     if ~0.30 we don't.
 *   - citation count (0.15): saturates at 3 so a stuffy reply citing 8
 *     chunks doesn't outscore a precise one citing 2.
 *   - the two penalties:
 *       * escalation_recommended (-0.30): if Claude already wants to
 *         escalate, we shouldn't paper over it with a high score.
 *       * zero citations (-0.20): an answer with no grounding cannot
 *         clear the LOW_CONFIDENCE threshold.
 *
 * Threshold (LOW_CONFIDENCE override): confidence < 0.6 forces the
 * orchestrator to set escalation_reason = "LOW_CONFIDENCE", regardless
 * of what Claude returned. The model's original choice is preserved in
 * Message.aiMetadata for analytics.
 */

export const CONFIDENCE_THRESHOLD = 0.6;

export type EscalationReason =
  | "LOW_CONFIDENCE"
  | "NEGATIVE_SENTIMENT"
  | "EXPLICIT_REQUEST"
  | "OUTSIDE_SCOPE"
  | "PAYMENT_DISPUTE";

export type ConfidenceInput = {
  groundedness: number;
  topChunkSimilarity: number;
  citationsUsedCount: number;
  escalationRecommended: boolean;
};

const W_GROUNDEDNESS = 0.5;
const W_TOP_CHUNK = 0.25;
const W_CITATION_COUNT = 0.15;
const P_ESCALATION = 0.3;
const P_ZERO_CITATIONS = 0.2;
const CITATION_SATURATION = 3;

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function computeConfidence(input: ConfidenceInput): number {
  const g = clamp01(input.groundedness);
  const t = clamp01(input.topChunkSimilarity);
  const cCount = Math.max(0, Math.floor(input.citationsUsedCount));
  const cSat = Math.min(cCount, CITATION_SATURATION) / CITATION_SATURATION;

  const score =
    W_GROUNDEDNESS * g +
    W_TOP_CHUNK * t +
    W_CITATION_COUNT * cSat -
    (input.escalationRecommended ? P_ESCALATION : 0) -
    (cCount === 0 ? P_ZERO_CITATIONS : 0);

  return clamp01(score);
}

/**
 * Decide the final escalation_reason after computing confidence. If the
 * orchestrator's deterministic confidence falls below the threshold, force
 * LOW_CONFIDENCE — that's the post-hoc override path. Otherwise honor
 * Claude's choice. If Claude didn't recommend escalation and confidence is
 * acceptable, return null (no escalation).
 */
export function decideEscalation(args: {
  confidence: number;
  claudeRecommended: boolean;
  claudeReason: EscalationReason | null;
}): EscalationReason | null {
  if (args.confidence < CONFIDENCE_THRESHOLD) return "LOW_CONFIDENCE";
  if (args.claudeRecommended && args.claudeReason) return args.claudeReason;
  return null;
}
