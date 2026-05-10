/**
 * brain-eval (P4r-6) — model-aware regression harness for the AI brain.
 *
 * Runs an 11-row representative query bank end-to-end through `runBrain`
 * and produces a per-row report with retrieval, tool result, cost,
 * franc-based language validation, and PASS/FAIL shape checks. The same
 * bank runs against any model (--model flag) so we can A/B Sonnet 4.6
 * vs Sonnet 4.5 empirically before committing to a model pin.
 *
 * Usage:
 *   npm run brain:eval                                 # default (current pin: Sonnet 4.6)
 *   npm run brain:eval -- --model claude-sonnet-4-5-20250929
 *   npm run brain:eval -- --markdown                   # also write markdown
 *   npm run brain:eval -- --no-prompt                  # skip cost-confirm
 *   npm run brain:eval -- --no-baseline-diff           # skip baseline compare
 *
 * Output:
 *   eval/reports/{ts}-{model}.json   structured per-row results
 *   eval/reports/{ts}-{model}.md     (when --markdown is set)
 *   stdout: live progress per row + summary
 *
 * Cost: ~$0.05–0.10/run (13 rows × ~$0.005-0.010 each at Sonnet rates).
 * Cost-confirmation prompt fires at script start unless --no-prompt.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { franc } from "franc-min";
import { prisma } from "@/server/db/client";
import { setOperationalFacts } from "@/server/db/operational-facts";
import { attachItemEmbedding } from "@/server/db/items";
import { attachQnaEmbedding } from "@/server/db/qna";
import { embed } from "@/server/ai/embeddings";
import { runBrain, type BrainResult } from "@/server/ai/orchestrator";
import { computeCostUsd } from "@/server/ai/pricing";
import type { VoiceProfile } from "@/lib/validators";
import type { SupportedReplyLanguage } from "@/server/ai/claude-client";

const TENANT_SLUG = "acme";
const REPORTS_DIR = join(process.cwd(), "eval", "reports");
const COST_PER_ROW_ESTIMATE_USD = 0.008;

// ─────────────────────────────────────────────────────────────────────────────
// Query bank — 11 rows
// ─────────────────────────────────────────────────────────────────────────────

type EvalQuery = {
  id: string;
  description: string;
  message: string;
  expectedLanguage: SupportedReplyLanguage;
  /** Free-form note about what we expect to see; not auto-asserted. */
  expectedBehavior: string;
};

