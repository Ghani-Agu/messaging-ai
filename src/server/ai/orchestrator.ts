import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getVoiceProfile } from "@/lib/validators";
import { retrieve, type RetrievedChunk } from "@/server/knowledge/retriever";
import { buildPrompt, type CitationView, type HistoryTurn } from "./prompts/system";
import {
  computeConfidence,
  decideEscalation,
  type EscalationReason,
} from "./confidence";
import {
  getClaudeClient,
  type SendReplyToolArgs,
  type SupportedReplyLanguage,
} from "./claude-client";

/**
 * AI brain orchestrator.
 *
 * Public surface (stable across the stub→real ClaudeClient swap):
 *
 *   runBrain({ tenantId, message, history }) → BrainResult
 *
 * Pipeline:
 *   1. Load tenant + voice profile.
 *   2. Retrieve top-K chunks from the tenant's knowledge base.
 *   3. Build system blocks A/B + user-turn block C.
 *   4. Call Claude (or the stub) with the forced send_reply tool.
 *   5. Compute deterministic confidence post-tool-call.
 *   6. Maybe override escalation_reason to LOW_CONFIDENCE.
 *   7. Return a shaped result the route + UI consume.
 *
 * Streaming variant is deferred along with the real ClaudeClient
 * (see claude-client.ts resumption checklist). This file's surface
 * stays stable when streaming lands — `runBrain` is non-streaming and
 * always exists; a future `runBrainStream` will join it.
 */

// Performance budgets (Phase-4 Gate-1 §6).
const MAX_REPLY_TOKENS = 600;
const MAX_INPUT_TOKEN_HEADROOM = 6000;
const TOP_K_DEFAULT = 8;
const HISTORY_TURNS_DEFAULT = 8;

export type BrainHistoryTurn = HistoryTurn;

export type BrainInput = {
  tenantId: string;
  message: string;
  /** Oldest → newest. Trimmed to the last N turns inside the orchestrator. */
  history?: BrainHistoryTurn[];
  /** Override retrieval top-K. Default: 8. */
  topK?: number;
};

export type BrainCitation = {
  /** 1-based — matches the index seen in send_reply.citations_used. */
  index: number;
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  /** Trimmed preview only — never the full embedding text. */
  preview: string;
  /** From the retriever; for diagnostics. */
  vectorScore: number | null;
  lexicalScore: number | null;
};

export type BrainResult = {
  reply: string;
  language: SupportedReplyLanguage;
  /** All citations the orchestrator surfaced to Claude. */
  citations: BrainCitation[];
  /** Subset (by 1-based index) Claude reported using. */
  citationsUsed: number[];
  /** Self-reported by Claude (0..1). */
  groundedness: number;
  /** Deterministic, computed post-tool-call by computeConfidence(). */
  confidence: number;
  /** Final escalation decision after the LOW_CONFIDENCE override. */
  escalation: EscalationReason | null;
  /**
   * Diagnostic envelope — what Claude originally returned, before the
   * orchestrator's overrides. Surfaced into Message.aiMetadata so we can
   * see the divergence in analytics later.
   */
  aiMetadata: {
    modelId: string;
    claudeRecommendedEscalation: boolean;
    claudeReason: EscalationReason | null;
    topChunkSimilarity: number;
    /** Note: stub client returns null here. */
    usage: { inputTokens: number; outputTokens: number } | null;
  };
};

/**
 * Run the brain end-to-end. Always returns a shaped result; throws only
 * for exceptional conditions (tenant not found, retrieval crash, Claude
 * client crash). Off-topic / no-citation answers come back as a normal
 * BrainResult with `escalation === "OUTSIDE_SCOPE"`.
 */
