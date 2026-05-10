"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import {
  confirmPasswordResetAction,
  type ConfirmPasswordResetState,
} from "@/server/auth/actions";
import { MagneticButton } from "./magnetic-button";

const initialState: ConfirmPasswordResetState = { status: "idle" };

export function ResetPasswordConfirmForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    confirmPasswordResetAction,
    initialState,
  );

  if (state.status === "done") {
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
                "color-mix(in oklab, var(--success) 20%, transparent)",
              color: "var(--success)",
            }}
          >
            <Check className="size-6" />
          </div>
          <h1 className="mb-2 text-h2 text-[var(--text-primary)]">
            Password updated
          </h1>
          <p className="text-body text-[var(--text-secondary)]">
            You can now sign in with your new password.
          </p>
          <div className="mt-6">
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--accent-base)] px-6 text-body font-medium text-white transition-colors duration-150 ease-out hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              Continue to sign in
            </Link>
          </div>
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
        <div
          aria-hidden
          className="mb-6 flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--accent-base) 20%, transparent)",
            color: "var(--accent-hover)",
          }}
        >
          <ShieldCheck className="size-6" />
        </div>
        <h1 className="text-h2 text-[var(--text-primary)]">
          Set a new password
        </h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Pick a password that&apos;s at least 8 characters and includes a
          letter and a digit.
        </p>

        <form action={formAction} className="mt-6 space-y-3" noValidate>
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
              New password
            </span>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              disabled={pending}
              aria-invalid={error ? true : undefined}
              className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60 aria-[invalid=true]:border-[var(--danger)]"
            />
          </label>
          <p className="text-caption text-[var(--text-tertiary)]">
            8+ characters, at least one letter and one digit. Common
            passwords like &quot;password&quot; or &quot;qwerty&quot; are
            not accepted.
          </p>

          {error ? (
            <p role="alert" className="text-body-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <MagneticButton type="submit" pending={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save new password"
            )}
          </MagneticButton>
        </form>

        <p className="mt-6 text-center text-body-sm text-[var(--text-tertiary)]">
          Link expired?{" "}
          <Link
            href="/reset-password"
            className="font-medium text-[var(--accent-hover)] hover:underline"
          >
            Request a new one
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