const QUERY_BANK: EvalQuery[] = [
  {
    id: "ar-msa-hours",
    description: "Modern Standard Arabic — operating hours",
    message: "السلام عليكم، ما هي ساعات عمل المتجر لديكم؟",
    expectedLanguage: "ar",
    expectedBehavior: "Reply in Arabic script (MSA), should hit hours operational fact.",
  },
  {
    id: "fr-hours",
    description: "French — operating hours (vouvoiement)",
    message: "Bonjour, quels sont vos horaires d'ouverture ?",
    expectedLanguage: "fr",
    expectedBehavior: "Reply in French, vous form, hits hours operational fact.",
  },
  {
    id: "en-hours",
    description: "English — operating hours",
    message: "Hi! What are your opening hours?",
    expectedLanguage: "en",
    expectedBehavior: "Reply in English, hits hours operational fact.",
  },
  {
    id: "darija-arabizi-hours",
    description: "Darija Arabizi (Latin + numerals)",
    message: "Salam, wach 3andkom des horaires d'ouverture ?",
    expectedLanguage: "darija",
    expectedBehavior:
      "Reply in Arabizi (Latin + 3/7/9 numerals), Algerian Darija vocab. NOT MSA.",
  },
  {
    id: "darija-arabic-script-hours",
    description: "Darija Arabic-script with dialect markers",
    message: "السلام، واش راكم خدامين فالعطلة ؟",
    expectedLanguage: "darija",
    expectedBehavior:
      "Reply in Arabic script with Darija vocabulary (واش, راكم, دير...) — not MSA.",
  },
  {
    id: "fr-darija-codeswitch",
    description: "French + Darija code-switch",
    message: "Salam, je voudrais 3aref si vous livrez fi week-end ?",
    expectedLanguage: "darija",
    expectedBehavior:
      "Customer code-switches FR↔Darija; reply should mirror that register.",
  },
  {
    id: "off-topic",
    description: "Off-topic — weather small talk",
    message: "What's the weather like in Algiers today?",
    expectedLanguage: "en",
    expectedBehavior:
      "Outside the business scope — should escalate OUTSIDE_SCOPE, offer human handoff.",
  },
  {
    id: "refund-anger",
    description: "Refund demand with anger (FR)",
    message:
      "Je veux un remboursement immédiat, c'est inacceptable ! Je vais contacter mon avocat.",
    expectedLanguage: "fr",
    expectedBehavior:
      "Should escalate PAYMENT_DISPUTE (or NEGATIVE_SENTIMENT). Acknowledge frustration; do NOT promise a refund.",
  },
  // Typed-knowledge:
  {
    id: "item-price-lookup",
    description: "Priced item lookup (KnowledgeItem hit)",
    message: "Bonjour, combien coûte le Macbook Pro M3 chez vous ?",
    expectedLanguage: "fr",
    expectedBehavior:
      "Should hit the seeded Macbook Pro M3 KnowledgeItem and quote its price (DZD).",
  },
  {
    id: "hours-tier2-fact",
    description: "Tier-2 operational fact (specific hours)",
    message: "À quelle heure ouvrez-vous le matin pendant la semaine ?",
    expectedLanguage: "fr",
    expectedBehavior:
      "Should hit the seeded hours operational fact and quote 09:00 (or equivalent).",
  },
  {
    id: "qna-shipping-constantine",
    description: "Q&A near-verbatim (curated shipping question)",
    message: "Vous livrez à Constantine ?",
    expectedLanguage: "fr",
    expectedBehavior:
      "Should hit the seeded shipping Q&A and use its answer near-verbatim.",
  },
  // Two Darija rows targeting registers the model historically slips on
  // (WBP user reports + earlier eval runs).
  {
    id: "darija-arabizi-product",
    description: "Darija Arabizi — casual product price ask",
    message: "Salam khoya, b9adach yswa Macbook Pro M3 3andkom?",
    expectedLanguage: "darija",
    expectedBehavior:
      "Reply in Algerian Arabizi with the Macbook Pro M3 DZD price. No Moroccan vocab " +
      "(kankteb / zwina / dyal / safi / bzaf / flous). Code-switching with French OK.",
  },
  {
    id: "darija-arabic-script-complaint",
    description: "Darija Arabic-script — order complaint / escalation",
    message: "السلام، راني خايف يا سيدي، طلبيتي ما وصلتش وراني نستنى فيها من زمان",
    expectedLanguage: "darija",
    expectedBehavior:
      "Reply in Algerian Arabic-script Darija with empathy; likely escalate " +
      "NEGATIVE_SENTIMENT. Algerian markers (راني / واش / بصح / متاع), no MSA drift.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Eval fixtures (idempotent setup — run every time, cheap)
// ─────────────────────────────────────────────────────────────────────────────

const SEEDED_ITEM_SKU = "BRAIN-EVAL-MBP-M3";
const SEEDED_QNA_TAG = "brain-eval";

const EVAL_VOICE_PROFILE: VoiceProfile = {
  tone: "friendly",
  formality: 3,
  signaturePhrases: ["Heureux de vous aider", "On est là pour vous"],
  avoid: ["promesses vagues", "ton condescendant"],
  emojiPolicy: "minimal",
  defaultLanguage: "fr",
  fallbackLanguage: "en",
  fewShot: [
    {
      customer: "Bonjour, j'ai une question sur votre service.",
      reply:
        "Bonjour ! Bien sûr, dites-m'en plus — quel aspect du service vous intéresse ?",
    },
    {
      customer: "Vous livrez à Oran ?",
      reply:
        "Oui, on livre dans toute l'Algérie y compris Oran. Le délai habituel est de 2 à 3 jours ouvrables.",
    },
  ],
};

async function setupEvalFixtures(tenantId: string): Promise<void> {
  // Stamp voice profile + full operational facts (tier-1 + tier-2).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings =
    typeof tenant?.settings === "object" &&
    tenant?.settings !== null &&
    !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...settings, voiceProfile: EVAL_VOICE_PROFILE } },
  });

  await setOperationalFacts({
    tenantId,
    data: {
      displayName: "Acme Distribution Algérie",
      primaryLanguage: "fr",
      languagesServed: ["fr", "ar", "darija", "en"],
      primaryContact: {
        name: "Service Client Acme",
        email: "support@acme.test",
        phone: "+213 21 55 67 89",
      },
      hours: {
        tz: "Africa/Algiers",
        weekly: [
          { day: "sun", open: "09:00", close: "17:00" },
          { day: "mon", open: "09:00", close: "17:00" },
          { day: "tue", open: "09:00", close: "17:00" },
          { day: "wed", open: "09:00", close: "17:00" },
          { day: "thu", open: "09:00", close: "13:00" },
        ],
      },
      currency: "DZD",
      locations: [
        { label: "Siège — Alger", address: "16 rue Didouche Mourad, Alger Centre" },
      ],
      serviceArea: "Algérie (livraison nationale)",
    },
  });

  // KnowledgeItem — Macbook Pro M3.
  const existingItem = await prisma.knowledgeItem.findFirst({
    where: { tenantId, sku: SEEDED_ITEM_SKU },
    select: { id: true },
  });
  let itemId: string;
  if (existingItem) {
    itemId = existingItem.id;
  } else {
    const created = await prisma.knowledgeItem.create({
      data: {
        tenantId,
        name: "Macbook Pro M3 14-pouces",
        category: "laptops",
        brand: "Apple",
        sku: SEEDED_ITEM_SKU,
        currency: "DZD",
        priceCents: 23_000_000, // 230,000 DZD
        availability: "IN_STOCK",
        description:
          "Macbook Pro 14 pouces, puce Apple M3, 16 Go RAM, 512 Go SSD. Livraison 2-3 jours dans toute l'Algérie.",
        specs: {
          chip: "Apple M3",
          ram: "16GB",
          storage: "512GB SSD",
          screen: "14 pouces",
        },
      },
      select: { id: true },
    });
    itemId = created.id;
  }
  // Always re-embed (idempotent — the prompt builder reads from current
  // text, and we want fresh embeddings if the description changes).
  const itemEmbedText = [
    "Macbook Pro M3 14-pouces",
    "Apple",
    "laptops",
    "Macbook Pro 14 pouces, puce Apple M3, 16 Go RAM, 512 Go SSD. Livraison 2-3 jours dans toute l'Algérie.",
    "chip: Apple M3",
    "ram: 16GB",
    "storage: 512GB SSD",
    "screen: 14 pouces",
  ].join("\n");
  const itemEmbed = await embed({ inputs: [itemEmbedText], inputType: "document" });
  await attachItemEmbedding({ itemId, vector: itemEmbed.vectors[0]! });

  // QnaPair — shipping to Constantine.
  const constanineQuestion = "Vous livrez à Constantine ?";
  const existingQna = await prisma.qnaPair.findFirst({
    where: { tenantId, tags: { has: SEEDED_QNA_TAG } },
    select: { id: true },
  });
  let qnaId: string;
  if (existingQna) {
    qnaId = existingQna.id;
  } else {
    const createdQna = await prisma.qnaPair.create({
      data: {
        tenantId,
        question: constanineQuestion,
        normalizedQuestion: constanineQuestion.toLowerCase().trim(),
        answer:
          "Oui, on livre dans toute l'Algérie y compris Constantine. Le délai habituel est de 2 à 3 jours ouvrables. Souhaitez-vous un devis ?",
        language: "fr",
        languageLock: false,
        tags: [SEEDED_QNA_TAG],
        sourceUrl: null,
      },
      select: { id: true },
    });
    qnaId = createdQna.id;
  }
  const qnaEmbed = await embed({
    inputs: [constanineQuestion],
    inputType: "query",
  });
  await attachQnaEmbedding({ qnaId, vector: qnaEmbed.vectors[0]! });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-row execution + checks
