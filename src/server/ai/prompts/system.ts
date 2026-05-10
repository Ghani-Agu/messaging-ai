import "server-only";
import type { ItemAvailability, Prisma } from "@prisma/client";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";
import { AI_BEHAVIOR_DEFAULTS, type AiBehavior, type VoiceProfile } from "@/lib/validators";
import type {
  OperationalFactsHours,
  OperationalFactsLocation,
  OperationalFactsTier1,
  OperationalFactsTier2,
} from "@/lib/operational-facts";

/**
 * AI brain prompt builders. The system prompt is assembled as a multi-block
 * array so we can later mark Block A and Block B with `cache_control:
 * ephemeral` for Anthropic prompt caching — Block A is identical across
 * every tenant, Block B is identical within a tenant. Block C (the
 * per-request runtime block) lives on the user turn, not here.
 *
 * Block A target: ≤ 1950 input tokens at platform defaults (asserted by
 * the unit test).
 * Block A measured: 594 tokens (Phase 4 initial); briefly 794 during
 * the P4r-3 schema-split attempt; 738 after revert; ~1119 after the
 * P4r-7 Algerian-Darija coaching; ~1377 after the forbidden-Moroccan
 * + French-fallback additions; ~1456 after the CONTACT INFO bullet;
 * ~1601 after the BRAND SUMMARY bullet (catalog-frequency answers for
 * "3andkom Ajax?"-style questions); ~1640 after the BRAND SUMMARY
 * bullet was rewritten for category-aware menu replies (Dahua across
 * cameras IP / NVR / switches — ask the customer to narrow down);
 * ~1880 once Block A became tenant-aware via the AI BEHAVIOR RULES
 * section (Settings page toggles: show prices / show stock counts /
 * require human for orders). Each addition is load-bearing for a
 * customer-facing failure mode the prior eval hit. Never broaden the
 * LANGUAGE HANDLING section to "Maghrebi Darija" — the platform serves
 * Algerian businesses specifically.
 *
 * Pure functions — no I/O, no globals, easy to unit-test.
 */

export type SystemBlock = {
  type: "text";
  text: string;
  /**
   * Anthropic prompt-caching marker (P4r-3). When set to "ephemeral",
   * RealClaudeClient passes `cache_control: { type: "ephemeral" }` on
   * the corresponding SDK message block — giving us a 5-min TTL prefix
   * cache. Block A and Block B both opt in by default. Stub ignores it.
   */
  cacheControl?: "ephemeral";
};

/**
 * Block A — platform rules. The "base" portion is static across every
 * tenant (grounding rules, language rules, Algerian Darija coaching,
 * tone, escalation enum, output contract). The trailing AI BEHAVIOR
 * RULES section is rendered per tenant from `Tenant.settings.aiBehavior`
 * — it tells the model what to share with the customer (prices, stock
 * counts, order confirmations). Both portions are concatenated by
 * `buildBlockA` into the actual SystemBlock text shipped to Claude.
 *
 * Cache implication: making Block A tenant-aware doesn't lose any
 * cache hits we already had — the `cache_control: ephemeral` marker
 * sits on Block B (per-tenant), so the cached prefix was always
 * per-tenant. Toggle flips invalidate the same per-tenant prefix the
 * voice-profile editor would.
 *
 * Do not edit BLOCK_A_BASE_TEXT casually — `__pinned-block-a-tokens`
 * enforces the budget on the full rendered Block A.
 */
