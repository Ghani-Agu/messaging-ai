/**
 * OperationalFacts schemas + tier helpers (Phase 8b).
 *
 * Lives in src/lib/ rather than src/server/db/ because the Business Info
 * client form imports the schema for pre-submit validation. `"server-only"`
 * triggers a bundler error even on `import type` paths, so any module a
 * client component reaches must not be marked server-only — same reason
 * voiceProfile lives in src/lib/validators.ts and not next to its (also
 * future) DB helper.
 *
 * The server-side DB layer (src/server/db/operational-facts.ts) keeps the
 * Prisma helpers and re-exports everything in this file for callers that
 * previously imported from the server module.
 *
 * Tier 1 / Tier 2 split per Gate-1 K5 (override of the original "Block B
 * with truncation" proposal):
 *
 *   Tier 1 — always rendered into Block B every prompt. Bounded set of
 *   small, identity-shaped fields the brain needs on every turn:
 *     - displayName:      what to call the business in replies
 *     - primaryLanguage:  the default reply language when ambiguous
 *     - primaryContact:   how to refer the customer to a human
 *     - languagesServed:  the set the brain may switch between
 *
 *   Tier 2 — retrieved into Block C only when the customer's question
 *   warrants. Heavy fields whose token weight would bloat Block B's cache:
 *     - hours:        weekly schedule + timezone
 *     - exceptions:   holiday / one-off date overrides
 *     - locations:    list of physical sites
 *     - currency, serviceArea: free-form geographic / commerce facts
 *
 * Tier-2 retrieval lands later when the orchestrator gains a facts-retrieval
 * pass; for now tier-2 is editable + stored but invisible to the brain.
 * buildBlockB consumes only pickTier1().
 */

import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "./validators";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-shapes
// ─────────────────────────────────────────────────────────────────────────────

export const operationalFactsContactSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().min(1).max(64).optional(),
});
export type OperationalFactsContact = z.infer<typeof operationalFactsContactSchema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DAY_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayOfWeek = (typeof DAY_OF_WEEK)[number];

export const operationalFactsHoursDaySchema = z.object({
  day: z.enum(DAY_OF_WEEK),
  open: z.string().regex(HHMM, "expected HH:MM (24h)"),
  close: z.string().regex(HHMM, "expected HH:MM (24h)"),
});

export const operationalFactsHoursSchema = z.object({
  // IANA timezone string. Not validated against the IANA list — Postgres /
  // Node both have larger lists than we'd want to ship, and wrong values
  // surface as a clear runtime error in the time-formatting helper.
  tz: z.string().trim().min(1).max(64),
  weekly: z.array(operationalFactsHoursDaySchema).max(14),
});
export type OperationalFactsHours = z.infer<typeof operationalFactsHoursSchema>;

export const operationalFactsExceptionSchema = z.object({
  date: z.string().regex(ISO_DATE, "expected YYYY-MM-DD"),
  label: z.string().trim().min(1).max(120),
  // Either fully closed, or a custom open/close pair. Both fields together
  // when partial coverage applies (e.g. half-day on a holiday).
  closed: z.boolean().optional(),
  open: z.string().regex(HHMM).optional(),
  close: z.string().regex(HHMM).optional(),
});
export type OperationalFactsException = z.infer<typeof operationalFactsExceptionSchema>;

export const operationalFactsLocationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(400),
  phone: z.string().trim().min(1).max(64).optional(),
  geo: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});
export type OperationalFactsLocation = z.infer<typeof operationalFactsLocationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 / Tier 2 / combined envelope
// ─────────────────────────────────────────────────────────────────────────────

export const operationalFactsTier1Schema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  primaryLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
  primaryContact: operationalFactsContactSchema.optional(),
  languagesServed: z.array(z.enum(SUPPORTED_LANGUAGES)).max(8).optional(),
});
export type OperationalFactsTier1 = z.infer<typeof operationalFactsTier1Schema>;

export const operationalFactsTier2Schema = z.object({
  hours: operationalFactsHoursSchema.optional(),
  exceptions: z.array(operationalFactsExceptionSchema).max(50).optional(),
  locations: z.array(operationalFactsLocationSchema).max(20).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  serviceArea: z.string().trim().min(1).max(200).optional(),
});
export type OperationalFactsTier2 = z.infer<typeof operationalFactsTier2Schema>;

export const operationalFactsDataSchema = operationalFactsTier1Schema.merge(
  operationalFactsTier2Schema,
);
export type OperationalFactsData = z.infer<typeof operationalFactsDataSchema>;

/**
 * The keys that are tier-1 (always rendered into Block B). Single source of
 * truth — pickTier1 and the patch helper consult this list. Adding a tier-1
 * field requires extending both this array and operationalFactsTier1Schema.
 */
export const TIER1_KEYS = [
  "displayName",
  "primaryLanguage",
  "primaryContact",
  "languagesServed",
] as const satisfies readonly (keyof OperationalFactsTier1)[];

/**
 * Strip everything but tier-1 fields. Used by buildBlockB so the always-
 * rendered slice is bounded — tier-2 fields land in Block C via retrieval
 * later, not Block B.
 */
export function pickTier1(data: OperationalFactsData): OperationalFactsTier1 {
  const out: OperationalFactsTier1 = {};
  for (const k of TIER1_KEYS) {
    if (data[k] !== undefined) {
      // Type narrows per-key.
      (out as Record<string, unknown>)[k] = data[k];
    }
  }
  return out;
}

