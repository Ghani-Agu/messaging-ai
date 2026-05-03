import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getVoiceProfile } from "@/lib/validators";
import {
  retrieveChunks,
  retrieveItems,
  retrieveQnaMatches,
  type RetrievedChunk,
} from "@/server/knowledge/retriever";
import {
  detectTier2Relevance,
  getOperationalFacts,
  pickRelevantTier2,
  pickTier1,
  type OperationalFactsTier2,
} from "@/server/db/operational-facts";
import { embed } from "@/server/ai/embeddings";
import { detectLanguage } from "@/lib/language-detect";
import {
  buildPrompt,
  countTokens,
  type HistoryTurn,
  type RenderedCitation,
  type OperationalFactField,
} from "./prompts/system";
import {
  computeConfidence,
  decideEscalation,
  type EscalationReason,
} from "./confidence";
import {
  getClaudeClient,
  type SendReplyResult,
  type SendReplyToolArgs,
  type SupportedReplyLanguage,
} from "./claude-client";
import {
  AnthropicConversationBudgetExhaustedError,
  AnthropicError,
  AnthropicMissingMetadataError,
  AnthropicToolRefusalError,
} from "./errors";
import { CONVERSATION_RETRY_CAP } from "./anthropic-config";
import { computeCostUsd, formatUsd } from "./pricing";
import { getToolRefusalFallback } from "./fallbacks";
import { createHash } from "node:crypto";
import { BLOCK_A_TEXT } from "./prompts/system";

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

// Performance budgets (Phase-4 Gate-1 §6, bumped in Phase-8b/c Gate-1).
const MAX_REPLY_TOKENS = 600;
// Phase 8b bumped 6000 → 8000 for tier-1 ops facts in Block B; Phase 8c
// keeps 8000 with explicit per-section caps in Block C (items / qna /
// facts each have their own ceiling enforced via top-K + content trim).
// Per-section budgets are aspirational; this guard is the last-line
// failsafe before an API call.
const MAX_INPUT_TOKEN_HEADROOM = 8000;

// Per-channel retrieval top-K. Chunks scale down to 5 when items are
// present (per Gate-1 P8c risk discussion) so the combined Block C stays
// under the 5500-token A+B+C target asserted in prompts/system.test.ts.
const TOP_K_CHUNKS_NO_ITEMS = 8;
const TOP_K_CHUNKS_WITH_ITEMS = 5;
const TOP_K_ITEMS = 5;
const TOP_K_QNA = 1; // top-1 above threshold; multi-Q&A blending is post-v1
const HISTORY_TURNS_DEFAULT = 8;

export type BrainHistoryTurn = HistoryTurn;

export type BrainInput = {
  tenantId: string;
  message: string;
  /**
   * Optional conversation ID. When provided, the orchestrator tracks
   * cumulative retries against CONVERSATION_RETRY_CAP and fails fast if
   * the budget is exhausted (Gate-1 K5). Smart-import / one-shot calls
   * pass undefined and skip the budget check.
   */
  conversationId?: string;
  /** Oldest → newest. Trimmed to the last N turns inside the orchestrator. */
  history?: BrainHistoryTurn[];
  /** Override retrieval top-K. Default: 8. */
  topK?: number;
};

/**
 * Per-conversation cumulative retry tracker (Gate-1 K5). Module-scoped
 * Map; survives across runBrain calls but not across process restarts.
 * Trade-off accepted: a process restart resets the budget for in-flight
 * conversations. For v1 this is fine — the budget exists to short-circuit
 * runaway retry storms within a session, not to enforce a hard SLA.
 *
 * The Map is uncapped on entry count; for v1 a single process won't see
 * enough concurrent conversations to matter. If we ever do, swap to an
 * LRU-with-TTL — the contract here is just "increment per non-zero
 * retriesUsed, reset on a clean turn".
 */
const conversationRetryBudget = new Map<string, number>();