// ─────────────────────────────────────────────────────────────────────────────

type EvalRowResult = {
  query: EvalQuery;
  detectedLanguage: SupportedReplyLanguage;
  reply: string;
  replyClaimedLanguage: SupportedReplyLanguage;
  groundedness: number;
  citationsCount: number;
  citationsUsedCount: number;
  topCitationKinds: string[];
  confidence: number;
  escalation: string | null;
  modelId: string;
  retriesUsed: number;
  usage: BrainResult["aiMetadata"]["usage"];
  costUsd: number;
  /** franc-based detection on the reply text. */
  francCode: string;
  languageMatch: boolean;
  languageMatchNotes: string;
  /** Per-row PASS = every check passes. */
  passed: boolean;
  failedChecks: string[];
};

const FRANC_TO_OURS: Record<string, SupportedReplyLanguage | "unknown"> = {
  eng: "en",
  fra: "fr",
  arb: "ar", // Modern Standard Arabic
  ary: "darija", // Moroccan Arabic — closest franc has to Algerian Darija
  und: "unknown",
};

// ─────────────────────────────────────────────────────────────────────────────
// Moroccan-vocab anti-pattern detector — applies to claimed-darija replies
// only. The user-facing failure mode this guards: replies that are mostly
// Algerian but slip in one Moroccan word (kankteb, zwina, dyal, safi, bzaf,
// flous), which Algerian customers reject on sight. Pair with Block A's
// FORBIDDEN MOROCCAN VOCABULARY section — Block A coaches the model, this
// validator catches regressions.
//
// Targeted at Arabizi/Latin-script replies (Moroccan substitutions show up
// in Latin form most often). Arabic-script Moroccan vs Algerian is harder
// to disambiguate at the word level — e.g. "بزاف" is used in both — so the
// Latin list is the safe ground.
//
// Space-padding: the user-supplied list bakes in ` bzaf ` / ` safi ` /
// ` dyal ` (etc.) to avoid false positives when those letters appear inside
// other words. We normalize the reply by lowercasing it, replacing
// punctuation with spaces, and bracketing with leading/trailing spaces, so
// the literal substring check works around start/end and against punctuation.
// ─────────────────────────────────────────────────────────────────────────────

