import { z } from "zod";
import { canonicalizeOrigin } from "@/lib/validators";

/**
 * Maximum number of origins per widget channel. Mirrors
 * widgetChannelConfigSchema.originsAllowlist.max(20) so the read-side
 * (parseWidgetChannelConfig) and the write-side (this parser) agree;
 * a row that somehow ends up with > 20 entries fails on read either way.
 */
export const ORIGIN_MAX_COUNT = 20;

/**
 * Hard request-size guard on the raw textarea body. Not a logical limit on
 * how many origins can be entered (that's ORIGIN_MAX_COUNT) — purely a
 * defense against a client posting megabytes of junk into a Server Action.
 * 4096 chars accommodates ~20 origins of average length plus padding.
 */
const ORIGINS_TEXT_MAX_BYTES = 4096;

/**
 * Parse the raw textarea string into a canonicalized, deduped, capped list.
 * Splits on commas AND newlines (legitimate scheme://host[:port] origins
 * cannot contain either character, so this is unambiguous).
 *
 * Per-entry errors carry `path: ["origins", origIndex]` where `origIndex`
 * is the entry's position in the post-split, post-trim, post-empty-filter
 * sequence — which is what the UI renders as "Line N" under the textarea.
 *
 * Output is the canonicalized, deduped string array — ready to hand to
 * upsertWidgetChannel.
 */
export const originsTextSchema = z
  .string()
  .max(ORIGINS_TEXT_MAX_BYTES, "Origins input is unreasonably long")
  .transform((raw, ctx) => {
    const entries = raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((raw, idx) => ({ raw, idx }));

    if (entries.length > ORIGIN_MAX_COUNT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Maximum ${ORIGIN_MAX_COUNT} origins; you entered ${entries.length}.`,
      });
      return z.NEVER;
    }

    const seen = new Set<string>();
    const out: string[] = [];
    let hadIssue = false;
    for (const e of entries) {
      let canonical: string;
      try {
        canonical = canonicalizeOrigin(e.raw);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["origins", e.idx],
          message: `"${e.raw}" is not a valid origin (${(err as Error).message})`,
        });
        hadIssue = true;
        continue;
      }
      if (!seen.has(canonical)) {
        seen.add(canonical);
        out.push(canonical);
      }
    }
    if (hadIssue) return z.NEVER;
    return out;
  });
