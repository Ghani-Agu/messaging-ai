"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import {
  createPasswordResetTokenAction,
  type CreatePasswordResetTokenState,
} from "@/server/auth/actions";
import { MagneticButton } from "./magnetic-button";

const initialState: CreatePasswordResetTokenState = { status: "idle" };

export function ResetPasswordRequestForm() {
  const [state, formAction, pending] = useActionState(
    createPasswordResetTokenAction,
    initialState,
  );

  // "sent" is the success state — same copy whether the email matched a
  // real user or not, by design (see action doc-comment).
  if (state.status === "sent") {
    return (
      <div className="w-full max-w-[420px]">
        <div
          className="rounded-2xl border border-[var(--border-subtle)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
          }}
        >
          <div
            aria-hidden
            className="mx-auto mb-6 flex size-12 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--accent-base) 20%, transparent)",
              color: "var(--accent-hover)",
            }}
          >
            <Mail className="size-6" />
          </div>
          <h1 className="mb-2 text-h2 text-[var(--text-primary)]">
            Check your email
          </h1>
          <p className="text-body text-[var(--text-secondary)]">
            If an account exists with that email, we sent a reset link.
            It expires in 1 hour.
          </p>
          <p className="mt-6 text-body-sm text-[var(--text-tertiary)]">
            Didn&apos;t get it? Check spam, or{" "}
            <Link
              href="/reset-password"
              className="font-medium text-[var(--accent-hover)] hover:underline"
            >
              try another email
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : null;

  return (
    <div className="w-full max-w-[420px]">
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
        }}
      >
        <p className="text-caption font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
          Account recovery
        </p>
        <h1 className="mt-2 text-h2 text-[var(--text-primary)]">
          Reset your password
        </h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Enter the email tied to your account. We&apos;ll send you a
          one-time link to set a new password.
        </p>

        <form action={formAction} className="mt-6 space-y-3" noValidate>
          <label className="block">
            <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
              Email
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              disabled={pending}
              aria-invalid={error ? true : undefined}
              className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60 aria-[invalid=true]:border-[var(--danger)]"
            />
          </label>

          {error ? (
            <p role="alert" className="text-body-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <MagneticButton type="submit" pending={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </MagneticButton>
        </form>

        <p className="mt-6 text-center text-body-sm text-[var(--text-tertiary)]">
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-[var(--accent-hover)] hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