export async function runBrain(input: BrainInput): Promise<BrainResult> {
  const { tenantId, message } = input;
  const topK = input.topK ?? TOP_K_DEFAULT;
  const history = (input.history ?? []).slice(-HISTORY_TURNS_DEFAULT);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, settings: true },
  });
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const voice = getVoiceProfile(tenant.settings as Prisma.JsonValue);

  const retrieved: RetrievedChunk[] = await retrieve({
    tenantId,
    query: message.trim(),
    topK,
  });

  const citationViews: CitationView[] = retrieved.map((c) => ({
    sourceName: c.sourceName,
    content: c.content,
    sourceUrl: extractUrl(c),
  }));

  const { system, userMessage } = buildPrompt({
    tenantName: tenant.name,
    voice,
    citations: citationViews,
    history,
    message,
  });

  // Cheap input-budget guard. cl100k chars-per-token ≈ 4 on natural prose
  // → 24k chars ≈ 6k tokens. If we ever exceed the budget, throw fast
  // rather than burn API credit on a doomed call.
  const totalChars =
    system.reduce((n, b) => n + b.text.length, 0) + userMessage.length;
  if (totalChars > MAX_INPUT_TOKEN_HEADROOM * 4) {
    throw new Error(
      `prompt exceeds input-token budget (~${Math.round(totalChars / 4)} tokens)`,
    );
  }

  const client = getClaudeClient();
  const claudeResult = await client.sendReply({
    system,
    userMessage,
    maxTokens: MAX_REPLY_TOKENS,
  });
  const tool: SendReplyToolArgs = claudeResult.toolArgs;

  // Top vector similarity is a 0..1 retrieval-truth signal; fall back to 0
  // when there were no vector hits (lex-only / empty corpus).
  const topChunkSimilarity = retrieved[0]?.vectorScore ?? 0;

  const confidence = computeConfidence({
    groundedness: tool.groundedness,
    topChunkSimilarity,
    citationsUsedCount: tool.citations_used.length,
    escalationRecommended: tool.escalation_recommended,
  });

  const escalation = decideEscalation({
    confidence,
    claudeRecommended: tool.escalation_recommended,
    claudeReason: tool.escalation_reason ?? null,
  });

  const citations: BrainCitation[] = retrieved.map((c, i) => ({
    index: i + 1,
    chunkId: c.chunkId,
    sourceId: c.sourceId,
    sourceName: c.sourceName,
    sourceUrl: extractUrl(c),
    preview: c.content.slice(0, 240),
    vectorScore: c.vectorScore,
    lexicalScore: c.lexicalScore,
  }));

  return {
    reply: tool.reply,
    language: tool.language,
    citations,
    citationsUsed: tool.citations_used,
    groundedness: tool.groundedness,
    confidence,
    escalation,
    aiMetadata: {
      modelId: claudeResult.modelId,
      claudeRecommendedEscalation: tool.escalation_recommended,
      claudeReason: tool.escalation_reason ?? null,
      topChunkSimilarity,
      usage: claudeResult.usage,
    },
  };
}

function extractUrl(c: RetrievedChunk): string | undefined {
  if (!c.metadata || typeof c.metadata !== "object" || Array.isArray(c.metadata)) {
    return undefined;
  }
  const m = c.metadata as { url?: unknown; sourceURL?: unknown };
  if (typeof m.url === "string") return m.url;
  if (typeof m.sourceURL === "string") return m.sourceURL;
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming variant
// ─────────────────────────────────────────────────────────────────────────────

export type BrainStreamDelta = { type: "delta"; text: string };
export type BrainStreamDone = { type: "done"; result: BrainResult };
export type BrainStreamEvent = BrainStreamDelta | BrainStreamDone;

/**
 * Streaming variant of runBrain. AsyncGenerator that yields zero or more
 * `delta` events (text fragments, in order) followed by exactly one
 * `done` event carrying the complete BrainResult.
 *
 * Phase 6c shape: a thin wrapper around runBrain that emits the full
 * reply as a single `delta` then `done`. The route handler streams those
 * to the widget exactly the same way it will stream real Anthropic
 * deltas, so wiring is end-to-end correct from day one.
 *
 * Phase 6d (next commit) will replace this body with codepoint-chunked
 * streaming that mirrors widget/src/api.ts's mockBrainStream cadence
 * (~8 codepoints per chunk, ~35ms apart). Real Anthropic SSE streaming
 * lands when the API key arrives (CLAUDE.md §7a resumption checklist
 * step 3) — at which point streamReply replaces the runBrain call here
 * and yields native deltas. Wire shape stays unchanged.
 */
export async function* runBrainStream(
  input: BrainInput,
): AsyncGenerator<BrainStreamEvent> {
  const result = await runBrain(input);
  yield { type: "delta", text: result.reply };
  yield { type: "done", result };
}