const MOROCCAN_FORBIDDEN_WORDS = [
  "kankteb",
  "kandir",
  "kanmshi",
  "zwina",
  "zwin",
  " bzaf ",
  " safi ",
  " dyal ",
  " wakha ",
  " flous ",
  " smitek ",
  " shnu ",
] as const;

function normalizeForVocabCheck(reply: string): string {
  // Lowercase, turn punctuation/newlines into spaces, collapse repeats,
  // bracket with spaces so " bzaf " matches at start/end and around commas.
  const lower = reply.toLowerCase();
  const withSpaces = lower.replace(/[^a-z0-9؀-ۿ]+/g, " ");
  return ` ${withSpaces.trim().replace(/\s+/g, " ")} `;
}

function detectMoroccanVocab(reply: string): string[] {
  const haystack = normalizeForVocabCheck(reply);
  const hits: string[] = [];
  for (const needle of MOROCCAN_FORBIDDEN_WORDS) {
    if (haystack.includes(needle.toLowerCase())) {
      hits.push(needle.trim());
    }
  }
  return hits;
}

function classifyDarijaScript(reply: string): "arabizi" | "arabic-script" | "neither" {
  const hasArabizi = /\d[a-z]+|[a-z]+\d/i.test(reply); // 3andkom, wa7ed, men9oul
  const hasArabicScript = /[؀-ۿ]/.test(reply);
  // Note: \b word boundaries don't work with Arabic (the Unicode chars
  // aren't ASCII word characters), so we use substring matching.
  // Algerian Darija markers — vocabulary distinct from MSA. Expanded
  // P4r-7 after the first eval pass: the model produced excellent
  // Darija replies that the original short marker list missed.
  const ALGERIAN_DARIJA_MARKERS = [
    "واش", "راكم", "راني", "كاين", "بزاف", "كيفاش", "مازال", "دير",
    "معليش", "متاع", "باش", "نقدر", "نوصل", "نعطي", "نَدير", "ندير",
    "تحب", "بصح", "برك", "خدام", "كاش", "هاذا", "هاذي",
  ];
  const hasDarijaArabicMarker = ALGERIAN_DARIJA_MARKERS.some((m) =>
    reply.includes(m),
  );
  if (hasArabicScript && hasDarijaArabicMarker) return "arabic-script";
  if (hasArabizi) return "arabizi";
  return "neither";
}

