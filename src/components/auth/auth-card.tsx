"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { GoogleIcon } from "./google-icon";
import { MagneticButton } from "./magnetic-button";
import { Badge } from "@/components/ui/badge";
import {
  signInWithEmail,
  signInWithGoogle,
  signInWithPassword,
  type EmailSignInState,
  type PasswordSignInState,
} from "@/server/auth/actions";
import { cn } from "@/lib/utils";
import { easeOutExpo, durationMedium } from "@/lib/motion";

type AuthMode = "login" | "signup";

const COPY: Record<AuthMode, {
  titlePrefix: string;
  subtitle: string;
  cta: string;
  switchPrompt: string;
  switchHref: string;
  switchLabel: string;
}> = {
  login: {
    titlePrefix: "Sign in to ",
    subtitle: "Sign in to your WBP AI workspace.",
    cta: "Email me a magic link",
    switchPrompt: "New to WBP AI?",
    switchHref: "/signup",
    switchLabel: "Create an account",
  },
  signup: {
    titlePrefix: "Get started with ",
    subtitle: "Start replying to customers in 5 minutes.",
    cta: "Email me a magic link",
    switchPrompt: "Already have a WBP AI workspace?",
    switchHref: "/login",
    switchLabel: "Sign in",
  },
};

const initialState: EmailSignInState = { status: "idle" };
const initialPasswordState: PasswordSignInState = { status: "idle" };

const DEFAULT_EYEBROW = "Secure access";

type LoginMethod = "magic-link" | "password";

export function AuthCard({
  mode,
  eyebrow = DEFAULT_EYEBROW,
}: {
  mode: AuthMode;
  eyebrow?: string;
}) {
  const copy = COPY[mode];
  const [state, formAction, pending] = useActionState(signInWithEmail, initialState);
  const [pwState, pwFormAction, pwPending] = useActionState(
    signInWithPassword,
    initialPasswordState,
  );
  // Signup is magic-link / Google only — password sign-up doesn't exist
  // yet (existing accounts set their first password via the reset flow).
  // The method-toggle only renders for login mode.
  const [method, setMethod] = useState<LoginMethod>("magic-link");
  const showPasswordPath = mode === "login" && method === "password";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durationMedium, ease: easeOutExpo }}
      className="w-full max-w-[420px]"
    >
      <div
        className="auth-card-orbit relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] p-8 shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{ backgroundColor: "color-mix(in oklab, var(--bg-surface) 88%, transparent)" }}
      >
        {/* Decorative perimeter light — a conic-gradient "spot" rotates
            around the card's 1px ring on a 6s loop, mask-clipped to the
            border. Reduced-motion users get a static accent gradient
            across the top edge (see globals.css). */}

        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <BrandMark />
            <p className="mt-5 text-caption font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-h2 text-[var(--text-primary)]">
              {copy.titlePrefix}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                WBP AI
              </span>
            </h1>
            <p className="mt-2 text-body text-[var(--text-secondary)]">{copy.subtitle}</p>
          </div>
          <Badge variant="success" size="sm" className="mt-1 shrink-0">
            Protected
          </Badge>
        </div>

        <form action={signInWithGoogle} className="mb-4">
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] px-4 text-body font-medium text-[var(--text-primary)] transition-[background-color,border-color] duration-150 ease-out hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
          >
            <GoogleIcon className="size-5" />
            Continue with Google
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          <span className="text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            or
          </span>
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        {mode === "login" ? (
          <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Sign-in method">
            <MethodTab
              active={method === "magic-link"}
              onClick={() => setMethod("magic-link")}
            >
              Magic link
            </MethodTab>
            <MethodTab
              active={method === "password"}
              onClick={() => setMethod("password")}
            >
              Password
            </MethodTab>
          </div>
        ) : null}

        {showPasswordPath ? (
          <form action={pwFormAction} className="space-y-3" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
                Work email
              </span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                disabled={pwPending}
                aria-invalid={pwState.status === "error" ? true : undefined}
                className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60 aria-[invalid=true]:border-[var(--danger)]"
              />
            </label>
            <label className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-body-sm text-[var(--text-secondary)]">
                  Password
                </span>
                <Link
                  href="/reset-password"
                  className="text-caption font-medium text-[var(--accent-hover)] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                disabled={pwPending}
                aria-invalid={pwState.status === "error" ? true : undefined}
                className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60 aria-[invalid=true]:border-[var(--danger)]"
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
          </form>
        ) : (
          <form action={formAction} className="space-y-3" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
                Work email
              </span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                disabled={pending}
                className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60"
              />
            </label>

            {state.status === "error" ? (
              <p role="alert" className="text-body-sm text-[var(--danger)]">
                {state.message}
              </p>
            ) : null}

            <MagneticButton type="submit" pending={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                copy.cta
              )}
            </MagneticButton>
          </form>
        )}

        <p className="mt-6 text-center text-body-sm text-[var(--text-tertiary)]">
          {copy.switchPrompt}{" "}
          <Link
            href={copy.switchHref}
            className="font-medium text-[var(--accent-hover)] underline-offset-4 hover:text-[var(--accent-base)] hover:underline"
          >
            {copy.switchLabel}
          </Link>
        </p>
      </div>

      <p className="mt-6 text-center text-caption text-[var(--text-tertiary)]">
        By continuing you agree to the terms of service and privacy policy.
      </p>
    </motion.div>
  );
}

/**
 * Two-up segmented tab for picking sign-in method (magic link vs
 * password). Visually mirrors the language pills on the playground
 * — same role="tab" + aria-selected pattern.
 */
function MethodTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-md px-3 text-body-sm font-medium",
        "transition-[background-color,color,border-color] duration-150 ease-out",
        "border",
        active
          ? "border-[color-mix(in_oklab,var(--accent-base)_40%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * WBP brand mark — a 56×56 cell hosting the WBP logo PNG. If /wbp.png is
 * missing (dev convenience), falls back to a "W" glyph against a subtle
 * elevated surface so the card still reads as a brand mark. Logo path is
 * hardcoded because the auth surfaces are platform-branded (pre-tenant);
 * per-tenant logos resolve via the tenant-brands manifest in the operator
 * app.
 *
 * Rendered with Next/Image `fill` inside a sized `relative` wrapper so the
 * intrinsic image dimensions can't collapse the visible size. The wrapper
 * stays transparent (no border / no surface): the logo on the card's own
 * surface reads cleanest. The error fallback keeps a soft elevated tile
 * because a bare letter floating on the card looks unbalanced.
 */
function BrandMark() {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-md bg-[var(--bg-surface-elevated)] text-h3 font-semibold text-[var(--text-primary)]"
      >
        W
      </div>
    );
  }
  return (
    <div aria-hidden className="relative h-14 w-14 flex-shrink-0">
      <Image
        src="/wbp.png"
        alt="WBP"
        fill
        sizes="56px"
        priority
        className="object-contain"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
