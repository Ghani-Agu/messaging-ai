import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./client";
import {
  operationalFactsDataSchema,
  parseOperationalFactsData,
  type OperationalFactsData,
} from "@/lib/operational-facts";

/**
 * OperationalFacts DB layer (Phase 8b — Type 5).
 *
 * Singleton per tenant: tenantId is the table's primary key, one row per
 * tenant, all data shapes packed into a single jsonb column.
 *
 * The Zod schemas + tier helpers live in src/lib/operational-facts.ts so the
 * Business Info client form can import them — `"server-only"` would trip the
 * bundler even on `import type` paths from a client component. This module
 * re-exports them for callers that previously imported from the server file
 * (orchestrator, tests).
 *
 * Atomic JSON patches (`patchOperationalFactsKey`) avoid the read-merge-write
 * race when only one subform is being saved. The current Business Info UI
 * saves the full envelope, so the patch helper is groundwork for later
 * forms (e.g. a dedicated "Hours editor" subform).
 */

// Re-exports — keeps existing import sites working without churn.
export {
  DAY_OF_WEEK,
  TIER1_KEYS,
  operationalFactsContactSchema,
  operationalFactsDataSchema,
  operationalFactsExceptionSchema,
  operationalFactsHoursDaySchema,
  operationalFactsHoursSchema,
  operationalFactsLocationSchema,
  operationalFactsTier1Schema,
  operationalFactsTier2Schema,
  parseOperationalFactsData,
  pickTier1,
} from "@/lib/operational-facts";
export type {
  DayOfWeek,
  OperationalFactsContact,
  OperationalFactsData,
  OperationalFactsException,
  OperationalFactsHours,
  OperationalFactsLocation,
  OperationalFactsTier1,
  OperationalFactsTier2,
} from "@/lib/operational-facts";

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