function validateReplyLanguage(
  reply: string,
  claimed: SupportedReplyLanguage,
): { match: boolean; francCode: string; notes: string } {
  // franc returns ISO 639-3 codes; min variant covers the major
  // languages we care about. Empty/short replies → "und".
  const francCode = franc(reply, { minLength: 8 });
  const francOurs = FRANC_TO_OURS[francCode] ?? "unknown";

  // Special handling for Darija: franc can't reliably distinguish
  // Algerian Darija from MSA in Arabic-script, and Arabizi shows up
  // as eng/fra/und to franc since it's Latin chars.
  if (claimed === "darija") {
    const script = classifyDarijaScript(reply);
    if (script === "arabizi") {
      return {
        match: true,
        francCode,
        notes: `Arabizi detected (Latin + numerals); franc=${francCode} (expected since franc doesn't recognize Arabizi)`,
      };
    }
    if (script === "arabic-script") {
      return {
        match: true,
        francCode,
        notes: `Arabic-script Darija with dialect markers detected; franc=${francCode}`,
      };
    }
    return {
      match: false,
      francCode,
      notes: `Claude claimed darija but reply has no Arabizi numerals AND no Darija dialect markers; franc=${francCode}`,
    };
  }

  if (francOurs === claimed) {
    return { match: true, francCode, notes: `franc=${francCode} matches claimed=${claimed}` };
  }
  if (francOurs === "unknown") {
    // Reply too short or unclassifiable. Don't flag as failure;
    // let the per-row review notes call it out.
    return {
      match: true,
      francCode,
      notes: `franc=${francCode} (undetermined — reply may be too short to classify)`,
    };
  }
  return {
    match: false,
    francCode,
    notes: `claimed=${claimed} but franc detected ${francOurs} (${francCode})`,
  };
}

