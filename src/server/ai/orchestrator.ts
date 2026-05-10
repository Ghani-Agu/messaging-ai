import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getAiBehaviorForTenant, getVoiceProfile } from "@/lib/validators";
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
import { listContactsForBrain } from "@/server/db/contacts";
import { embed } from "@/server/ai/embeddings";
import { detectLanguage } from "@/lib/language-detect";
import {
  BLOCK_A_TEXT,
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
  type SendReplyArgs,
  type SendReplyResult,
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

/**
 * AI brain orchestrator.
 *
 * Public surface:
 *   runBrain({ tenantId, message, history }) → BrainResult
 *   runBrainStream({ tenantId, message, history, signal })
 *       → AsyncGenerator<{type:"delta",text} | {type:"done",result}>
 *
 * Pipeline (shared by both):
 *   1. Load tenant + voice profile + operational facts (parallel).
 *   2. Embed query, run retrieval (chunks / items / qna).
 *   3. Build system blocks A/B + Block C user turn.
 *   4. Token-budget guard.
 *   5. Conversation retry-budget pre-check.
 *   6. [brain-cache] log on first call per process / per tenant.
 *   7. Call Claude:
 *       - runBrain        → client.sendReply() (non-streaming).
 *       - runBrainStream  → client.streamReply() if available, else
 *                           sendReply() + chunk-after-the-fact.
 *   8. Compute deterministic confidence, decide escalation.
 *   9. Build BrainResult; emit cost log.
 *
 * Error handling:
 *   - AnthropicToolRefusalError → fallback BrainResult with TOOL_REFUSAL +
 *     per-language fallback reply; conversation continues.
 *   - AnthropicMissingMetadataError (defensive, rare) → reply text from the
 *     partial response, escalation = LOW_CONFIDENCE, claudeReason =
 *     MISSING_METADATA.
 *   - All other AnthropicError → bubble up; widget route closes the stream
 *     without `done` and shows the connection-lost banner.
 */

// Performance budgets (Phase-4 Gate-1 §6, bumped in Phase-8b/c Gate-1).
const MAX_REPLY_TOKENS = 600;
// Phase 8b bumped 6000 → 8000 for tier-1 ops facts in Block B; Phase 8c
// keeps 8000 with explicit per-section caps in Block C (items / qna /
// facts each have their own ceiling enforced via top-K + content trim).
const MAX_INPUT_TOKEN_HEADROOM = 8000;

// Per-channel retrieval top-K. Chunks scale down to 5 when items are
// present (per Gate-1 P8c risk discussion) so the combined Block C stays
// within the A+B+C target asserted in prompts/system.test.ts.
//
// TOP_K_ITEMS bumped 5 → 8: WBP's catalog of 1740+ synced items has
// sparse embed text per row (name + brand + category only when those
// fields are populated upstream), so the right item often ranks 6-8
// on brand-style queries ("3andkom Ajax?", "Dahua disponibles?"). A
// K of 5 was too narrow; 8 trades ~250 tokens of Block C headroom
// for materially better hit rate on the production catalog. Hard
// runtime input budget (MAX_INPUT_TOKEN_HEADROOM=8000) stays clear.
const TOP_K_CHUNKS_NO_ITEMS = 8;
const TOP_K_CHUNKS_WITH_ITEMS = 5;
const TOP_K_ITEMS = 8;
const TOP_K_QNA = 1; // top-1 above threshold; multi-Q&A blending is post-v1
const HISTORY_TURNS_DEFAULT = 8;

// Synthetic streaming pacing (P4r-4). Same constants RealClaudeClient.streamReply
// uses internally — kept here for the stub-fallback path where the orchestrator
// chunks-after-the-fact. Codepoints (not bytes) so multi-byte sequences
// (Arabic, Darija Arabic-script) never get split mid-character.
const STREAM_CHUNK_CODEPOINTS = 8;
const STREAM_INTER_CHUNK_DELAY_MS = 35;

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
  /**
   * P4r-4: abort signal for streaming. The widget route hooks this into
   * its ReadableStream cancel callback so closing the customer connection
   * cancels the upstream Anthropic call. Only consumed by runBrainStream
   * → client.streamReply; runBrain ignores it.
   */
  signal?: AbortSignal;
};