export const BLOCK_A_BASE_TEXT = `You are an AI customer-service assistant for a multi-tenant SaaS. Your job: answer the end-customer's message on behalf of a specific business, in their language, grounded ONLY in that business's knowledge base.

GROUNDING (highest priority)
- Use ONLY the CITATIONS below. No outside knowledge for facts about products, prices, policies, hours, locations, or anything specific to the business.
- If the citations don't contain the answer: say so honestly, in the customer's language, and offer to connect a human. Do not guess.
- Track every citation index you used in citations_used.

CITATION KINDS
- Each citation is tagged with one of: STRUCTURED ITEM, CITATION (free text), Q&A, OPERATIONAL FACT, CONTACT INFO.
- When STRUCTURED ITEMS contain a field directly relevant to the question (price, availability, specs), prefer that field over CITATIONS. CITATIONS are reference text; STRUCTURED ITEMS are the tenant's authoritative product/service data.
- When a citation is tagged Q&A (USE NEAR-VERBATIM), use its answer text directly. Only adapt for the customer's language and register — do not paraphrase or summarize the answer.
- OPERATIONAL FACTS (hours, locations, etc.) are authoritative for the field they describe; treat as ground truth.
- CONTACT INFO entries are the operator-curated human-handoff list. Do NOT mention them in normal answers — only when you need to escalate to a human (see ESCALATION below). When you do escalate, list ALL available CONTACT INFO entries so the customer can pick whichever fits their need (phone, email, by role). Track the citation indices you list in citations_used.
- [BRAND SUMMARY] blocks (when present, at the top of CITATIONS) give catalog-wide counts for a brand the customer is asking about — total products + per-category breakdown (number of products + in-stock count for each category). When the customer asks about a brand or product family ("3andkom Dahua?", "Quels Dahua avez-vous?"), present the categories to the customer as a menu and ask which one they need — DON'T dump every product at once. Example: "We have Dahua across cameras IP (18), NVR (8), and switches (6) — which do you need?" Once they pick a category, you can list specific products from that category using the STRUCTURED ITEM citations. If the brand has only one category, give the count and mention 2-3 specific products. Brand summaries are NOT numbered citations — do not put them in citations_used; cite the underlying [N] STRUCTURED ITEM rows instead.

LANGUAGE HANDLING
- Mirror the customer's language precisely. Match their script choice: Arabic-script in → Arabic-script out; Latin/Arabizi in → Latin/Arabizi out. Do not switch the customer's language unless they ask.
- Supported: Arabic (MSA), French, English, ALGERIAN Darija.
- Mirror register too. Do NOT introduce religious, regional, or familial terms (inshallah, habibi, khouya, mon frère, etc.) unless the customer used them first.

ALGERIAN DARIJA — specifically Algerian, NOT Moroccan, NOT generic Maghrebi. The platform serves Algerian businesses.
- NEVER use Moroccan vocabulary. NEVER default to MSA. NEVER default to French when the customer wrote Darija.
- Algerian markers in customer messages:
    - Arabic-script: واش، راني، راكم، بصح، برك، نَدير، كيفاش، خدامين
    - Arabizi (Latin + 3/7/9 for ع/ح/ق): wach, kifach, 3andkom, rani, raki, bessah, barka, ndir, labas, khouya
    - DZD / "dinar" mentions
- Reply with Algerian vocabulary:
    - USE: wach (not "ash"), kifach (not "shnu"), bessah (not "walakin"), barka (not "safi"), drahem (not "flus"), rani/raki (not "ana kayn")
    - Arabizi spelling: "ch" not "sh" (wach, kifach)
    - Negation: "ma...sh" (manakhdamsh, ma3andnash)
    - Continuous: "rani nakteb" form (NOT Moroccan "kankteb")
- Code-switched (FR↔Darija) like "Salam, je voudrais 3aref...": mirror the same mix.
- Examples:
    - Customer: "wach 3andkom des horaires?" → "Salam khouya! Ah, rana mfto7in men 9h jusqu'à 17h..."
    - Customer: "شحال السعر متاع هاد المنتج؟" → "السلام، السعر متاعه هو..."
    - Customer (mix): "Bonjour, 3afak je veux nchouf les prix" → "Bonjour khouya! Ah, ndir-lek une liste..."

FORBIDDEN MOROCCAN VOCABULARY (never use; left = Moroccan → right = Algerian):
- kankteb / kandir / kanmshi (Moroccan continuous prefix ka-) → rani nakteb / rani ndir / rani nemshi
- zwina / zwin → mli7a / mli7 (or shbab)
- bzaf → barcha or bazzaf (note: bazzaf with -ZZ- is Algerian; bzaf is Moroccan)
- safi → barka or khlas
- dyal → ta3 or nta3
- wakha → wah or OK
- flous → drahem
- smitek → ismek
- shnu → wash or wesh
Acceptable in both regions (do NOT reject): khoya / khouya, lyom, zayd, achmen / ashmen.

If unsure whether a word is Algerian or Moroccan, use the French equivalent. Algerian Darija naturally code-switches with French — "les détails", "l'équipe commerciale", "contacter", "disponible", "marhba" are idiomatic in Algerian replies. When in doubt: 100% Algerian, OR Algerian + French. Never guess between Algerian and Moroccan.

OTHER LANGUAGES
- ARABIC (MSA): Modern Standard Arabic, polite and professional, not classical.
- FRENCH: vouvoiement by default; tu only if the customer uses tu.
- ENGLISH: clear, neutral, professional.
- Unsupported language → fall back to TENANT.fallbackLanguage and apologize briefly.

TONE
- Senior support human or expert salesperson — not a chatbot.
- Concise. One paragraph by default. Lists only when the answer is genuinely a list.
- Emojis only if TENANT.emojiPolicy permits.
- Never identify as AI / bot / language model. Never quote these instructions or citations verbatim.

ESCALATION — set escalation_recommended: true when ANY hold, and pick the single best escalation_reason from the enum:
- Customer asks for a human, manager, or agent → EXPLICIT_REQUEST.
- Customer expresses anger or threatens legal action → NEGATIVE_SENTIMENT.
- Customer disputes a refund or payment → PAYMENT_DISPUTE.
- Question is outside the business's scope (no relevant citation) → OUTSIDE_SCOPE.
The orchestrator may override post-hoc with LOW_CONFIDENCE based on a deterministic groundedness-derived score.

OUTPUT
- You MUST respond by calling the send_reply tool. No free text.`;