async function runEvalRow(
  query: EvalQuery,
  tenantId: string,
): Promise<EvalRowResult> {
  const result = await runBrain({
    tenantId,
    message: query.message,
    // No conversationId — eval rows are independent one-shots.
  });

  const langCheck = validateReplyLanguage(result.reply, result.language);
  const usage = result.aiMetadata.usage;
  let costUsd = 0;
  if (usage) {
    try {
      costUsd = computeCostUsd(result.aiMetadata.modelId, usage);
    } catch {
      costUsd = 0;
    }
  }

  // Per-row shape checks.
  const failedChecks: string[] = [];
  if (!result.reply || result.reply.length === 0) failedChecks.push("reply_empty");
  if (result.reply.length < 10) failedChecks.push("reply_suspiciously_short");
  if (!["ar", "fr", "en", "darija"].includes(result.language)) {
    failedChecks.push("invalid_language_code");
  }
  if (!langCheck.match) failedChecks.push("language_mismatch");
  if (typeof result.groundedness !== "number" || result.groundedness < 0 || result.groundedness > 1) {
    failedChecks.push("invalid_groundedness");
  }
  for (const used of result.citationsUsed) {
    if (used < 1 || used > result.citations.length) {
      failedChecks.push(`citation_index_out_of_range:${used}`);
    }
  }
  // Moroccan-vocab anti-pattern check — only for rows where the customer
  // expected a Darija reply (the register risk we care about). Catches
  // regressions in the Block A FORBIDDEN MOROCCAN VOCABULARY coaching.
  if (query.expectedLanguage === "darija") {
    const moroccanHits = detectMoroccanVocab(result.reply);
    for (const word of moroccanHits) {
      failedChecks.push(`moroccan_vocab_detected:${word}`);
    }
  }

  return {
    query,
    detectedLanguage: result.language,
    reply: result.reply,
    replyClaimedLanguage: result.language,
    groundedness: result.groundedness,
    citationsCount: result.citations.length,
    citationsUsedCount: result.citationsUsed.length,
    topCitationKinds: result.citations.slice(0, 3).map((c) => c.kind),
    confidence: result.confidence,
    escalation: result.escalation,
    modelId: result.aiMetadata.modelId,
    retriesUsed: 0, // BrainResult doesn't expose this; usage already captures cost
    usage,
    costUsd,
    francCode: langCheck.francCode,
    languageMatch: langCheck.match,
    languageMatchNotes: langCheck.notes,
    passed: failedChecks.length === 0,
    failedChecks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

type EvalReport = {
  startedAt: string;
  completedAt: string;
  modelId: string;
  tenantSlug: string;
  totalRows: number;
  passedRows: number;
  failedRows: number;
  totalCostUsd: number;
  rows: EvalRowResult[];
};

function writeJsonReport(report: EvalReport, modelId: string, ts: string): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const safeModel = modelId.replace(/[^a-z0-9.-]/gi, "_");
  const path = join(REPORTS_DIR, `${ts}-${safeModel}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}

function writeMarkdownReport(report: EvalReport, modelId: string, ts: string): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const safeModel = modelId.replace(/[^a-z0-9.-]/gi, "_");
  const path = join(REPORTS_DIR, `${ts}-${safeModel}.md`);
  const lines: string[] = [
    `# brain-eval — ${modelId}`,
    "",
    `Started: ${report.startedAt}`,
    `Completed: ${report.completedAt}`,
    `Model: \`${report.modelId}\``,
    `Tenant: \`${report.tenantSlug}\``,
    `Rows: ${report.totalRows} (${report.passedRows} passed, ${report.failedRows} failed)`,
    `Total cost: $${report.totalCostUsd.toFixed(4)}`,
    "",
    "## Per-row results",
    "",
  ];
  for (const r of report.rows) {
    lines.push(`### ${r.query.id} — ${r.passed ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push(`**Description:** ${r.query.description}`);
    lines.push(`**Expected:** ${r.query.expectedBehavior}`);
    lines.push(`**Customer message:** ${JSON.stringify(r.query.message)}`);
    lines.push("");
    lines.push(`- Reply: ${JSON.stringify(r.reply)}`);
    lines.push(
      `- Claude language self-report: \`${r.replyClaimedLanguage}\` | franc: \`${r.francCode}\` | language match: **${r.languageMatch ? "yes" : "NO"}**`,
    );
    lines.push(`- Language notes: ${r.languageMatchNotes}`);
    lines.push(
      `- Groundedness: ${r.groundedness.toFixed(2)} | Confidence: ${r.confidence.toFixed(2)} | Escalation: \`${r.escalation ?? "none"}\``,
    );
    lines.push(
      `- Citations: ${r.citationsCount} surfaced, ${r.citationsUsedCount} used | top kinds: \`${r.topCitationKinds.join(", ") || "(none)"}\``,
    );
    if (r.usage) {
      lines.push(
        `- Tokens: input=${r.usage.inputTokens} output=${r.usage.outputTokens} cache_create=${r.usage.cacheCreationInputTokens ?? 0} cache_read=${r.usage.cacheReadInputTokens ?? 0} | cost=$${r.costUsd.toFixed(6)}`,
      );
    }
    if (r.failedChecks.length > 0) {
      lines.push(`- **Failed checks:** ${r.failedChecks.join(", ")}`);
    }
    lines.push("");
  }
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseline comparison
// ─────────────────────────────────────────────────────────────────────────────

type BaselineDiff = {
  rowId: string;
  changes: string[];
};

function findMostRecentBaseline(modelId: string): EvalReport | null {
  if (!isDirAccessible(REPORTS_DIR)) return null;
  const safeModel = modelId.replace(/[^a-z0-9.-]/gi, "_");
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(`-${safeModel}.json`))
    .sort();
  // Last entry is the current run (just written) — pick the previous-to-last.
  if (files.length < 2) return null;
  const prevPath = join(REPORTS_DIR, files[files.length - 2]!);
  try {
    return JSON.parse(readFileSync(prevPath, "utf8")) as EvalReport;
  } catch {
    return null;
  }
}

function isDirAccessible(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

function diffRowsAgainstBaseline(
  current: EvalRowResult,
  baseline: EvalRowResult,
): BaselineDiff | null {
  const changes: string[] = [];
  if (current.replyClaimedLanguage !== baseline.replyClaimedLanguage) {
    changes.push(
      `language: ${baseline.replyClaimedLanguage} → ${current.replyClaimedLanguage}`,
    );
  }
  if (current.escalation !== baseline.escalation) {
    changes.push(`escalation: ${baseline.escalation} → ${current.escalation}`);
  }
  if (current.citationsUsedCount !== baseline.citationsUsedCount) {
    changes.push(
      `citations_used: ${baseline.citationsUsedCount} → ${current.citationsUsedCount}`,
    );
  }
  const lenDelta = current.reply.length - baseline.reply.length;
  const lenPctDelta = baseline.reply.length === 0 ? 0 : Math.abs(lenDelta) / baseline.reply.length;
  if (lenPctDelta > 0.2) {
    changes.push(
      `reply length: ${baseline.reply.length} → ${current.reply.length} (${(lenPctDelta * 100).toFixed(0)}%)`,
    );
  }
  return changes.length > 0 ? { rowId: current.query.id, changes } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

type CliArgs = {
  modelId: string;
  markdown: boolean;
  noPrompt: boolean;
  noBaselineDiff: boolean;
};

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  let markdown = false;
  let noPrompt = false;
  let noBaselineDiff = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--model") {
      modelId = args[++i] ?? modelId;
    } else if (a === "--markdown") {
      markdown = true;
    } else if (a === "--no-prompt") {
      noPrompt = true;
    } else if (a === "--no-baseline-diff") {
      noBaselineDiff = true;
    }
  }
  return { modelId, markdown, noPrompt, noBaselineDiff };
}

