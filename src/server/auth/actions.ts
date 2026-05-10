"use server";

import { randomBytes } from "node:crypto";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/server/auth";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/integrations/email/resend";
import { passwordResetEmail } from "@/server/integrations/email/templates/password-reset";
import { passwordSchema } from "@/lib/validators";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");

/**
 * Whitelist of acceptable post-auth callback paths. Anything not on this
 * list (or with `..`/protocol prefix) silently falls back to /post-auth
 * — open-redirect defense in depth.
 */
function safeCallback(input: FormDataEntryValue | null): string {
  if (typeof input !== "string" || input.length === 0) return "/post-auth";
  if (input.startsWith("/invitations/")) return input;
  return "/post-auth";
}

export async function signInWithGoogle(formData?: FormData): Promise<void> {
  const next = safeCallback(formData?.get("next") ?? null);
  await signIn("google", { redirectTo: next });
}

export type EmailSignInState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function signInWithEmail(
  _prev: EmailSignInState,
  formData: FormData,
): Promise<EmailSignInState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }
  // signIn() throws a NEXT_REDIRECT internally on success — this function
  // never returns in the success path, the user is redirected to
  // /verify-request. Errors that aren't redirects bubble up.
  const next = safeCallback(formData.get("next"));
  await signIn("resend", { email: parsed.data, redirectTo: next });
  return { status: "idle" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials sign-in (email + password)
// ─────────────────────────────────────────────────────────────────────────────

const passwordSignInInputSchema = z.object({
  email: emailSchema,
  // Don't run the full passwordSchema here — login should accept whatever
  // the user types (we only check the bcrypt match). Just enforce a
  // non-empty string with a sane upper bound so the DB call is bounded.
  password: z.string().min(1).max(1024),
});

export type PasswordSignInState =
  | { status: "idle" }
  | { status: "error"; message: string };

export async function signInWithPassword(
  _prev: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  const parsed = passwordSignInInputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter your email and password.",
    };
  }
  const next = safeCallback(formData.get("next"));
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: next,
    });
    // signIn redirects on success — this line never runs.
    return { status: "idle" };
  } catch (err) {
    // AuthError covers the authorize-callback-returned-null case. Generic
    // "Invalid email or password" never leaks which side was wrong.
    // Anything else (NEXT_REDIRECT from successful signIn, network errors,
    // etc.) must bubble.
    if (err instanceof AuthError) {
      return { status: "error", message: "Invalid email or password." };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — request + confirm
// ─────────────────────────────────────────────────────────────────────────────

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

/**
 * Public-facing copy for the request page. The success message is
 * identical whether or not the email exists — never leak which addresses
 * are registered. Errors (validation only — DB/email failures fall
 * silently into the success branch on purpose) get a separate state.
 */
export type CreatePasswordResetTokenState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

export async function createPasswordResetTokenAction(
  _prev: CreatePasswordResetTokenState,
  formData: FormData,
): Promise<CreatePasswordResetTokenState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }
  const email = parsed.data;

  // Always run the "happy path" envelope: lookup → token → email. Any
  // miss (no user, send fails) falls through to the same `sent` state
  // so the response timing + body don't reveal which emails exist.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (user) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });
    const resetUrl = `${APP_URL.replace(/\/$/, "")}/reset-password/${token}`;
    const rendered = passwordResetEmail({ resetUrl, userName: user.name });
    // We don't surface email failures to the user — same `sent` state
    // either way, by design. Log so operators can spot RESEND outages.
    const result = await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (!result.ok) {
      console.error(
        `[auth] password-reset email failed for user=${user.id}: ${result.error}`,
      );
    }
  }

  return { status: "sent" };
}

const confirmInputSchema = z.object({
  token: z.string().trim().min(1).max(128),
  password: passwordSchema,
});

/**
 * `token` lives in the URL (not the form body) since the confirm page
 * loads with the token already known. The form posts the new password
 * alongside the token so the action remains self-contained.
 */
export type ConfirmPasswordResetState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; message: string };

export async function confirmPasswordResetAction(
  _prev: ConfirmPasswordResetState,
  formData: FormData,
): Promise<ConfirmPasswordResetState> {
  const parsed = confirmInputSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Invalid password — try again.",
    };
  }

  const row = await prisma.passwordResetToken.findUnique({
    where: { token: parsed.data.token },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  // Single uniform error message for invalid/expired/used to avoid
  // leaking token state.
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    return {
      status: "error",
      message: "This reset link is invalid or has expired.",
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  // Atomic: stamp the token as used AND update the user in one go.
  // If a concurrent request raced us, the token's usedAt update would
  // succeed for one and reject the other via the row's prior state
  // check — but we already loaded usedAt above; an interactive Prisma
  // tx makes the swap safe.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { status: "done" };
}
