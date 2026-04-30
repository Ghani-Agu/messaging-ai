import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { SUPPORTED_LANGUAGES } from "@/lib/validators";

/**
 * OperationalFacts (Phase 8b — Type 5).
 *
 * Singleton per tenant: tenantId is the table's primary key, one row per
 * tenant, all data shapes packed into a single jsonb column. The Zod schema
 * is split into tier-1 / tier-2 per Gate-1 K5 (override of the original
 * "Block B with truncation" proposal):
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
 * pass (P8b doesn't wire it — for this commit tier-2 is editable + stored
 * but invisible to the brain). buildBlockB consumes only pickTier1().
 *
 * Atomic JSON patches (`patchOperationalFactsKey`) avoid the read-merge-write
 * race when only one subform is being saved. The current Business Info UI
 * saves the full envelope, so the patch helper is groundwork for later
 * forms (e.g. a dedicated "Hours editor" subform).
 */

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
  // IANA timezone string. Not validated against the IANA list — Postgres
  // / Node both have larger lists than we'd want to ship, and wrong values
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
 * truth — `pickTier1` and the patch helper consult this list. Adding a tier-1
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
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the singleton row for a tenant. Always returns a parsed envelope
 * (possibly empty) — never throws on missing row, never returns null.
 */
export async function getOperationalFacts(args: {
  tenantId: string;
}): Promise<OperationalFactsData> {
  const row = await prisma.operationalFacts.findUnique({
    where: { tenantId: args.tenantId },
    select: { data: true },
  });
  if (!row) return {};
  return parseOperationalFactsData(row.data);
}

/**
 * Full-envelope upsert. The caller is expected to have parsed the input
 * through operationalFactsDataSchema; this helper re-parses defensively.
 *
 * Concurrent writes follow last-write-wins semantics. Use
 * patchOperationalFactsKey for partial saves where atomicity matters.
 */
export async function setOperationalFacts(args: {
  tenantId: string;
  data: OperationalFactsData;
}): Promise<void> {
  const data = operationalFactsDataSchema.parse(args.data);
  await prisma.operationalFacts.upsert({
    where: { tenantId: args.tenantId },
    create: { tenantId: args.tenantId, data: data as Prisma.InputJsonValue },
    update: { data: data as Prisma.InputJsonValue },
  });
}

/**
 * Atomic single-key patch via jsonb_set. The patch path doesn't read-then-
 * write — the SQL UPDATE merges the new key into the existing JSON in one
 * statement, so concurrent edits to other top-level keys can't be clobbered.
 *
 * Pre-validates the value's slice. `value === null` removes the key.
 *
 * NOT used by the current Business Info UI (which saves the full envelope);
 * available for later forms that edit one subsection at a time.
 */
export async function patchOperationalFactsKey<K extends keyof OperationalFactsData>(args: {
  tenantId: string;
  key: K;
  value: OperationalFactsData[K] | null;
}): Promise<void> {
  // Validate the slice via the parent schema's pick.
  if (args.value !== null && args.value !== undefined) {
    const slicePick: Partial<Record<K, unknown>> = { [args.key]: args.value } as Partial<
      Record<K, unknown>
    >;
    operationalFactsDataSchema.partial().parse(slicePick);
  }

  if (args.value === null || args.value === undefined) {
    // jsonb `#-` operator removes a key by path. Insert a no-op default
    // envelope on first write.
    await prisma.$executeRaw`
      INSERT INTO "OperationalFacts" ("tenantId", "data", "createdAt", "updatedAt")
      VALUES (${args.tenantId}, '{}'::jsonb, NOW(), NOW())
      ON CONFLICT ("tenantId") DO UPDATE
        SET "data" = "OperationalFacts"."data" #- ARRAY[${args.key as string}],
            "updatedAt" = NOW()
    `;
    return;
  }

  const json = JSON.stringify(args.value);
  await prisma.$executeRaw`
    INSERT INTO "OperationalFacts" ("tenantId", "data", "createdAt", "updatedAt")
    VALUES (
      ${args.tenantId},
      jsonb_build_object(${args.key as string}::text, ${json}::jsonb),
      NOW(),
      NOW()
    )
    ON CONFLICT ("tenantId") DO UPDATE
      SET "data" = jsonb_set(
            "OperationalFacts"."data",
            ARRAY[${args.key as string}],
            ${json}::jsonb,
            true
          ),
          "updatedAt" = NOW()
  `;
}