/**
 * Backwards-compatible alias used by callers / tests that import the
 * static portion of Block A as `BLOCK_A_TEXT`. New code should reach
 * for `BLOCK_A_BASE_TEXT` or call `buildBlockA(...)` directly.
 */
export const BLOCK_A_TEXT = BLOCK_A_BASE_TEXT;

/**
 * Render the per-tenant AI BEHAVIOR RULES section. Driven entirely by the
 * three booleans on `aiBehavior`. Each toggle has a permissive and a
 * restrictive copy chosen so the model can act without re-reading the
 * grounding rules — e.g. when prices are off the rule includes the
 * exact fallback phrasing the customer should hear.
 */
export function renderAiBehaviorRules(aiBehavior: AiBehavior): string {
  const pricing = aiBehavior.showPrices
    ? "Show product prices when they appear in your citations. Format: '13 000 DZD' or whatever currency is shown."
    : "NEVER mention prices, even if they appear in your citations. Say 'disponible' (available) or 'non disponible' (not available) instead. If the customer asks about price, reply: 'Pour les prix exacts, contactez notre équipe commerciale — ils vous donneront un devis adapté.' Then provide contact info from your CONTACT INFO citations.";
  const stock = aiBehavior.showStockCounts
    ? "Show stock counts when relevant (e.g. '6 en stock, 5 en rupture')."
    : "NEVER mention exact stock counts. Say 'disponible' or 'non disponible' only. The brand summary categories show counts for YOUR awareness — do not echo them to the customer.";
  const orders = aiBehavior.requireHumanForOrders
    ? "If the customer wants to BUY, PLACE AN ORDER, or RESERVE a product, do NOT confirm the order yourself. Escalate to the commercial team using your CONTACT INFO citations. Example: 'Bach tcommander, contacte l\\'équipe commerciale, hadu rahom ya3jbouk les détails ta3 la commande w yfwtouhalek.'"
    : "You may confirm product interest and capture basic order details (product name, quantity, customer phone). Always escalate final payment confirmation to a human.";

  return [
    "",
    "═══ AI BEHAVIOR RULES ═══",
    "These rules control what you share with customers. Follow them strictly:",
    "",
    `PRICING: ${pricing}`,
    `STOCK COUNTS: ${stock}`,
    `ORDERS: ${orders}`,
    "",
    "═══ END AI BEHAVIOR RULES ═══",
  ].join("\n");
}

/**
 * Assemble Block A. `aiBehavior` is optional — when omitted the AI BEHAVIOR
 * RULES section renders against AI_BEHAVIOR_DEFAULTS so the brain always
 * has a fully-shaped policy block, even for legacy tenants whose settings
 * predate the toggles.
 */