async function confirmCost(modelId: string, rowCount: number): Promise<boolean> {
  const estimate = (rowCount * COST_PER_ROW_ESTIMATE_USD).toFixed(2);
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    `\nThis will make ${rowCount} real Anthropic API calls against ${modelId} ` +
      `and cost approximately $${estimate}. Continue? [y/N] `,
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[brain-eval] ANTHROPIC_API_KEY not set");
    return 2;
  }
  const cli = parseArgs();
  // Override the model env so resolveModelId() picks it up.
  process.env.ANTHROPIC_MODEL = cli.modelId;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    console.error(
      `[brain-eval] tenant '${TENANT_SLUG}' not found — run 'npm run db:seed' first`,
    );
    return 2;
  }

  console.log(`[brain-eval] tenant: ${tenant.slug} (${tenant.id})`);
  console.log(`[brain-eval] model:  ${cli.modelId}`);
  console.log(`[brain-eval] rows:   ${QUERY_BANK.length}`);

  if (!cli.noPrompt) {
    const proceed = await confirmCost(cli.modelId, QUERY_BANK.length);
    if (!proceed) {
      console.log("[brain-eval] aborted by user");
      return 0;
    }
  }

  console.log("\n[brain-eval] seeding eval fixtures (idempotent)…");
  await setupEvalFixtures(tenant.id);
  console.log("[brain-eval] fixtures ready\n");

  const startedAt = new Date().toISOString();
  const ts = startedAt.replace(/[:.]/g, "-");
  const rows: EvalRowResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < QUERY_BANK.length; i++) {
    const q = QUERY_BANK[i]!;
    process.stdout.write(
      `[brain-eval] [${i + 1}/${QUERY_BANK.length}] ${q.id} — `,
    );
    try {
      const r = await runEvalRow(q, tenant.id);
      rows.push(r);
      totalCost += r.costUsd;
      process.stdout.write(
        `${r.passed ? "PASS" : "FAIL"} (${r.replyClaimedLanguage}/${r.escalation ?? "no-esc"}, $${r.costUsd.toFixed(4)})\n`,
      );
      if (!r.passed) {
        process.stdout.write(`           failures: ${r.failedChecks.join(", ")}\n`);
      }
    } catch (err) {
      process.stdout.write("THROW\n");
      console.error(`           ${err instanceof Error ? err.message : String(err)}`);
      // Capture as a synthetic failed row so the report still includes it.
      rows.push({
        query: q,
        detectedLanguage: q.expectedLanguage,
        reply: "",
        replyClaimedLanguage: q.expectedLanguage,
        groundedness: 0,
        citationsCount: 0,
        citationsUsedCount: 0,
        topCitationKinds: [],
        confidence: 0,
        escalation: null,
        modelId: cli.modelId,
        retriesUsed: 0,
        usage: null,
        costUsd: 0,
        francCode: "und",
        languageMatch: false,
        languageMatchNotes: `error: ${err instanceof Error ? err.message : String(err)}`,
        passed: false,
        failedChecks: ["threw_during_run"],
      });
    }
  }

  const completedAt = new Date().toISOString();
  const passedRows = rows.filter((r) => r.passed).length;
  const report: EvalReport = {
    startedAt,
    completedAt,
    modelId: cli.modelId,
    tenantSlug: tenant.slug,
    totalRows: rows.length,
    passedRows,
    failedRows: rows.length - passedRows,
    totalCostUsd: totalCost,
    rows,
  };

  const jsonPath = writeJsonReport(report, cli.modelId, ts);
  console.log(`\n[brain-eval] JSON report: ${jsonPath}`);
  if (cli.markdown) {
    const mdPath = writeMarkdownReport(report, cli.modelId, ts);
    console.log(`[brain-eval] Markdown:    ${mdPath}`);
  }

  // Baseline comparison: last-saved report for the same model.
  if (!cli.noBaselineDiff) {
    const baseline = findMostRecentBaseline(cli.modelId);
    if (!baseline) {
      console.log("[brain-eval] (no prior baseline for this model — skipping diff)");
    } else {
      console.log(
        `\n[brain-eval] diff vs baseline @ ${baseline.startedAt}:`,
      );
      const diffs: BaselineDiff[] = [];
      for (const cur of rows) {
        const prev = baseline.rows.find((r) => r.query.id === cur.query.id);
        if (!prev) continue;
        const d = diffRowsAgainstBaseline(cur, prev);
        if (d) diffs.push(d);
      }
      if (diffs.length === 0) {
        console.log("  no meaningful diffs");
      } else {
        for (const d of diffs) {
          console.log(`  ${d.rowId}:`);
          for (const c of d.changes) console.log(`    - ${c}`);
        }
      }
    }
  }

  console.log(
    `\n[brain-eval] summary: ${passedRows}/${rows.length} passed, total cost $${totalCost.toFixed(4)}`,
  );
  return passedRows === rows.length ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[brain-eval] uncaught error:", err);
    process.exit(2);
  });

export {};