/**
 * Tolerant parse — invalid envelopes return `{}` rather than throwing. The
 * brain must always have a facts shape (even an empty one) so it can render
 * the absence cleanly in Block B.
 */
export function parseOperationalFactsData(raw: unknown): OperationalFactsData {
  if (!raw) return {};
  const parsed = operationalFactsDataSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier-2 retrieval — keyword-based intent gates (Phase 8c)
//
// OperationalFacts has no per-field embedding (one row per tenant); the
// orchestrator decides which tier-2 fields to inject into Block C based on
// keyword presence in the customer's message. Pure regex match in 4
// languages (AR/FR/EN/Darija) with both Latin transliterations (Arabizi)
// and Arabic-script forms.
//
// Imperfect but transparent — operators can tell why a fact was/wasn't
// injected by looking at the source. Upgrade path (vN+1): embed each tier-2
// field per tenant once, do similarity matching against the question
// embedding for finer intent.
// ─────────────────────────────────────────────────────────────────────────────

// Each intent has TWO regexes — one for ASCII / Latin (with \b word
// boundaries, since \w is ASCII-only in JS's default regex) and one for
// Arabic-script (substring match, no \b, since Arabic letters aren't in
// \w and \b around them is unreliable). The detector ORs both — either
// match flips the flag.
//
// Latin set covers English, French, and Algerian Darija romanization
// (Arabizi: tsa3ru / ch7al / kifash etc.). Arabic set uses distinctive
// root fragments rather than full inflected forms so we catch
// conjugations (e.g. توصل matches توصلون, يوصل, etc.).

// Hours intent ─────────────────────────────────────────────────────────
const HOURS_LATIN_RE =
  /\b(hour|hours|time|open|closed|opening|closing|heure|heures|horaire|horaires|ouverture|fermeture|ouvert|ferm[eé]|wakt|waqt|kifash|kifesh)\b/i;
const HOURS_ARABIC_RE = /ساعات|وقت|متى|تفتح/;

// Locations intent ─────────────────────────────────────────────────────
const LOCATIONS_LATIN_RE =
  /\b(where|location|locations|address|addresses|branch|branches|store|stores|adresse|adresses|magasin|magasins|branche|emplacement|win|fin)\b/i;
const LOCATIONS_ARABIC_RE = /عنوان|أين|فين|موقع|محل/;

// Currency / pricing intent ────────────────────────────────────────────
const CURRENCY_LATIN_RE =
  /\b(price|prices|cost|costs|currency|payment|prix|co[uû]t|co[uû]ts|monnaie|paiement|tsa3ru|tsa3rou|tha7sebli|ch7al)\b/i;
const CURRENCY_ARABIC_RE = /سعر|أسعار|دفع|عملة|ثمن/;

// Service-area intent (delivery / coverage) ────────────────────────────
const SERVICE_AREA_LATIN_RE =
  /\b(deliver|delivery|ship|shipping|coverage|cover|service area|wilaya|livraison|livrer|exp[eé]dition|twasloo|twasel|twassel)\b/i;
// `توصل` covers توصلون / يوصل / موصل (verb conjugations); `توصيل`
// covers the noun form (التوصيل / التوصيلات).
const SERVICE_AREA_ARABIC_RE = /توصيل|توصل|شحن|ولاية|منطقة/;

// Exceptions intent: holiday / specific date queries fall under hours
// intent today — once an operator asks about exception editing in v1.1
// we'll surface it as a separate gate.

export type Tier2RelevanceFlags = {
  hours: boolean;
  locations: boolean;
  exceptions: boolean;
  currency: boolean;
  serviceArea: boolean;
};

/**
 * Decide which tier-2 fields the customer's message likely wants.
 *
 * Pure function — no I/O. Used by the orchestrator's Block C builder to
 * gate which fact slices get injected (per Gate-1 K5: tier-2 only when
 * relevant, never always).
 *
 * Returns all-false on empty / unrecognized input — the brain proceeds
 * with no operational facts in Block C.
 */
export function detectTier2Relevance(message: string): Tier2RelevanceFlags {
  const m = message ?? "";
  const hours = HOURS_LATIN_RE.test(m) || HOURS_ARABIC_RE.test(m);
  return {
    hours,
    // Today: exceptions piggyback on hours intent. A customer asking
    // about hours on a specific date wants both. Operator can override
    // by editing the prompt template later.
    exceptions: hours,
    locations: LOCATIONS_LATIN_RE.test(m) || LOCATIONS_ARABIC_RE.test(m),
    currency: CURRENCY_LATIN_RE.test(m) || CURRENCY_ARABIC_RE.test(m),
    serviceArea:
      SERVICE_AREA_LATIN_RE.test(m) || SERVICE_AREA_ARABIC_RE.test(m),
  };
}

/**
 * Pick the tier-2 slices flagged as relevant. Pure data transform; the
 * orchestrator hands the result to buildBlockC which renders only
 * non-undefined fields.
 */
export function pickRelevantTier2(
  data: OperationalFactsData,
  flags: Tier2RelevanceFlags,
): OperationalFactsTier2 {
  const out: OperationalFactsTier2 = {};
  if (flags.hours && data.hours !== undefined) out.hours = data.hours;
  if (flags.exceptions && data.exceptions !== undefined) out.exceptions = data.exceptions;
  if (flags.locations && data.locations !== undefined) out.locations = data.locations;
  if (flags.currency && data.currency !== undefined) out.currency = data.currency;
  if (flags.serviceArea && data.serviceArea !== undefined) out.serviceArea = data.serviceArea;
  return out;
}