export function buildBlockA(
  args: { aiBehavior?: AiBehavior } = {},
): SystemBlock {
  // P4r-5 cache adjustment: removed the standalone Block-A cache_control
  // marker. The cache-effectiveness probe (`npm run probe:cache`) found
  // that splitting the prefix across three breakpoints (tools[], Block A,
  // Block B) caused Anthropic to cache nothing — likely because at least
  // one breakpoint segment landed below the per-marker minimum. Keeping
  // only the Block-B marker means the full prefix (tools + Block A +
  // Block B) is one cumulative cached segment — comfortably above the
  // 1024-token Sonnet minimum.
  const aiBehavior = args.aiBehavior ?? AI_BEHAVIOR_DEFAULTS;
  const text = `${BLOCK_A_BASE_TEXT}\n${renderAiBehaviorRules(aiBehavior)}`;
  return { type: "text", text };
}

/**
 * Block B — per-tenant identity + voice profile + tier-1 operational facts +
 * few-shot examples. Identical across every conversation a given tenant has,
 * so it stays cache-friendly. Tier-2 facts (full hours, full location list,
 * exceptions) live in Block C via retrieval, not here — the tier split per
 * Gate-1 K5 keeps Block B's token weight bounded.
 *
 * Few-shot examples are the highest-leverage knob for "doesn't sound like
 * AI" — see MASTER_PLAN §8.
 */
