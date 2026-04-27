"use server";

import { z } from "zod";
import { signIn, signOut } from "@/server/auth";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");

export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/post-auth" });
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
  await signIn("resend", { email: parsed.data, redirectTo: "/post-auth" });
  return { status: "idle" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
