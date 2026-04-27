"use client";

import { motion } from "framer-motion";
import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MagneticButton } from "@/components/auth/magnetic-button";
import {
  createTenantAction,
  type CreateTenantState,
} from "@/server/tenancy/actions";
import { suggestSlug } from "@/lib/slug";
import { durationMedium, easeOutExpo } from "@/lib/motion";

const initial: CreateTenantState = { status: "idle" };

export function CreateTenantCard({ userEmail }: { userEmail: string | null }) {
  const [state, formAction, pending] = useActionState(createTenantAction, initial);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Track whether the user has manually edited the slug; once they have, we
  // stop auto-syncing from name.
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (slugTouched) return;
    setSlug(suggestSlug(name));
  }, [name, slugTouched]);

  const fieldError = (field: "name" | "slug") =>
    state.status === "error" && state.field === field ? state.message : null;

  const formError =
    state.status === "error" && (!state.field || state.field === "form")
      ? state.message
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durationMedium, ease: easeOutExpo }}
      className="w-full max-w-[480px]"
    >
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
        }}
      >
        <div className="mb-6 space-y-2">
          <h1 className="text-h2 text-[var(--text-primary)]">
            Name your workspace
          </h1>
          <p className="text-body text-[var(--text-secondary)]">
            {userEmail
              ? `Signed in as ${userEmail}. `
              : ""}
            One workspace per company. You can invite teammates later.
          </p>
        </div>

        <form action={formAction} className="space-y-4" noValidate>
          <label className="block">
            <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
              Workspace name
            </span>
            <input
              type="text"
              name="name"
              required
              maxLength={64}
              autoFocus
              autoComplete="organization"
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              aria-invalid={fieldError("name") ? true : undefined}
              className="block h-11 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3.5 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30 disabled:opacity-60 aria-[invalid=true]:border-[var(--danger)]"
            />
            {fieldError("name") ? (
              <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
                {fieldError("name")}
              </p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
              Workspace URL
            </span>
            <div className="flex items-stretch overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] transition-colors duration-150 ease-out focus-within:border-[var(--accent-base)] focus-within:ring-2 focus-within:ring-[var(--accent-base)]/30 hover:border-[var(--border-strong)] aria-[invalid=true]:border-[var(--danger)]"
              aria-invalid={fieldError("slug") ? true : undefined}>
              <span className="flex items-center pl-3.5 text-body text-[var(--text-tertiary)]">
                messaging-ai.app/
              </span>
              <input
                type="text"
                name="slug"
                required
                minLength={2}
                maxLength={32}
                autoComplete="off"
                placeholder="acme"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  if (!slugTouched) setSlugTouched(true);
                }}
                disabled={pending}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                className="block h-11 w-full bg-transparent px-1 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none disabled:opacity-60"
              />
            </div>
            {fieldError("slug") ? (
              <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
                {fieldError("slug")}
              </p>
            ) : (
              <p className="mt-1.5 text-body-sm text-[var(--text-tertiary)]">
                Lowercase letters, numbers, and hyphens. You can change this later.
              </p>
            )}
          </label>

          {formError ? (
            <p role="alert" className="text-body-sm text-[var(--danger)]">
              {formError}
            </p>
          ) : null}

          <MagneticButton type="submit" pending={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating workspace…
              </>
            ) : (
              "Create workspace"
            )}
          </MagneticButton>
        </form>
      </div>
    </motion.div>
  );
}