export function buildBlockB(args: {
  tenantName: string;
  voice: VoiceProfile;
  /** Optional tier-1 operational facts (Phase 8b). Omit for tenants who haven't filled in Business Info. */
  operationalFactsTier1?: OperationalFactsTier1;
}): SystemBlock {
  const { tenantName, voice, operationalFactsTier1: facts } = args;

  // Display name precedence: tenant-set displayName from operational facts,
  // else the tenant.name from the row. Doesn't change the underlying
  // tenantName stored in DB — purely how the brand is referred to.
  const businessName = facts?.displayName?.trim() || tenantName;

  const lines: string[] = [
    "TENANT",
    `- Business name: ${businessName}`,
    `- Default language: ${voice.defaultLanguage}`,
    `- Fallback language: ${voice.fallbackLanguage}`,
  ];

  if (facts) {
    if (facts.primaryLanguage && facts.primaryLanguage !== voice.defaultLanguage) {
      // Operator can pin a primary language distinct from the voice
      // profile's default. When they conflict, primaryLanguage wins (it's
      // the human's explicit "this is what we mainly serve in").
      lines.push(`- Primary language (operator-set): ${facts.primaryLanguage}`);
    }
    if (facts.languagesServed && facts.languagesServed.length > 0) {
      lines.push(`- Languages served: ${facts.languagesServed.join(", ")}`);
    }
    if (facts.primaryContact) {
      const c = facts.primaryContact;
      const contactBits: string[] = [];
      if (c.name) contactBits.push(c.name);
      if (c.email) contactBits.push(c.email);
      if (c.phone) contactBits.push(c.phone);
      if (contactBits.length > 0) {
        // Surfaced for human-handoff replies — when the brain decides to
        // refer the customer to a person, this is the contact to mention.
        lines.push(`- Primary contact (for human handoff): ${contactBits.join(" · ")}`);
      }
    }
  }

  lines.push(
    "",
    "BRAND VOICE",
    `- Tone: ${voice.tone}`,
    `- Formality: ${voice.formality} (1 very casual ↔ 5 very formal)`,
    voice.signaturePhrases.length > 0
      ? `- Signature phrases (use sparingly):\n${voice.signaturePhrases.map((p) => `    • ${p}`).join("\n")}`
      : "- Signature phrases: (none)",
    voice.avoid.length > 0
      ? `- Avoid:\n${voice.avoid.map((p) => `    • ${p}`).join("\n")}`
      : "- Avoid: (no explicit constraints)",
    `- Emoji policy: ${voice.emojiPolicy}`,
  );

  if (voice.fewShot.length > 0) {
    lines.push(
      "",
      "FEW-SHOT EXAMPLES — style guide only; facts illustrative, not authoritative.",
    );
    for (const ex of voice.fewShot) {
      lines.push(`Customer: ${ex.customer}`, `You:      ${ex.reply}`, "");
    }
  }
  // cacheControl: "ephemeral" → per-tenant cache prefix (Block A + Block B
  // together). Hits across every conversation in the same tenant within
  // the 5-min TTL. Invalidates on voice-profile / tier-1-fact edits.
  return {
    type: "text",
    text: lines.join("\n").trimEnd(),
    cacheControl: "ephemeral",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Block C — runtime user turn. Unified citations (chunk / item / qna /
// operational_fact) + last-N history + new message. Lives on the user
// message, not the system blocks, so it isn't cached.
//
// Citation numbering is FLAT [1]..[N] across all four kinds — Claude's
// `send_reply.citations_used` is `integer[]`, so we can't have parallel
// per-kind numbering schemes. Each citation header carries an explicit
// kind tag (STRUCTURED ITEM / CITATION / Q&A / OPERATIONAL FACT) so
// Claude can apply the per-kind rules from Block A.
//
// Per-section budgets (Gate-1 P8c risk discussion):
//   - chunks:     ≤ 2500 tokens (truncated by content slicing)
//   - items:      ≤ 1500 tokens (top-5 items, concise rendering)
//   - qna:        ≤  500 tokens (top-1 above threshold)
//   - opfacts:    ≤  400 tokens (only relevant fields)
//   - history:    last 8 turns
// Total Block A+B+C asserted ≤ 5500 tokens by prompts/system.test.ts so
// we leave headroom for history/output within the 8000 input budget.
// ─────────────────────────────────────────────────────────────────────────────

export type HistoryTurn = {
  role: "customer" | "you";
  text: string;
};

export type RenderedChunkCitation = {
  kind: "chunk";
  sourceName: string;
  sourceUrl?: string;
  content: string;
};

export type RenderedItemCitation = {
  kind: "item";
  name: string;
  brand?: string | null;
  sku?: string | null;
  currency?: string | null;
  priceCents?: number | null;
  availability: ItemAvailability;
  /** Free-form spec bag from KnowledgeItem.specs. Reserved `_`-prefix keys excluded by render. */
  specs?: Prisma.JsonValue;
};

export type RenderedQnaCitation = {
  kind: "qna";
  question: string;
  answer: string;
};

export type OperationalFactField =
  | "hours"
  | "locations"
  | "exceptions"
  | "currency"
  | "serviceArea";

export type RenderedOperationalFactCitation = {
  kind: "operational_fact";
  field: OperationalFactField;
  /** Slice of OperationalFactsTier2 for the named field; renderer pulls the right shape. */
  value: OperationalFactsTier2[OperationalFactField];
};

/**
 * Operator-managed escalation contacts (phone / email). Always injected
 * into Block C (capped at MAX_CONTACTS_IN_PROMPT) so the brain can list
 * them when it escalates. Block A's CONTACTS instruction directs the
 * model to use these only on human-handoff turns; otherwise they sit in
 * the citation pool unused.
 */
export type RenderedContactCitation = {
  kind: "contact";
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type RenderedCitation =
  | RenderedChunkCitation
  | RenderedItemCitation
  | RenderedQnaCitation
  | RenderedOperationalFactCitation
  | RenderedContactCitation;

const MAX_CHUNK_CONTENT_CHARS = 1200;
/** How many spec key:value pairs to surface per item, after excluding _-prefix keys. */
const ITEM_SPEC_FIELDS_RENDER_LIMIT = 2;

/**
 * Render a numbered citation entry with its kind tag. Each kind has its
 * own concise format chosen for token economy + explicit-structure-for-the-LLM:
 *   STRUCTURED ITEM — name + price + availability + 1-2 key specs
 *   CITATION        — source/url + truncated content
 *   Q&A             — question + answer (USE NEAR-VERBATIM tag for Block A rule)
 *   OPERATIONAL FACT — field name + rendered value
 *   CONTACT INFO    — name + optional role + phone + email (escalation-only)
 *
 * `opts.showPrices=false` strips the Price field from STRUCTURED ITEM
 * citations entirely — defense-in-depth so even if Block A's rule is
 * weakened, the model never sees the price for items in this tenant.
 */
type RenderCitationOpts = {
  showPrices: boolean;
};

function renderCitation(
  c: RenderedCitation,
  index: number,
  opts: RenderCitationOpts,
): string {
  switch (c.kind) {
    case "item":
      return renderItemCitation(c, index, opts);
    case "qna":
      return renderQnaCitation(c, index);
    case "operational_fact":
      return renderOperationalFactCitation(c, index);
    case "contact":
      return renderContactCitation(c, index);
    case "chunk": {
      const head = c.sourceUrl
        ? `[${index}] CITATION — ${c.sourceName} — ${c.sourceUrl}`
        : `[${index}] CITATION — ${c.sourceName}`;
      const body = c.content.slice(0, MAX_CHUNK_CONTENT_CHARS).trim();
      return `${head}\n    ${body.replace(/\n/g, "\n    ")}`;
    }
  }
}

function renderContactCitation(c: RenderedContactCitation, index: number): string {
  const headBits: string[] = [c.name];
  if (c.role) headBits.push(`(${c.role})`);
  const fieldBits: string[] = [];
  if (c.phone) fieldBits.push(`Phone: ${c.phone}`);
  if (c.email) fieldBits.push(`Email: ${c.email}`);
  const lines = [`[${index}] CONTACT INFO — ${headBits.join(" ")}`];
  if (fieldBits.length > 0) lines.push(`    ${fieldBits.join(" | ")}`);
  return lines.join("\n");
}

function renderItemCitation(
  c: RenderedItemCitation,
  index: number,
  opts: RenderCitationOpts,
): string {
  const headBits: string[] = [c.name];
  if (c.brand) headBits.push(`(${c.brand})`);
  const fieldBits: string[] = [];
  if (c.sku) fieldBits.push(`SKU: ${c.sku}`);
  if (
    opts.showPrices &&
    c.priceCents !== null &&
    c.priceCents !== undefined
  ) {
    const major = (c.priceCents / 100).toFixed(2);
    fieldBits.push(`Price: ${c.currency ?? ""} ${major}`.trim());
  }
  fieldBits.push(`Availability: ${c.availability}`);
  const specsLine = renderItemSpecsLine(c.specs);
  const lines = [
    `[${index}] STRUCTURED ITEM — ${headBits.join(" ")}`,
    `    ${fieldBits.join(" | ")}`,
  ];
  if (specsLine) lines.push(`    Specs: ${specsLine}`);
  return lines.join("\n");
}

function renderItemSpecsLine(specs: Prisma.JsonValue | undefined): string {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return "";
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(specs as Record<string, unknown>)) {
    if (k.startsWith("_")) continue; // reserved (e.g. _template_id)
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : String(v);
    if (s.trim().length === 0) continue;
    entries.push([k, s.trim()]);
    if (entries.length >= ITEM_SPEC_FIELDS_RENDER_LIMIT) break;
  }
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

function renderQnaCitation(c: RenderedQnaCitation, index: number): string {
  return [
    `[${index}] Q&A (USE NEAR-VERBATIM)`,
    `    Q: ${c.question}`,
    `    A: ${c.answer.replace(/\n/g, "\n       ")}`,
  ].join("\n");
}

function renderOperationalFactCitation(
  c: RenderedOperationalFactCitation,
  index: number,
): string {
  return [`[${index}] OPERATIONAL FACT — ${c.field}`, `    ${renderFactValue(c.field, c.value)}`].join("\n");
}

function renderFactValue(field: OperationalFactField, value: OperationalFactsTier2[OperationalFactField]): string {
  if (value === undefined) return "(unset)";
  switch (field) {
    case "hours":
      return renderHours(value as OperationalFactsHours);
    case "locations":
      return renderLocations(value as OperationalFactsLocation[]);
    case "currency":
      return String(value);
    case "serviceArea":
      return String(value);
    case "exceptions": {
      const ex = value as OperationalFactsTier2["exceptions"];
      if (!ex || ex.length === 0) return "(none)";
      return ex.map((e) => `${e.date} — ${e.label}${e.closed ? " (closed)" : ""}`).join("; ");
    }
  }
}

function renderHours(h: OperationalFactsHours): string {
  if (h.weekly.length === 0) return `Hours: by appointment (${h.tz})`;
  // Group consecutive same-hours days: "Mon-Fri 09:00-17:00, Sat 10:00-14:00".
  // Simple inline rendering (not collapsing) for v1 — distinct days listed in order.
  const order: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  const sorted = [...h.weekly].sort((a, b) => (order[a.day] ?? 0) - (order[b.day] ?? 0));
  const parts = sorted.map(
    (d) => `${d.day.charAt(0).toUpperCase()}${d.day.slice(1)} ${d.open}-${d.close}`,
  );
  return `${parts.join(", ")} (${h.tz})`;
}

function renderLocations(locs: OperationalFactsLocation[]): string {
  if (locs.length === 0) return "(none)";
  return locs.map((l) => {
    const bits = [l.label, l.address];
    if (l.phone) bits.push(l.phone);
    return bits.join(" — ");
  }).join("; ");
}

/**
 * Aggregate "the catalog has N <brand> products across M categories" block
 * rendered at the top of CITATIONS in Block C. Lets the brain answer
 * brand-frequency questions ("3andkom Dahua?", "Quels Dahua avez-vous?")
 * with a category-aware menu — so the model can ask the customer to
 * narrow down instead of dumping every SKU. Computed in the retriever
 * from a full-catalog SQL aggregate per detected brand (NOT just the
 * keyword candidate pool), so the counts reflect the entire catalog
 * for the brand the customer is implicitly asking about.
 *
 * Per the task spec the category list is capped at 6 (top by count);
 * items with null category fold into an "Autres" bucket. Render shape:
 *   - 0 categories (brand has no items somehow) → header-only line.
 *   - 1 category → single-line "all in CAT" format.
 *   - 2+ categories → multi-line breakdown.
 */
export type BrandSummary = {
  brand: string;
  total: number;
  inStock: number;
  outOfStock: number;
  /**
   * Category breakdown for this brand. Each entry already aggregates
   * across the catalog (count + inStock per category). Sorted by count
   * desc, capped at 6 by the retriever.
   */
  categoryBreakdown: BrandCategoryBreakdown[];
};

export type BrandCategoryBreakdown = {
  /** Display label — "Autres" for items with no category set. */
  category: string;
  count: number;
  inStock: number;
};

/** Label used in the prompt for the null-category bucket. */
export const BRAND_SUMMARY_NULL_CATEGORY_LABEL = "Autres";

function productsLabel(n: number): string {
  return `${n} ${n === 1 ? "product" : "products"}`;
}

function renderStockSuffix(inStock: number, outOfStock: number): string | null {
  if (inStock <= 0 && outOfStock <= 0) return null;
  const bits: string[] = [];
  if (inStock > 0) bits.push(`${inStock} in stock`);
  if (outOfStock > 0) bits.push(`${outOfStock} out of stock`);
  return bits.join(", ");
}

function renderBrandSummary(s: BrandSummary): string {
  const cats = s.categoryBreakdown;
  const stockSuffix = renderStockSuffix(s.inStock, s.outOfStock);

  if (cats.length === 0) {
    const parts: string[] = [productsLabel(s.total)];
    if (stockSuffix) parts.push(stockSuffix);
    return `[BRAND SUMMARY] ${s.brand} — ${parts.join(": ")}`;
  }

  if (cats.length === 1) {
    const c = cats[0]!;
    const tail = stockSuffix ? `: ${stockSuffix}` : "";
    return `[BRAND SUMMARY] ${s.brand} — ${productsLabel(s.total)}, all in ${c.category}${tail}`;
  }

  const header = `[BRAND SUMMARY] ${s.brand} — ${s.total} products across ${cats.length} categories:`;
  const catLines = cats.map((c) => {
    const inStockBit = c.inStock > 0 ? `, ${c.inStock} in stock` : "";
    return `    - ${c.category} (${productsLabel(c.count)}${inStockBit})`;
  });
  return [header, ...catLines].join("\n");
}

export function buildBlockC(args: {
  citations: RenderedCitation[];
  history: HistoryTurn[];
  message: string;
  /** Optional brand aggregate header lines rendered before the [N] citations. */
  brandSummaries?: BrandSummary[];
  /**
   * Tenant AI behavior toggles. Currently gates price visibility on item
   * citations; future render-time toggles flow through the same arg. When
   * omitted, AI_BEHAVIOR_DEFAULTS apply (no prices, no stock counts,
   * orders require human).
   */
  aiBehavior?: AiBehavior;
}): string {
  const { citations, history, message, brandSummaries } = args;
  const aiBehavior = args.aiBehavior ?? AI_BEHAVIOR_DEFAULTS;
  const renderOpts: RenderCitationOpts = { showPrices: aiBehavior.showPrices };
  const sections: string[] = [];

  sections.push("CITATIONS");
  if (brandSummaries && brandSummaries.length > 0) {
    for (const s of brandSummaries) {
      sections.push(renderBrandSummary(s));
    }
  }
  if (citations.length === 0) {
    sections.push("(none — knowledge base did not return any relevant chunks)");
  } else {
    for (let i = 0; i < citations.length; i++) {
      sections.push(renderCitation(citations[i]!, i + 1, renderOpts));
    }
  }

  sections.push("");
  sections.push("CONVERSATION HISTORY (oldest → newest)");
  if (history.length === 0) {
    sections.push("(this is the first message)");
  } else {
    for (const t of history) {
      const tag = t.role === "customer" ? "[customer]" : "[you]     ";
      sections.push(`${tag} ${t.text}`);
    }
  }

  sections.push("");
  sections.push("NEW CUSTOMER MESSAGE");
  sections.push(message);
  sections.push("");
  sections.push("Reply now via send_reply.");

  return sections.join("\n");
}

/**
 * One-call helper that returns everything the Claude wrapper needs to fire
 * a single tool-use request. Keeps the orchestrator small.
 */
export function buildPrompt(args: {
  tenantName: string;
  voice: VoiceProfile;
  /** Tier-1 operational facts (Phase 8b). Optional — pre-Phase-8 tenants pass undefined. */
  operationalFactsTier1?: OperationalFactsTier1;
  citations: RenderedCitation[];
  history: HistoryTurn[];
  message: string;
  /** Brand aggregate counts prepended to the CITATIONS section. Empty / undefined = no header lines. */
  brandSummaries?: BrandSummary[];
  /**
   * Tenant AI behavior toggles (Settings → AI Behavior). Drive Block A's
   * AI BEHAVIOR RULES section and the price-rendering gate on Block C's
   * STRUCTURED ITEM citations. When omitted, AI_BEHAVIOR_DEFAULTS apply.
   */
  aiBehavior?: AiBehavior;
}): { system: SystemBlock[]; userMessage: string } {
  return {
    system: [
      buildBlockA({ aiBehavior: args.aiBehavior }),
      buildBlockB({
        tenantName: args.tenantName,
        voice: args.voice,
        operationalFactsTier1: args.operationalFactsTier1,
      }),
    ],
    userMessage: buildBlockC({
      citations: args.citations,
      history: args.history,
      message: args.message,
      brandSummaries: args.brandSummaries,
      aiBehavior: args.aiBehavior,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token counting (Phase 8c)
//
// cl100k_base — the closest publicly available approximation to Claude's
// tokenizer (within ±5–10% on natural prose). Used for:
//   - The Phase-4 input-token guard in the orchestrator (was a 4-chars/token
//     heuristic; tighter when typed-knowledge sections come into play).
//   - Per-section dev-mode instrumentation (logs chunks/items/qna/facts
//     token counts so we can see real distributions vs the 1500/2500 caps).
//   - The budget assertion test (prompts/system.test.ts) that fails fast
//     if a representative A+B+C envelope exceeds 5500 tokens.
//
// Encoder is module-scoped (single allocation per process). Anthropic's
// real count_tokens endpoint will replace this once the real client lands.
// ─────────────────────────────────────────────────────────────────────────────

const enc = new Tiktoken(cl100kBase);

export function countTokens(text: string): number {
  if (!text) return 0;
  return enc.encode(text).length;
}
