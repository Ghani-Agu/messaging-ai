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