/** Test affordance: clear the conversation retry tracker between runs. */
export function __resetConversationRetryBudgetForTests(): void {
  conversationRetryBudget.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// [brain-cache] cache-invalidation logging (P4r-3 Gate-1 B)
//
// Anthropic prompt caching is keyed on byte-level content. Any edit to
// BLOCK_A_TEXT invalidates the platform-rules cache process-wide; any
// per-tenant edit (voice profile, tier-1 facts) invalidates that
// tenant's Block B cache. Both cost +25% input on the first call after
// the change.
//
// We log a SHA-256 prefix per block on first occurrence so operators
// can grep `[brain-cache]` and see when the prompt content rotated —
// the proxy signal for cache-invalidation events.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCK_A_SHA = sha12(BLOCK_A_TEXT);
let blockACacheLogged = false;
const blockBLastSHAByTenant = new Map<string, string>();

function sha12(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function maybeLogBlockACache(): void {
  if (blockACacheLogged) return;
  blockACacheLogged = true;
  console.log(
    `[brain-cache] block-a sha=${BLOCK_A_SHA} tokens=${countTokens(BLOCK_A_TEXT)}`,
  );
}

function maybeLogBlockBCache(tenantId: string, blockBText: string): void {
  const sha = sha12(blockBText);
  const last = blockBLastSHAByTenant.get(tenantId);
  if (last === sha) return;
  blockBLastSHAByTenant.set(tenantId, sha);
  console.log(
    `[brain-cache] block-b tenant=${tenantId} sha=${sha} tokens=${countTokens(blockBText)}`,
  );
}

/** Test affordance: reset cache-log state between runs. */
export function __resetBrainCacheLogForTests(): void {
  blockACacheLogged = false;
  blockBLastSHAByTenant.clear();
}

/**
 * BrainResult.citations is a flat array indexed [1]..[N] in Block C, with
 * a `kind` discriminator per entry so dashboards can render badges and
 * operators can audit which knowledge type the AI's answer came from
 * (Gate-1 P8c note 4). Numbering is unified across kinds because Claude's
 * `send_reply.citations_used` is a single integer array — see
 * prompts/system.ts for the per-kind rendering shape.
 */
export type BrainCitation =
  | {
      index: number;
      kind: "chunk";
      chunkId: string;
      sourceId: string;
      sourceName: string;
      sourceUrl?: string;
      preview: string;
      vectorScore: number | null;
      lexicalScore: number | null;
    }
  | {
      index: number;
      kind: "item";
      itemId: string;
      name: string;
      brand: string | null;
      sku: string | null;
      preview: string;
      vectorScore: number | null;
      lexicalScore: number | null;
    }
  | {
      index: number;
      kind: "qna";
      qnaId: string;
      question: string;
      preview: string;
      score: number;
      /**
       * Phase 8e-3: true when the match fired below the same-language
       * threshold (cross-language relaxed path). Surfaced as a small
       * indicator in the conversations dashboard so operators can spot
       * cross-language false positives during reviews.
       */
      crossLanguageMatch: boolean;
    }
  | {
      index: number;
      kind: "operational_fact";
      field: OperationalFactField;
      preview: string;
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
  const trimmedMessage = message.trim();
  const history = (input.history ?? []).slice(-HISTORY_TURNS_DEFAULT);

  // Load tenant + facts in parallel — both are independent reads keyed by
  // tenantId. We don't start retrieval here yet because we want a fast
  // tenant-not-found error before burning embedding cost.
  const [tenant, factsData] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    }),
    getOperationalFacts({ tenantId }),
  ]);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const voice = getVoiceProfile(tenant.settings as Prisma.JsonValue);
  const operationalFactsTier1 = pickTier1(factsData);

  // Embed the query ONCE and share the vector across all three retrieval
  // channels (chunks / items / qna). Saves 2 embed API calls per turn.
  const queryEmbedding = await embed({
    inputs: [trimmedMessage],
    inputType: "query",
  });
  const queryVector = queryEmbedding.vectors[0]!;

  // Pre-Claude language detection feeds Q&A languageLock filtering.
  // Claude reports its own self-detected language in send_reply.language
  // afterward — we use that as the authoritative reply-language signal.
  const detectedLanguage = detectLanguage(trimmedMessage);

  // Decide chunk top-K based on whether items are likely to be relevant.
  // Conservative: we don't know yet whether items WILL be returned, but
  // using the lower top-K when items might fire keeps the budget tight.
  // The override hits when the tenant has zero items (countItems would
  // tell us but is an extra round-trip; the cheap check is "did items
  // come back from retrieval"). Today we use the lower number whenever
  // items retrieval is on; the orchestrator could be smarter if budget
  // pressure becomes a problem.
  const itemRetrieval = retrieveItems({
    tenantId,
    query: trimmedMessage,
    queryVector,
    topK: TOP_K_ITEMS,
  });
  const qnaRetrieval = retrieveQnaMatches({
    tenantId,
    query: trimmedMessage,
    queryVector,
    detectedLanguage,
    topK: TOP_K_QNA,
  });

  // Run items + qna retrieval in parallel; chunks fires after we know
  // whether items came back (so we can pick the right top-K). This serial
  // wait is cheap because both qna and items are fast vector lookups
  // (HNSW indexed) — typically ~10–30ms.
  const [retrievedItems, retrievedQna] = await Promise.all([
    itemRetrieval,
    qnaRetrieval,
  ]);

  const chunkTopK = retrievedItems.length > 0 ? TOP_K_CHUNKS_WITH_ITEMS : TOP_K_CHUNKS_NO_ITEMS;
  const retrievedChunks: RetrievedChunk[] = await retrieveChunks({
    tenantId,
    query: trimmedMessage,
    queryVector,
    topK: chunkTopK,
  });

  // Tier-2 operational facts: keyword-gated relevance. Only the matched
  // fields land in Block C — keeps the section bounded.
  const tier2Flags = detectTier2Relevance(trimmedMessage);
  const relevantTier2 = pickRelevantTier2(factsData, tier2Flags);

  // Build the unified citation list. ORDER MATTERS: items first (so
  // Block A's "prefer structured items" rule reads naturally on the
  // numbered citations), then chunks, then qna, then operational facts.
  // The `index` field on each citation is its 1-based position in this
  // list — the same number Claude sees as `[N]` in Block C.
  const renderedCitations: RenderedCitation[] = [];
  const brainCitations: BrainCitation[] = [];

  for (const it of retrievedItems) {
    const idx = renderedCitations.length + 1;
    renderedCitations.push({
      kind: "item",
      name: it.name,
      brand: it.brand,
      sku: it.sku,
      currency: it.currency,
      priceCents: it.priceCents,
      availability: it.availability,
      specs: it.specs,
    });
    brainCitations.push({
      index: idx,
      kind: "item",
      itemId: it.itemId,
      name: it.name,
      brand: it.brand,
      sku: it.sku,
      preview: it.description?.slice(0, 240) ?? it.name,
      vectorScore: it.vectorScore,
      lexicalScore: it.lexicalScore,
    });
  }

  for (const ch of retrievedChunks) {
    const idx = renderedCitations.length + 1;
    const sourceUrl = extractUrl(ch);
    renderedCitations.push({
      kind: "chunk",
      sourceName: ch.sourceName,
      sourceUrl,
      content: ch.content,
    });
    brainCitations.push({
      index: idx,
      kind: "chunk",
      chunkId: ch.chunkId,
      sourceId: ch.sourceId,
      sourceName: ch.sourceName,
      sourceUrl,
      preview: ch.content.slice(0, 240),
      vectorScore: ch.vectorScore,
      lexicalScore: ch.lexicalScore,
    });
  }

  for (const qa of retrievedQna) {
    const idx = renderedCitations.length + 1;
    renderedCitations.push({
      kind: "qna",
      question: qa.question,
      answer: qa.answer,
    });
    brainCitations.push({
      index: idx,
      kind: "qna",
      qnaId: qa.qnaId,
      question: qa.question,
      preview: qa.answer.slice(0, 240),
      score: qa.score,
      crossLanguageMatch: qa.crossLanguageMatch,
    });
  }

  for (const [field, value] of Object.entries(relevantTier2) as Array<
    [OperationalFactField, OperationalFactsTier2[OperationalFactField]]
  >) {
    if (value === undefined) continue;
    const idx = renderedCitations.length + 1;
    renderedCitations.push({
      kind: "operational_fact",
      field,
      value,
    });
    brainCitations.push({
      index: idx,
      kind: "operational_fact",
      field,
      preview: factPreview(field, value),
    });
  }

  const { system, userMessage } = buildPrompt({
    tenantName: tenant.name,
    voice,
    operationalFactsTier1,
    citations: renderedCitations,
    history,
    message: trimmedMessage,
  });

  // Token-budget guard with the actual cl100k tokenizer (was a 4-chars
  // /token heuristic in Phase 4). Tighter signal at the cost of one
  // synchronous tokenization per call — acceptable; cl100k_base is
  // an array lookup, not a network round-trip.
  const inputTokens =
    system.reduce((n, b) => n + countTokens(b.text), 0) + countTokens(userMessage);
  if (inputTokens > MAX_INPUT_TOKEN_HEADROOM) {
    throw new Error(
      `prompt exceeds input-token budget (${inputTokens} > ${MAX_INPUT_TOKEN_HEADROOM})`,
    );
  }

  // Dev-mode instrumentation — log per-section token counts so we can
  // see real distributions vs the per-section caps without instrumenting
  // the production hot path. Compact one-liner per call.
  if (process.env.NODE_ENV !== "production") {
    const blockA = countTokens(system[0]?.text ?? "");
    const blockB = countTokens(system[1]?.text ?? "");
    const userTokens = countTokens(userMessage);
    const sectionTokens = sectionTokenCounts(renderedCitations);
    console.log(
      `[brain-budget] tenant=${tenantId} A=${blockA} B=${blockB} C=${userTokens} ` +
        `(items=${sectionTokens.items} chunks=${sectionTokens.chunks} qna=${sectionTokens.qna} facts=${sectionTokens.facts}) ` +
        `total=${inputTokens}/${MAX_INPUT_TOKEN_HEADROOM}`,
    );
  }

  // Pre-Claude top-similarity computation (also used for fallback paths).
  const topChunkScore = retrievedChunks[0]?.vectorScore ?? 0;
  const topItemScore = retrievedItems[0]?.vectorScore ?? 0;
  const topQnaScore = retrievedQna[0]?.score ?? 0;
  const topChunkSimilarity = Math.max(topChunkScore, topItemScore, topQnaScore);

  // Per-conversation retry budget enforcement (Gate-1 K5). When the
  // cumulative retry counter would exceed the cap, fail fast — don't
  // even attempt the API call. Counter resets when a turn succeeds with
  // retriesUsed === 0. Smart-import / one-shot calls (no conversationId)
  // skip the budget entirely.
  const convId = input.conversationId;
  if (convId) {
    const used = conversationRetryBudget.get(convId) ?? 0;
    if (used >= CONVERSATION_RETRY_CAP) {
      const err = new AnthropicConversationBudgetExhaustedError(
        used,
        CONVERSATION_RETRY_CAP,
      );
      logBrainError({
        tenantId,
        conversationId: convId,
        err,
      });
      throw err;
    }
  }

  // [brain-cache] cache-invalidation observability (P4r-3 Gate-1 B).
  // Logged once per process for Block A and once per tenant for Block B
  // (re-logged when SHA changes — that's the invalidation signal).
  maybeLogBlockACache();
  maybeLogBlockBCache(tenantId, system[1]?.text ?? "");

  const client = getClaudeClient();
  let claudeResult;
  try {
    claudeResult = await client.sendReply({
      system,
      userMessage,
      maxTokens: MAX_REPLY_TOKENS,
    });
  } catch (err) {
    // Bookkeeping: even on failure, the retries the client used count
    // against the conversation's budget.
    if (convId && err instanceof AnthropicError) {
      const prior = conversationRetryBudget.get(convId) ?? 0;
      conversationRetryBudget.set(convId, prior + (err.retriesUsed ?? 0));
    }

    // Tool-use refusal: synthesize a deterministic fallback BrainResult
    // (Gate-1 E + 'other decisions') so the conversation continues
    // gracefully and the gap-logger picks up the OUTSIDE_SCOPE.
    if (err instanceof AnthropicToolRefusalError) {
      logBrainRefusal({
        tenantId,
        conversationId: convId,
        err,
        customerMessage: trimmedMessage,
      });
      return {
        reply: getToolRefusalFallback(detectedLanguage),
        language: detectedLanguage,
        citations: brainCitations,
        citationsUsed: [],
        groundedness: 0,
        confidence: 0,
        escalation: "OUTSIDE_SCOPE",
        aiMetadata: {
          modelId: "anthropic:tool-refusal",
          claudeRecommendedEscalation: true,
          claudeReason: "TOOL_REFUSAL",
          topChunkSimilarity,
          usage: null,
        },
      };
    }

    // P4r-3 schema-split: reply text arrived, metadata tool didn't.
    // The reply is usable; we synthesize defaults for the metadata
    // we don't have, force LOW_CONFIDENCE escalation, and tag
    // claudeReason = MISSING_METADATA so the divergence is visible
    // in analytics.
    if (err instanceof AnthropicMissingMetadataError) {
      logBrainError({
        tenantId,
        conversationId: convId,
        err,
      });
      // [brain-cost] still fires — the call did happen, tokens were
      // consumed. Log with the usage from the partial response.
      if (err.usage) {
        logBrainCost({
          tenantId,
          modelId: err.modelId,
          usage: err.usage,
          retriesUsed: err.retriesUsed,
        });
      }
      return {
        reply: err.replyText,
        language: detectedLanguage,
        citations: brainCitations,
        citationsUsed: [],
        groundedness: 0,
        confidence: 0,
        escalation: "LOW_CONFIDENCE",
        aiMetadata: {
          modelId: err.modelId,
          claudeRecommendedEscalation: true,
          claudeReason: "MISSING_METADATA",
          topChunkSimilarity,
          usage: err.usage,
        },
      };
    }

    // All other Anthropic errors: log structured then bubble up. The route
    // handler's stream closes without `done` and the widget renders the
    // existing connection-lost banner (Gate-1 K8).
    if (err instanceof AnthropicError) {
      logBrainError({
        tenantId,
        conversationId: convId,
        err,
      });
    }
    throw err;
  }

  // Bookkeeping: update the conversation retry budget. retriesUsed === 0
  // resets the counter; > 0 accumulates.
  if (convId) {
    if (claudeResult.retriesUsed === 0) conversationRetryBudget.set(convId, 0);
    else {
      const prior = conversationRetryBudget.get(convId) ?? 0;
      conversationRetryBudget.set(convId, prior + claudeResult.retriesUsed);
    }
  }

  const tool: SendReplyToolArgs = claudeResult.toolArgs;

  // [brain-cost] log on the happy path. Stub returns null and is skipped.
  if (claudeResult.usage) {
    logBrainCost({
      tenantId,
      modelId: claudeResult.modelId,
      usage: claudeResult.usage,
      retriesUsed: claudeResult.retriesUsed,
    });
  }

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

  return {
    reply: claudeResult.reply,
    language: tool.language,
    citations: brainCitations,
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

/**
 * [brain-cost] structured one-liner. Extracted so both the happy path
 * and the MISSING_METADATA fallback path can share the formatting.
 */
function logBrainCost(args: {
  tenantId: string;
  modelId: string;
  usage: NonNullable<SendReplyResult["usage"]>;
  retriesUsed: number;
}): void {
  const { tenantId, modelId, usage, retriesUsed } = args;
  let costUsd = 0;
  try {
    costUsd = computeCostUsd(modelId, usage);
  } catch {
    // Unknown model in the pricing table — log zero rather than crash.
    costUsd = 0;
  }
  console.log(
    `[brain-cost] tenant=${tenantId} model=${modelId} ` +
      `input=${usage.inputTokens} output=${usage.outputTokens} ` +
      `cache_create=${usage.cacheCreationInputTokens ?? 0} ` +
      `cache_read=${usage.cacheReadInputTokens ?? 0} ` +
      `retries=${retriesUsed} cost=${formatUsd(costUsd)}`,
  );
}

/**
 * Structured one-liner for Anthropic-side failures (Gate-1 K8). Lets ops
 * grep `[brain-error]` for outage windows without parsing stack traces.
 * Outages and content/safety refusals have different remediation paths,
 * so refusals get their own [brain-refusal] line (logBrainRefusal).
 */
function logBrainError(args: {
  tenantId: string;
  conversationId?: string;
  err: AnthropicError;
}): void {
  const { tenantId, conversationId, err } = args;
  const status = err.status ?? "n/a";
  const retries = err.retriesUsed;
  console.log(
    `[brain-error] tenant=${tenantId} conversation=${conversationId ?? "n/a"} ` +
      `type=${err.name} status=${status} retries=${retries} message=${JSON.stringify(err.message)}`,
  );
}

/**
 * P4r-3 split from [brain-error]: tool-refusal events (Claude returned
 * end_turn without a tool_use block). These are content/safety signals,
 * not infrastructure outages — different remediation paths, so they get
 * their own log channel. Includes the customer message truncated to 200
 * chars so operators can investigate refusal patterns without digging
 * through full transcripts.
 */
const REFUSAL_MESSAGE_TRUNCATE_CHARS = 200;

function logBrainRefusal(args: {
  tenantId: string;
  conversationId?: string;
  err: AnthropicError;
  customerMessage: string;
}): void {
  const { tenantId, conversationId, err, customerMessage } = args;
  const truncated =
    customerMessage.length > REFUSAL_MESSAGE_TRUNCATE_CHARS
      ? customerMessage.slice(0, REFUSAL_MESSAGE_TRUNCATE_CHARS) + "…"
      : customerMessage;
  console.log(
    `[brain-refusal] tenant=${tenantId} conversation=${conversationId ?? "n/a"} ` +
      `type=${err.name} retries=${err.retriesUsed} ` +
      `customer_message=${JSON.stringify(truncated)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-section token totals for dev-mode logging. Re-tokenizes just the
 * citation segments — cheap (cl100k is an array lookup) and avoids
 * threading per-section token counts through the prompt builders.
 */
function sectionTokenCounts(citations: RenderedCitation[]): {
  items: number;
  chunks: number;
  qna: number;
  facts: number;
} {
  const totals = { items: 0, chunks: 0, qna: 0, facts: 0 };
  for (const c of citations) {
    // Cheap proxy: tokenize the JSON shape — close enough for distribution
    // logging. Production telemetry can refine if needed.
    const tokens = countTokens(JSON.stringify(c));
    if (c.kind === "item") totals.items += tokens;
    else if (c.kind === "chunk") totals.chunks += tokens;
    else if (c.kind === "qna") totals.qna += tokens;
    else if (c.kind === "operational_fact") totals.facts += tokens;
  }
  return totals;
}

/**
 * Short preview string for an operational-fact citation — surfaced in
 * BrainResult.citations[].preview so the dashboard can show "Hours: Mon-Fri
 * 9-17" without the renderer-level rendering. Per-field summary, capped.
 */
function factPreview(
  field: OperationalFactField,
  value: OperationalFactsTier2[OperationalFactField],
): string {
  if (value === undefined) return "";
  switch (field) {
    case "hours": {
      const h = value as OperationalFactsTier2["hours"];
      if (!h) return "";
      const days = h.weekly.length;
      return `${days} day${days === 1 ? "" : "s"} configured (${h.tz})`;
    }
    case "locations": {
      const arr = value as OperationalFactsTier2["locations"];
      if (!arr || arr.length === 0) return "(none)";
      return arr.map((l) => l.label).slice(0, 3).join(", ");
    }
    case "exceptions": {
      const arr = value as OperationalFactsTier2["exceptions"];
      if (!arr || arr.length === 0) return "(none)";
      return `${arr.length} exception${arr.length === 1 ? "" : "s"}`;
    }
    case "currency":
      return String(value);
    case "serviceArea":
      return String(value).slice(0, 100);
  }
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
 * Current implementation: runBrain runs to completion (one round-trip),
 * then the reply is sliced into ~8-codepoint chunks emitted ~35ms apart.
 * This matches widget/src/api.ts's mockBrainStream cadence so the demo
 * feels paced.
 *
 * Codepoints, not bytes — `[...text]` yields proper Unicode codepoints
 * so multi-byte sequences (Arabic, Darija Arabic-script, emoji) never
 * get split mid-character. Slicing the resulting array and `.join("")`-
 * ing back is safe.
 *
 * Post-credits (CLAUDE.md §7a resumption checklist step 3): the
 * RealClaudeClient's streamReply will replace the runBrain-then-chunk
 * pattern with native Anthropic SSE streaming at upstream speed. The
 * route handler is unchanged — same yield shape, same delta/done
 * contract — only the body of this function swaps.
 */
const STREAM_CHUNK_CODEPOINTS = 8;
const STREAM_INTER_CHUNK_DELAY_MS = 35;

export async function* runBrainStream(
  input: BrainInput,
): AsyncGenerator<BrainStreamEvent> {
  const result = await runBrain(input);
  const codepoints = [...result.reply];
  for (let i = 0; i < codepoints.length; i += STREAM_CHUNK_CODEPOINTS) {
    const chunk = codepoints
      .slice(i, i + STREAM_CHUNK_CODEPOINTS)
      .join("");
    yield { type: "delta", text: chunk };
    if (i + STREAM_CHUNK_CODEPOINTS < codepoints.length) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, STREAM_INTER_CHUNK_DELAY_MS),
      );
    }
  }
  yield { type: "done", result };
}
