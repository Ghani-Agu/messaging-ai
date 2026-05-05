"use client";

import { useState, useTransition } from "react";
import { Check, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { saveOperationalFacts } from "@/server/knowledge/operational-facts/actions";
import {
  DAY_OF_WEEK,
  type DayOfWeek,
  operationalFactsDataSchema,
  type OperationalFactsData,
  type OperationalFactsLocation,
} from "@/lib/operational-facts";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/validators";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

/**
 * Business Info — Operational Facts admin surface (Phase 8b).
 *
 * Two visual sections matching the tier-1 / tier-2 split (Gate-1 K5):
 *
 *   "Always shown to your AI" (tier-1) — appears in Block B every prompt:
 *     displayName, primaryLanguage, primaryContact, languagesServed.
 *
 *   "Used when relevant" (tier-2) — stored now; will be retrieved into
 *     Block C when retrieval lands later: hours (tz + weekly schedule),
 *     locations, currency, serviceArea.
 *
 * One submit saves the full envelope. Atomic single-key patches
 * (db/operational-facts.ts) are wired but unused here — they're for future
 * focused subform editors.
 *
 * AGENT-floor is enforced server-side; canEdit gates the UI affordances.
 */

const LANG_LABELS: Record<SupportedLanguage, string> = {
  ar: "Arabic (MSA)",
  fr: "French",
  en: "English",
  darija: "Algerian Darija",
};

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

export function BusinessInfoClient({
  tenantSlug,
  initialData,
  canEdit,
}: {
  tenantSlug: string;
  initialData: OperationalFactsData;
  canEdit: boolean;
}) {
  const [data, setData] = useState<OperationalFactsData>(initialData);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  function update<K extends keyof OperationalFactsData>(
    key: K,
    value: OperationalFactsData[K] | undefined,
  ) {
    setData((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit) return;
    // Pre-validate locally; surface zod error messages without a round trip.
    const parse = operationalFactsDataSchema.safeParse(data);
    if (!parse.success) {
      setStatus({
        kind: "error",
        message: parse.error.issues[0]?.message ?? "Invalid form data",
      });
      return;
    }
    setStatus({ kind: "pending" });
    startTransition(async () => {
      try {
        await saveOperationalFacts(tenantSlug, parse.data);
        setStatus({ kind: "saved", at: Date.now() });
        // Auto-clear the "Saved" pill after 2s.
        setTimeout(() => {
          setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
        }, 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save";
        setStatus({ kind: "error", message: msg });
      }
    });
  }

  const pending = status.kind === "pending";

  return (
    <PageShell width="3xl">
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <PageHeader
          eyebrow={<Eyebrow>Knowledge</Eyebrow>}
          title="Business Info"
          description="What your AI knows about your business — name, contact, hours, languages. Tier-1 facts are included in every reply prompt; tier-2 facts are pulled in when a customer's question needs them."
        />

      {/* Tier 1 ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Always shown to your AI</CardTitle>
            <span className="rounded-full border border-[var(--accent-base)]/40 bg-[var(--accent-glow)]/30 px-2 py-0.5 text-caption text-[var(--accent-hover)]">
              tier 1
            </span>
          </div>
          <CardDescription>
            Identity-shaped fields the AI sees on every customer message. Keep this set tight.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Display name" hint="What the AI calls your business in replies. Falls back to your workspace name when blank.">
            <TextInput
              value={data.displayName ?? ""}
              onChange={(v) => update("displayName", v.trim() || undefined)}
              maxLength={120}
              disabled={!canEdit || pending}
              placeholder="e.g. Acme Distribution"
            />
          </Field>

          <Field label="Primary language" hint="The language the AI replies in when the customer's intent is ambiguous.">
            <LanguageSelect
              value={data.primaryLanguage}
              onChange={(v) => update("primaryLanguage", v)}
              disabled={!canEdit || pending}
            />
          </Field>

          <Field label="Languages served" hint="Languages the AI is allowed to switch between. Customers messaging in any of these get a reply in their language.">
            <LanguagesMultiselect
              value={data.languagesServed ?? []}
              onChange={(v) => update("languagesServed", v.length > 0 ? v : undefined)}
              disabled={!canEdit || pending}
            />
          </Field>

          <Field label="Primary contact (for human handoff)" hint="What the AI offers when escalating to a human. Any subset is fine — name, email, phone.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextInput
                value={data.primaryContact?.name ?? ""}
                onChange={(v) =>
                  update("primaryContact", normalizeContact({ ...data.primaryContact, name: v.trim() || undefined }))
                }
                maxLength={120}
                disabled={!canEdit || pending}
                placeholder="Name (e.g. Ops Desk)"
              />
              <TextInput
                value={data.primaryContact?.email ?? ""}
                onChange={(v) =>
                  update("primaryContact", normalizeContact({ ...data.primaryContact, email: v.trim() || undefined }))
                }
                maxLength={255}
                type="email"
                disabled={!canEdit || pending}
                placeholder="Email"
              />
              <TextInput
                value={data.primaryContact?.phone ?? ""}
                onChange={(v) =>
                  update("primaryContact", normalizeContact({ ...data.primaryContact, phone: v.trim() || undefined }))
                }
                maxLength={64}
                disabled={!canEdit || pending}
                placeholder="Phone"
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      {/* Tier 2 ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Used when relevant</CardTitle>
            <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-caption text-[var(--text-tertiary)]">
              tier 2
            </span>
          </div>
          <CardDescription>
            Heavier facts pulled in only when the customer&apos;s question needs them
            (e.g. asking about hours or locations). Editable now; the retrieval pass that
            wires them into replies lands in a later commit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <HoursSection
            tz={data.hours?.tz ?? ""}
            weekly={data.hours?.weekly ?? []}
            disabled={!canEdit || pending}
            onChange={(next) => update("hours", next)}
          />

          <LocationsSection
            locations={data.locations ?? []}
            disabled={!canEdit || pending}
            onChange={(next) => update("locations", next.length > 0 ? next : undefined)}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Currency" hint="ISO 4217 code (e.g. DZD, USD).">
              <TextInput
                value={data.currency ?? ""}
                onChange={(v) => update("currency", v.trim().toUpperCase() || undefined)}
                maxLength={8}
                disabled={!canEdit || pending}
                placeholder="DZD"
              />
            </Field>
            <Field label="Service area" hint="Where you operate (free text).">
              <TextInput
                value={data.serviceArea ?? ""}
                onChange={(v) => update("serviceArea", v.trim() || undefined)}
                maxLength={200}
                disabled={!canEdit || pending}
                placeholder="Algeria — nationwide"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Footer / submit ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canEdit || pending}>
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
        {status.kind === "saved" ? (
          <span className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]">
            <Check className="size-4" />
            Saved
          </span>
        ) : null}
        {status.kind === "error" ? (
          <span role="alert" className="text-body-sm text-[var(--danger)]">
            {status.message}
          </span>
        ) : null}
        {!canEdit ? (
          <span className="text-body-sm text-[var(--text-tertiary)]">
            Read-only — agent role or above can edit.
          </span>
        ) : null}
      </div>
      </form>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-body-sm font-medium text-[var(--text-primary)]">{label}</span>
      {hint ? (
        <span className="flex items-start gap-1.5 text-body-sm text-[var(--text-tertiary)]">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{hint}</span>
        </span>
      ) : null}
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  disabled,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "disabled">) {
  return (
    <input
      type="text"
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "placeholder:text-[var(--text-tertiary)]",
        className,
      )}
    />
  );
}

function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: SupportedLanguage | undefined;
  onChange: (v: SupportedLanguage | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? undefined : (v as SupportedLanguage));
      }}
      disabled={disabled}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <option value="">(none)</option>
      {SUPPORTED_LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {LANG_LABELS[l]}
        </option>
      ))}
    </select>
  );
}

function LanguagesMultiselect({
  value,
  onChange,
  disabled,
}: {
  value: SupportedLanguage[];
  onChange: (v: SupportedLanguage[]) => void;
  disabled?: boolean;
}) {
  function toggle(lang: SupportedLanguage) {
    if (value.includes(lang)) onChange(value.filter((l) => l !== lang));
    else onChange([...value, lang]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {SUPPORTED_LANGUAGES.map((l) => {
        const on = value.includes(l);
        return (
          <button
            key={l}
            type="button"
            onClick={() => toggle(l)}
            disabled={disabled}
            aria-pressed={on}
            className={cn(
              "h-8 rounded-md border px-3 text-body-sm transition-colors duration-150 ease-out",
              "disabled:cursor-not-allowed disabled:opacity-60",
              on
                ? "border-[var(--accent-base)] bg-[var(--accent-glow)]/30 text-[var(--accent-hover)]"
                : "border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
            )}
          >
            {LANG_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}

function HoursSection({
  tz,
  weekly,
  disabled,
  onChange,
}: {
  tz: string;
  weekly: { day: DayOfWeek; open: string; close: string }[];
  disabled: boolean;
  onChange: (
    next: { tz: string; weekly: { day: DayOfWeek; open: string; close: string }[] } | undefined,
  ) => void;
}) {
  function emit(nextTz: string, nextWeekly: typeof weekly) {
    if (!nextTz && nextWeekly.length === 0) {
      onChange(undefined);
      return;
    }
    onChange({ tz: nextTz, weekly: nextWeekly });
  }

  function setDay(day: DayOfWeek, patch: Partial<{ open: string; close: string }>) {
    const existing = weekly.find((w) => w.day === day);
    let next: typeof weekly;
    if (existing) {
      next = weekly.map((w) =>
        w.day === day ? { ...w, ...patch } : w,
      );
    } else {
      next = [...weekly, { day, open: "09:00", close: "17:00", ...patch }];
    }
    emit(tz, next);
  }

  function clearDay(day: DayOfWeek) {
    emit(tz, weekly.filter((w) => w.day !== day));
  }

  const byDay = new Map(weekly.map((w) => [w.day, w]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-body font-medium text-[var(--text-primary)]">Hours</h3>
          <p className="text-body-sm text-[var(--text-tertiary)]">
            Weekly opening hours. Leave a day blank for &ldquo;closed.&rdquo;
          </p>
        </div>
      </div>
      <Field label="Timezone" hint="IANA tz name (e.g. Africa/Algiers, Europe/Paris).">
        <TextInput
          value={tz}
          onChange={(v) => emit(v.trim(), weekly)}
          maxLength={64}
          disabled={disabled}
          placeholder="Africa/Algiers"
        />
      </Field>
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]">
              <th className="px-3 py-2 text-left font-medium">Day</th>
              <th className="px-3 py-2 text-left font-medium">Open</th>
              <th className="px-3 py-2 text-left font-medium">Close</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {DAY_OF_WEEK.map((day) => {
              const row = byDay.get(day);
              return (
                <tr key={day}>
                  <td className="px-3 py-2 text-[var(--text-primary)]">
                    {DAY_LABELS[day]}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={row?.open ?? ""}
                      onChange={(e) => setDay(day, { open: e.target.value })}
                      disabled={disabled}
                      className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-body-sm text-[var(--text-primary)] disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      value={row?.close ?? ""}
                      onChange={(e) => setDay(day, { close: e.target.value })}
                      disabled={disabled}
                      className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-body-sm text-[var(--text-primary)] disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row ? (
                      <button
                        type="button"
                        onClick={() => clearDay(day)}
                        disabled={disabled}
                        className="text-body-sm text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-60"
                      >
                        clear
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationsSection({
  locations,
  disabled,
  onChange,
}: {
  locations: OperationalFactsLocation[];
  disabled: boolean;
  onChange: (next: OperationalFactsLocation[]) => void;
}) {
  function update(i: number, patch: Partial<OperationalFactsLocation>) {
    onChange(
      locations.map((loc, idx) => (idx === i ? { ...loc, ...patch } : loc)),
    );
  }
  function add() {
    onChange([...locations, { label: "", address: "" }]);
  }
  function remove(i: number) {
    onChange(locations.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-body font-medium text-[var(--text-primary)]">Locations</h3>
          <p className="text-body-sm text-[var(--text-tertiary)]">
            Physical sites. The AI references the nearest match when a customer asks.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={disabled || locations.length >= 20}
        >
          <Plus className="size-3.5" />
          Add location
        </Button>
      </div>
      {locations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-body-sm text-[var(--text-tertiary)]">
          No locations yet. Add one if you want the AI to mention specific sites.
        </p>
      ) : (
        <div className="space-y-3">
          {locations.map((loc, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                  value={loc.label}
                  onChange={(v) => update(i, { label: v })}
                  maxLength={120}
                  disabled={disabled}
                  placeholder="Label (e.g. HQ, Branch, Showroom)"
                />
                <TextInput
                  value={loc.phone ?? ""}
                  onChange={(v) => update(i, { phone: v.trim() || undefined })}
                  maxLength={64}
                  disabled={disabled}
                  placeholder="Phone (optional)"
                />
                <TextInput
                  value={loc.address}
                  onChange={(v) => update(i, { address: v })}
                  maxLength={400}
                  disabled={disabled}
                  placeholder="Address"
                  className="sm:col-span-2"
                />
              </div>
              <div className="mt-3 text-right">
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  className="inline-flex items-center gap-1 text-body-sm text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-60"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reduce an empty `{name, email, phone}` object to undefined so the parent
 * data envelope doesn't carry an empty `primaryContact` key. The Zod schema
 * accepts undefined here; an empty object would also pass but would render
 * as a stale "Primary contact" header in Block B with no bits.
 */
function normalizeContact(c: {
  name?: string;
  email?: string;
  phone?: string;
}): { name?: string; email?: string; phone?: string } | undefined {
  if (!c.name && !c.email && !c.phone) return undefined;
  return c;
}
