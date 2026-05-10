"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { signInWithEmail, signInWithGoogle, signInWithPassword } from "@/server/auth/actions";
import { GoogleIcon } from "./google-icon";
import { MagneticButton } from "./magnetic-button";

const initialEmailState = { status: "idle" as const };
const initialPwState = { status: "idle" as const };

/**
 * Sign-in card rendered on the `/invitations/[token]` page when the
 * visitor isn't logged in. Mirrors AuthCard's three options (Google /
 * magic link / password) but every method carries the invitation token
 * through as a callback URL so the post-auth bounce lands back here and
 * auto-accepts.
 *
 * The callback URL points to /invitations/<token> — when the user
 * returns post-auth their session is set, the page rerenders, the
 * "PENDING + session.user.email matches" branch fires, and
 * acceptInvitationAction completes the join.
 */
export function InvitationSignInCard({
  token,
  tenantName,
  inviteeEmail,
  role,
  inviterName,
}: {
  token: string;
  tenantName: string;
  inviteeEmail: string;
  role: string;
  inviterName: string | null;
}) {
  const [emailState, emailFormAction, emailPending] = useActionState(
    signInWithEmail,
    initialEmailState,
  );
  const [pwState, pwFormAction, pwPending] = useActionState(
    signInWithPassword,
    initialPwState,
  );

  const inviter = inviterName?.trim() || "Someone";

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
          Invitation
        </p>
        <h1 className="mt-2 text-h2 text-[var(--text-primary)]">
          Join {tenantName}
        </h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          {inviter} invited{" "}
          <strong className="text-[var(--text-primary)]">{inviteeEmail}</strong>{" "}
          as a {role.toLowerCase()}. Sign in to accept.
        </p>

        <form action={signInWithGoogle} className="mt-6 mb-4">
          <input type="hidden" name="next" value={`/invitations/${token}`} />
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] px-4 text-body font-medium text-[var(--text-primary)] transition-[background-color,border-color] duration-150 ease-out hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-overlay)]"
          >
            <GoogleIcon className="size-5" />
            Continue with Google
          </button>
        </form>

        <details className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-body-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Use email + password
          </summary>
          <form action={pwFormAction} className="space-y-3 px-4 pb-4" noValidate>
            <input type="hidden" name="next" value={`/invitations/${token}`} />
            <label className="block">
              <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
                Email
              </span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                defaultValue={inviteeEmail}
                disabled={pwPending}
                className="block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
                Password
              </span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                disabled={pwPending}
                className="block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]"
              />
            </label>
            {pwState.status === "error" ? (
              <p role="alert" className="text-body-sm text-[var(--danger)]">
                {pwState.message}
              </p>
            ) : null}
            <MagneticButton type="submit" pending={pwPending}>
              {pwPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </MagneticButton>
            <p className="text-caption text-[var(--text-tertiary)]">
              Don&apos;t have a password yet?{" "}
              <Link
                href="/reset-password"
                className="font-medium text-[var(--accent-hover)] hover:underline"
              >
                Set one
              </Link>{" "}
              and come back.
            </p>
          </form>
        </details>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          <span className="text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            or
          </span>
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        <form action={emailFormAction} className="space-y-3" noValidate>
          <input type="hidden" name="next" value={`/invitations/${token}`} />
          <label className="block">
            <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
              Email me a magic link
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              defaultValue={inviteeEmail}
              disabled={emailPending}
              className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)]"
            />
          </label>
          {emailState.status === "error" ? (
            <p role="alert" className="text-body-sm text-[var(--danger)]">
              {emailState.message}
            </p>
          ) : null}
          <MagneticButton type="submit" pending={emailPending}>
            {emailPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Email me a magic link"
            )}
          </MagneticButton>
        </form>

        <p className="mt-6 text-caption text-[var(--text-tertiary)]">
          Token: <span className="font-mono">{token.slice(0, 8)}…</span>
        </p>
      </div>
    </div>
  );
}