/**
 * Per-conversation cumulative retry tracker (Gate-1 K5). Module-scoped
 * Map; survives across runBrain calls but not across process restarts.
 * Trade-off accepted: a process restart resets the budget for in-flight
 * conversations. For v1 this is fine — the budget exists to short-circuit
 * runaway retry storms within a session, not to enforce a hard SLA.
 */
const conversationRetryBudget = new Map<string, number>();

/** Test affordance: clear the conversation retry tracker between runs. */
export function __resetConversationRetryBudgetForTests(): void {
  conversationRetryBudget.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// [brain-cache] cache-invalidation logging (P4r-3 Gate-1 B)
//
// `block-a sha` logs the SHA of the STATIC portion of Block A (the platform
// rules text). Per-tenant variation introduced by the AI BEHAVIOR RULES
// section is not captured here — it rides the per-tenant Block-B cache
// envelope at the Anthropic-API level, but our diagnostic log keeps Block A
// as a single deploy-time platform-rules sentinel. The tradeoff was a
// deliberate choice: per-tenant Block-A drift logs would fire on every
// toggle flip, which is operator-driven config, not a deploy-time signal
// worth alerting on.
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

// ─────────────────────────────────────────────────────────────────────────────
// BrainResult / BrainCitation types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BrainResult.citations is a flat array indexed [1]..[N] in Block C, with
 * a `kind` discriminator per entry so dashboards can render badges and
 * operators can audit which knowledge type the AI's answer came from
 * (Gate-1 P8c note 4).
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
      crossLanguageMatch: boolean;
    }
  | {
      index: number;
      kind: "operational_fact";
      field: OperationalFactField;
      preview: string;
    }
  | {
      index: number;
      kind: "contact";
      contactId: string;
      name: string;
      preview: string;
    };

