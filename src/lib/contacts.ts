/**
 * Contact schemas + pure helpers.
 *
 * Lives in src/lib/ rather than src/server/db/ for the same reason
 * src/lib/items.ts does: client components on the Contacts page reach
 * these types directly, and `"server-only"` would trip the bundler
 * even on `import type` paths. The server-side DB layer
 * (src/server/db/contacts.ts) keeps the Prisma helpers + re-exports
 * the schemas / types from here for source-compat with existing
 * server-side callers (Server Actions, orchestrator).
 */

import { z } from "zod";
import type { Contact } from "@prisma/client";

/**
 * Email regex — pragmatic, not exhaustive. Catches the common
 * malformations (missing @, no TLD, whitespace) without trying to
 * reproduce RFC 5322. Anything that passes here will at minimum
 * route through an email client without crashing.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const phoneSchema = z.string().trim().min(1).max(60).optional();
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v.length === 0 || EMAIL_REGEX.test(v), {
    message: "Invalid email format",
  })
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

/**
 * Create / update payload. `at-least-one-of(phone, email)` is enforced
 * via `.superRefine` so the error attaches to the form-level path
 * rather than to a single field (operators see the constraint as a
 * row-level rule, not a phone-or-email field complaint).
 */
export const contactInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    phone: phoneSchema,
    email: emailSchema,
    role: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).max(9999).default(0),
  })
  .superRefine((data, ctx) => {
    const hasPhone = data.phone && data.phone.length > 0;
    const hasEmail = data.email && data.email.length > 0;
    if (!hasPhone && !hasEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least a phone number or an email address",
        path: ["phone"],
      });
    }
  });
export type ContactInput = z.infer<typeof contactInputSchema>;

/**
 * Read shape — what both Server Components (page reads) and client UI
 * (cards / forms) consume. Mirrors KnowledgeItem -> ItemSummary in
 * src/lib/items.ts.
 */
export type ContactSummary = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toContactSummary(row: Contact): ContactSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Cap on how many contacts ride the prompt per call. ~25 tokens each at the
 * citation render shape, so a cap of 6 gives ~150 tokens of contact context —
 * cheap relative to the 8000-token input budget, and operators rarely curate
 * more than a small set of escalation targets per tenant. */
export const MAX_CONTACTS_IN_PROMPT = 6;
