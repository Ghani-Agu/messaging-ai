"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import type { AiBehavior } from "@/lib/validators";
import { updateAiBehaviorAction } from "@/server/settings/actions";
import { cn } from "@/lib/utils";

type ToggleDef = {
  key: keyof AiBehavior;
  label: string;
  description: string;
};

const TOGGLES: ToggleDef[] = [
  {
    key: "showPrices",
    label: "Show product prices",
    description:
      "When OFF, the AI says 'available' instead of showing exact prices. Customers contact your team for quotes.",
  },
  {
    key: "showStockCounts",
    label: "Show stock counts",
    description:
      "When OFF, the AI says 'available' or 'not available' without exact counts. Recommended for most businesses.",
  },
  {
    key: "requireHumanForOrders",
    label: "Require human for orders",
    description:
      "When ON, the AI never confirms purchases — it escalates order requests to your team contacts.",
  },
];

function shallowEqual(a: AiBehavior, b: AiBehavior): boolean {
  return (
    a.showPrices === b.showPrices &&
    a.showStockCounts === b.showStockCounts &&
    a.requireHumanForOrders === b.requireHumanForOrders
  );
}

export function AiBehaviorForm({
  tenantSlug,
  initial,
  canEdit,
}: {
  tenantSlug: string;
  initial: AiBehavior;
  canEdit: boolean;
}) {
  const [values, setValues] = useState<AiBehavior>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Keep state in sync if the server-component data refreshes underneath
  // (e.g. after revalidatePath fires).
  useEffect(() => {
    setValues(initial);
  }, [initial]);

  // Fade out the "Saved" indicator after a couple seconds.
  useEffect(() => {
    if (!showSaved) return;
    const t = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(t);
  }, [showSaved]);

  const dirty = !shallowEqual(values, initial);
  const disabled = !canEdit || pending;

  function toggle(key: keyof AiBehavior): void {
    if (disabled) return;
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSave(): void {
    setError(null);
    startTransition(async () => {
      try {
        await updateAiBehaviorAction({ tenantSlug, aiBehavior: values });
        setShowSaved(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to save AI behavior. Try again.",
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <ul
        role="list"
        className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      >
        {TOGGLES.map((t) => {
          const checked = values[t.key];
          return (
            <li
              key={t.key}
              className="flex items-start justify-between gap-6 px-4 py-4"
            >
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-[var(--text-primary)]">
                  {t.label}
                </p>
                <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
                  {t.description}
                </p>
              </div>
              <SwitchControl
                checked={checked}
                onChange={() => toggle(t.key)}
                disabled={disabled}
                ariaLabel={t.label}
              />
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || !dirty}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md px-4 text-body-sm font-medium",
            "transition-[background-color,box-shadow] duration-150 ease-out",
            "bg-[var(--accent-base)] text-white",
            "hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]",
            "active:bg-[var(--accent-active)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none",
          )}
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save AI behavior"
          )}
        </button>
        {showSaved ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]"
          >
            <Check className="size-4" aria-hidden />
            Saved
          </span>
        ) : null}
        {!canEdit ? (
          <span className="text-body-sm text-[var(--text-tertiary)]">
            Only owners can edit AI behavior.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SwitchControl({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full",
        "transition-colors duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]",
        checked
          ? "bg-[var(--accent-base)] hover:bg-[var(--accent-hover)]"
          : "bg-[var(--border-default)] hover:bg-[var(--border-strong)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow-sm",
          "transition-transform duration-150 ease-out",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