export type BrainResult = {
  reply: string;
  language: SupportedReplyLanguage;
  citations: BrainCitation[];
  citationsUsed: number[];
  groundedness: number;
  confidence: number;
  escalation: EscalationReason | null;
  aiMetadata: {
    modelId: string;
    claudeRecommendedEscalation: boolean;
    claudeReason: EscalationReason | null;
    topChunkSimilarity: number;
    usage: SendReplyResult["usage"];
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal shared state passed between prep → call → finalize
// ─────────────────────────────────────────────────────────────────────────────

type CallContext = {
  tenantId: string;
  conversationId: string | undefined;
  trimmedMessage: string;
  detectedLanguage: SupportedReplyLanguage;
  brainCitations: BrainCitation[];
  topChunkSimilarity: number;
  args: SendReplyArgs;
  /**
   * Sum of tokens in system blocks A + B — i.e., the cacheable prefix.
   * Used by the [brain-cache-warn] log line: when a model is sent a
   * cache_control marker on a prefix above Anthropic's 1024-token
   * minimum but the response shows cache_create=0 AND cache_read=0,
   * caching was silently ignored (model-specific upstream constraint).
   * Surfacing this in production logs makes the kind of finding we
   * had with Sonnet 4.6 detectable rather than discovered by accident.
   */
  cacheableTokens: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Non-streaming variant. Always returns a shaped result; throws only for
 * exceptional conditions (tenant not found, retrieval crash, hard
 * AnthropicError).
 */
export async function runBrain(input: BrainInput): Promise<BrainResult> {
  const ctx = await prepareCallContext(input);
  checkConversationBudget(ctx);

  const client = getClaudeClient();
  let claudeResult: SendReplyResult;
  try {
    claudeResult = await client.sendReply(ctx.args);
  } catch (err) {
    return handleClaudeError(ctx, err);
  }
  return finalizeBrainResult(ctx, claudeResult);
}

export type BrainStreamDelta = { type: "delta"; text: string };
export type BrainStreamDone = { type: "done"; result: BrainResult };
export type BrainStreamEvent = BrainStreamDelta | BrainStreamDone;

/**
 * Streaming variant. AsyncGenerator yielding zero or more `delta` events
 * followed by exactly one `done` event with the complete BrainResult.
 *
 * Two paths:
 *   - Real client (RealClaudeClient.streamReply available): forwards the
 *     SDK stream's delta events; the upstream HTTP connection stays open
 *     and can be cancelled via input.signal.
 *   - Stub fallback: calls sendReply, then synthesizes chunked deltas
 *     after-the-fact at the same cadence the real client uses internally
 *     (matched UX so the stub-mode dashboard demo feels paced).
 *
 * P4r-4 design note: the real client's streamReply ALSO chunks-after-
 * the-fact internally because Sonnet 4.6's forced tool_use is exclusive
 * — there's no genuine per-token streaming to forward. The streaming
 * path's value is abort propagation (closing the customer connection
 * cancels the upstream call) and infrastructure-readiness for any future
 * model where real per-token streaming becomes possible.
 */
export async function* runBrainStream(
  input: BrainInput,
): AsyncGenerator<BrainStreamEvent> {
  const ctx = await prepareCallContext(input);
  checkConversationBudget(ctx);

  const client = getClaudeClient();

  if (client.streamReply) {
    let claudeResult: SendReplyResult | null = null;
    try {
      for await (const event of client.streamReply(ctx.args, {
        signal: input.signal,
      })) {
        if (event.type === "delta") {
          yield { type: "delta", text: event.text };
        } else {
          claudeResult = event.result;
        }
      }
    } catch (err) {
      // Soft-failure paths (TOOL_REFUSAL / MISSING_METADATA) → synthesize
      // fallback BrainResult, chunk its reply text, yield done.
      const fallback = handleClaudeError(ctx, err); // throws on hard error
      yield* chunkReplyAsDeltas(fallback.reply);
      yield { type: "done", result: fallback };
      return;
    }
    if (!claudeResult) {
      throw new Error(
        "runBrainStream: client.streamReply ended without a done event",
      );
    }
    const result = finalizeBrainResult(ctx, claudeResult);
    yield { type: "done", result };
    return;
  }

  // Stub fallback: sendReply, then chunk-after-the-fact. The chunking
  // matches the real client's internal pacing.
  let result: BrainResult;
  try {
    const claudeResult = await client.sendReply(ctx.args);
    result = finalizeBrainResult(ctx, claudeResult);
  } catch (err) {
    result = handleClaudeError(ctx, err); // throws on hard error
  }
  yield* chunkReplyAsDeltas(result.reply);
  yield { type: "done", result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prep — everything before the Claude call (shared by runBrain + runBrainStream)
// ─────────────────────────────────────────────────────────────────────────────

async function prepareCallContext(input: BrainInput): Promise<CallContext> {
  const { tenantId, message } = input;
  const trimmedMessage = message.trim();
  const history = (input.history ?? []).slice(-HISTORY_TURNS_DEFAULT);

  // Load tenant + facts + contacts in parallel — three independent reads
  // keyed by tenantId. We don't start retrieval here yet because we want a
  // fast tenant-not-found error before burning embedding cost. Contacts ride
  // every turn (cap 6 per src/lib/contacts.ts) so the brain has the
  // operator-curated escalation list ready whenever it decides to hand off.
  const [tenant, factsData, contacts] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    }),
    getOperationalFacts({ tenantId }),
    listContactsForBrain(tenantId),
  ]);
  if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
  const voice = getVoiceProfile(tenant.settings as Prisma.JsonValue);
  const aiBehavior = getAiBehaviorForTenant(tenant.settings as Prisma.JsonValue);
  const operationalFactsTier1 = pickTier1(factsData);

  // Embed the query ONCE and share the vector across all three retrieval
  // channels (chunks / items / qna). Saves 2 embed API calls per turn.
  const queryEmbedding = await embed({
    inputs: [trimmedMessage],
    inputType: "query",
  });
  const queryVector = queryEmbedding.vectors[0]!;

  const detectedLanguage = detectLanguage(trimmedMessage);

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

  const [itemResult, retrievedQna] = await Promise.all([
    itemRetrieval,
    qnaRetrieval,
  ]);
  const retrievedItems = itemResult.items;
  const brandSummaries = itemResult.brandSummaries;

  const chunkTopK =
    retrievedItems.length > 0 ? TOP_K_CHUNKS_WITH_ITEMS : TOP_K_CHUNKS_NO_ITEMS;
  const retrievedChunks: RetrievedChunk[] = await retrieveChunks({
    tenantId,
    query: trimmedMessage,
    queryVector,
    topK: chunkTopK,
  });

  const tier2Flags = detectTier2Relevance(trimmedMessage);
  const relevantTier2 = pickRelevantTier2(factsData, tier2Flags);

  // Build the unified citation list. ORDER MATTERS: items first (so
  // Block A's "prefer structured items" rule reads naturally on the
  // numbered citations), then chunks, then qna, then operational facts.
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

  // Contacts ride every turn (cap MAX_CONTACTS_IN_PROMPT, applied by
  // listContactsForBrain). Always at the tail of the citation list so the
  // numbered prefix doesn't shift when other citations vary. Block A's
  // CONTACT INFO instruction tells the model to use them only on escalation
  // turns, not on every reply.
  for (const c of contacts) {
    const idx = renderedCitations.length + 1;
    renderedCitations.push({
      kind: "contact",
      name: c.name,
      role: c.role,
      phone: c.phone,
      email: c.email,
    });
    brainCitations.push({
      index: idx,
      kind: "contact",
      contactId: c.id,
      name: c.name,
      preview: [c.role, c.phone, c.email].filter(Boolean).join(" · "),
    });
  }

  const { system, userMessage } = buildPrompt({
    tenantName: tenant.name,
    voice,
    operationalFactsTier1,
    citations: renderedCitations,
    history,
    message: trimmedMessage,
    brandSummaries,
    aiBehavior,
  });

  // Token-budget guard with the actual cl100k tokenizer.
  const inputTokens =
    system.reduce((n, b) => n + countTokens(b.text), 0) +
    countTokens(userMessage);
  if (inputTokens > MAX_INPUT_TOKEN_HEADROOM) {
    throw new Error(
      `prompt exceeds input-token budget (${inputTokens} > ${MAX_INPUT_TOKEN_HEADROOM})`,
    );
  }

  if (process.env.NODE_ENV !== "production") {
    const blockA = countTokens(system[0]?.text ?? "");
    const blockB = countTokens(system[1]?.text ?? "");
    const userTokens = countTokens(userMessage);
    const sectionTokens = sectionTokenCounts(renderedCitations);
    console.log(
      `[brain-budget] tenant=${tenantId} A=${blockA} B=${blockB} C=${userTokens} ` +
        `(items=${sectionTokens.items} chunks=${sectionTokens.chunks} qna=${sectionTokens.qna} facts=${sectionTokens.facts} contacts=${sectionTokens.contacts}) ` +
        `total=${inputTokens}/${MAX_INPUT_TOKEN_HEADROOM}`,
    );
  }

  // [brain-cache] log on first call per process / tenant.
  maybeLogBlockACache();
  maybeLogBlockBCache(tenantId, system[1]?.text ?? "");

  // Top retrieval-truth signal: prefer the strongest of chunk / item /
  // qna similarity. The confidence formula treats this as "how grounded
  // was retrieval".
  const topChunkScore = retrievedChunks[0]?.vectorScore ?? 0;
  const topItemScore = retrievedItems[0]?.vectorScore ?? 0;
  const topQnaScore = retrievedQna[0]?.score ?? 0;
  const topChunkSimilarity = Math.max(topChunkScore, topItemScore, topQnaScore);

  return {
    tenantId,
    conversationId: input.conversationId,
    trimmedMessage,
    detectedLanguage,
    brainCitations,
    topChunkSimilarity,
    args: { system, userMessage, maxTokens: MAX_REPLY_TOKENS },
    cacheableTokens: system.reduce((n, b) => n + countTokens(b.text), 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation retry budget (Gate-1 K5)
// ─────────────────────────────────────────────────────────────────────────────

function checkConversationBudget(ctx: CallContext): void {
  if (!ctx.conversationId) return;
  const used = conversationRetryBudget.get(ctx.conversationId) ?? 0;
  if (used >= CONVERSATION_RETRY_CAP) {
    const err = new AnthropicConversationBudgetExhaustedError(
      used,
      CONVERSATION_RETRY_CAP,
    );
    logBrainError({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      err,
    });
    throw err;
  }
}

function updateConversationBudgetOnError(
  conversationId: string | undefined,
  err: AnthropicError,
): void {
  if (!conversationId) return;
  const prior = conversationRetryBudget.get(conversationId) ?? 0;
  conversationRetryBudget.set(conversationId, prior + (err.retriesUsed ?? 0));
}

function updateConversationBudgetOnSuccess(
  conversationId: string | undefined,
  retriesUsed: number,
): void {
  if (!conversationId) return;
  if (retriesUsed === 0) {
    conversationRetryBudget.set(conversationId, 0);
    return;
  }
  const prior = conversationRetryBudget.get(conversationId) ?? 0;
  conversationRetryBudget.set(conversationId, prior + retriesUsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error handling — turns Anthropic errors into BrainResult fallbacks or rethrow
// ─────────────────────────────────────────────────────────────────────────────

function handleClaudeError(ctx: CallContext, err: unknown): BrainResult {
  if (err instanceof AnthropicError) {
    updateConversationBudgetOnError(ctx.conversationId, err);
  }

  if (err instanceof AnthropicToolRefusalError) {
    logBrainRefusal({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      err,
      customerMessage: ctx.trimmedMessage,
    });
    return {
      reply: getToolRefusalFallback(ctx.detectedLanguage),
      language: ctx.detectedLanguage,
      citations: ctx.brainCitations,
      citationsUsed: [],
      groundedness: 0,
      confidence: 0,
      escalation: "OUTSIDE_SCOPE",
      aiMetadata: {
        modelId: "anthropic:tool-refusal",
        claudeRecommendedEscalation: true,
        claudeReason: "TOOL_REFUSAL",
        topChunkSimilarity: ctx.topChunkSimilarity,
        usage: null,
      },
    };
  }

  if (err instanceof AnthropicMissingMetadataError) {
    logBrainError({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      err,
    });
    if (err.usage) {
      logBrainCost({
        tenantId: ctx.tenantId,
        modelId: err.modelId,
        usage: err.usage,
        retriesUsed: err.retriesUsed,
      });
    }
    return {
      reply: err.replyText,
      language: ctx.detectedLanguage,
      citations: ctx.brainCitations,
      citationsUsed: [],
      groundedness: 0,
      confidence: 0,
      escalation: "LOW_CONFIDENCE",
      aiMetadata: {
        modelId: err.modelId,
        claudeRecommendedEscalation: true,
        claudeReason: "MISSING_METADATA",
        topChunkSimilarity: ctx.topChunkSimilarity,
        usage: err.usage,
      },
    };
  }

  if (err instanceof AnthropicError) {
    logBrainError({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      err,
    });
  }
  throw err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finalize — builds BrainResult from successful claudeResult + ctx
// ─────────────────────────────────────────────────────────────────────────────

function finalizeBrainResult(
  ctx: CallContext,
  claudeResult: SendReplyResult,
): BrainResult {
  updateConversationBudgetOnSuccess(ctx.conversationId, claudeResult.retriesUsed);

  if (claudeResult.usage) {
    logBrainCost({
      tenantId: ctx.tenantId,
      modelId: claudeResult.modelId,
      usage: claudeResult.usage,
      retriesUsed: claudeResult.retriesUsed,
    });
    maybeLogCacheWarn({
      tenantId: ctx.tenantId,
      modelId: claudeResult.modelId,
      usage: claudeResult.usage,
      cacheableTokens: ctx.cacheableTokens,
    });
  }

  const tool = claudeResult.toolArgs;
  const confidence = computeConfidence({
    groundedness: tool.groundedness,
    topChunkSimilarity: ctx.topChunkSimilarity,
    citationsUsedCount: tool.citations_used.length,
    escalationRecommended: tool.escalation_recommended,
  });
  const escalation = decideEscalation({
    confidence,
    claudeRecommended: tool.escalation_recommended,
    claudeReason: tool.escalation_reason ?? null,
  });

  return {
    reply: tool.reply,
    language: tool.language,
    citations: ctx.brainCitations,
    citationsUsed: tool.citations_used,
    groundedness: tool.groundedness,
    confidence,
    escalation,
    aiMetadata: {
      modelId: claudeResult.modelId,
      claudeRecommendedEscalation: tool.escalation_recommended,
      claudeReason: tool.escalation_reason ?? null,
      topChunkSimilarity: ctx.topChunkSimilarity,
      usage: claudeResult.usage,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic delta chunking (stub-fallback path + soft-failure replies)
// ─────────────────────────────────────────────────────────────────────────────

async function* chunkReplyAsDeltas(
  reply: string,
): AsyncGenerator<BrainStreamDelta> {
  const codepoints = [...reply];
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic's per-segment cache minimum for Sonnet (and Opus). Below
 * this size, cache_control markers are silently ignored. We use this
 * threshold for the [brain-cache-warn] check.
 */
const ANTHROPIC_CACHE_MINIMUM_TOKENS = 1024;

/**
 * Detects "we asked for caching but got nothing" and emits a structured
 * warn line. The P4r-5 cache-effectiveness probe found Sonnet 4.6
 * silently ignores cache_control even on prefixes well above 1024
 * tokens (model-specific upstream constraint). Surfacing this in
 * production logs makes future similar findings detectable in the
 * field rather than via probe runs.
 */
function maybeLogCacheWarn(args: {
  tenantId: string;
  modelId: string;
  usage: NonNullable<SendReplyResult["usage"]>;
  cacheableTokens: number;
}): void {
  const { tenantId, modelId, usage, cacheableTokens } = args;
  if (cacheableTokens < ANTHROPIC_CACHE_MINIMUM_TOKENS) return;
  const totalCacheTokens =
    (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0);
  if (totalCacheTokens > 0) return;
  console.log(
    `[brain-cache-warn] tenant=${tenantId} model=${modelId} ` +
      `cacheable_tokens=${cacheableTokens} ` +
      `cache_create=0 cache_read=0 ` +
      `(caching SHOULD have fired but did not — model may not support caching)`,
  );
}

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
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

function sectionTokenCounts(citations: RenderedCitation[]): {
  items: number;
  chunks: number;
  qna: number;
  facts: number;
  contacts: number;
} {
  const totals = { items: 0, chunks: 0, qna: 0, facts: 0, contacts: 0 };
  for (const c of citations) {
    const tokens = countTokens(JSON.stringify(c));
    if (c.kind === "item") totals.items += tokens;
    else if (c.kind === "chunk") totals.chunks += tokens;
    else if (c.kind === "qna") totals.qna += tokens;
    else if (c.kind === "operational_fact") totals.facts += tokens;
    else if (c.kind === "contact") totals.contacts += tokens;
  }
  return totals;
}

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
