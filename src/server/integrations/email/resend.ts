import "server-only";
import { Resend } from "resend";

/**
 * Transactional-email wrapper around the Resend SDK. Separate from the
 * NextAuth `Resend` provider (which lives in src/server/auth/config.ts
 * and manages magic-link emails directly via NextAuth's own transport)
 * — this module is for our app-side mail like password reset, employee
 * invitation (Commit B), etc.
 *
 * RESEND_API_KEY missing → resend stays null and sendEmail returns
 * ok=false with a clear error. Wrapped in a getter so server modules
 * that import this file don't crash at import time during local dev
 * when the key isn't set.
 */

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey && process.env.NODE_ENV !== "test") {
  // One-line warn at module load when the env var is missing in real
  // runs. In tests we never want the spam; vitest sets NODE_ENV=test.
  console.warn("[email] RESEND_API_KEY not set — emails will not send");
}

export const resend: Resend | null = apiKey ? new Resend(apiKey) : null;

/**
 * Sender address. Resend's shared sandbox sender (`onboarding@resend.dev`)
 * only delivers to the email tied to the Resend account; project lead must
 * set EMAIL_FROM to a verified-domain address before staging/prod.
 */
export const FROM_EMAIL = process.env.EMAIL_FROM ?? "onboarding@resend.dev";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { ok: true } | { ok: false; error: string };

/**
 * Send a transactional email. Both `html` and `text` are required — plain
 * text fallback meaningfully improves deliverability with strict spam
 * filters and degrades gracefully in text-only clients.
 *
 * Never throws: failures (missing key, Resend API error, network) come
 * back as `{ ok: false, error }` so callers can decide whether to
 * surface, log, or retry. The reset-flow Server Action treats email
 * failure as non-fatal (we don't want to leak which addresses exist).
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (!resend) {
    return { ok: false, error: "Resend not configured" };
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown email error",
    };
  }
}
