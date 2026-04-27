"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { GoogleIcon } from "./google-icon";
import { MagneticButton } from "./magnetic-button";
import {
  signInWithEmail,
  signInWithGoogle,
  type EmailSignInState,
} from "@/server/auth/actions";
import { easeOutExpo, durationMedium } from "@/lib/motion";

type AuthMode = "login" | "signup";

const COPY: Record<AuthMode, {
  title: string;
  subtitle: string;
  cta: string;
  switchPrompt: string;
  switchHref: string;
  switchLabel: string;
}> = {
  login: {
    title: "Welcome back",
    subtitle: "Sign in to your messaging-ai workspace.",
    cta: "Email me a magic link",
    switchPrompt: "New to messaging-ai?",
    switchHref: "/signup",
    switchLabel: "Create an account",
  },
  signup: {
    title: "Create your workspace",
    subtitle: "Start replying to customers in 5 minutes.",
    cta: "Email me a magic link",
    switchPrompt: "Already have an account?",
    switchHref: "/login",
    switchLabel: "Sign in",
  },
};

const initialState: EmailSignInState = { status: "idle" };

export function AuthCard({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const [state, formAction, pending] = useActionState(signInWithEmail, initialState);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durationMedium, ease: easeOutExpo }}
      className="w-full max-w-[420px]"
    >
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{ backgroundColor: "color-mix(in oklab, var(--bg-surface) 88%, transparent)" }}
      >
        <div className="mb-6 space-y-2">
          <h1 className="text-h2 text-[var(--text-primary)]">{copy.title}</h1>
          <p className="text-body text-[var(--text-secondary)]">{copy.subtitle}</p>
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
