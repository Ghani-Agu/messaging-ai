"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  itemAvailabilityValues,
  knowledgeItemInputSchema,
  type KnowledgeItemInput,
  type KnowledgeItemSpecs,
} from "@/lib/items";
import type { ItemAvailability, KnowledgeItem } from "@prisma/client";

/**
 * Item create / edit form (Phase 8c).
 *
 * Single-form for both flows — `initial=null` means create, `initial=row`
 * means edit. Submits the parsed input to a parent-supplied callback;
 * the parent owns the Server Action call and the post-success refresh.
 *
 * Specs editor is a simple key/value row list — sufficient for v1.
 * Reserved `_template_id` field is editable via a separate text input
 * so operators can pin a category template (Gate-1 A) without diving
 * into the spec rows.
 */

const AVAILABILITY_LABEL: Record<ItemAvailability, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  UNKNOWN: "Unknown",
};

type FormState = {
  name: string;
  category: string;
  externalId: string;
  sku: string;
  brand: string;
  currency: string;
  /** Decimal currency string (UI), converted to cents before submit. */
  priceDecimal: string;
  availability: ItemAvailability;
  description: string;
  templateId: string;
  specs: { key: string; value: string }[];
};

function initialFromRow(row: KnowledgeItem | null): FormState {
  if (!row) {
    return {
      name: "",
      category: "",
      externalId: "",
      sku: "",
      brand: "",
      currency: "",
      priceDecimal: "",
      availability: "UNKNOWN",
      description: "",
      templateId: "",
      specs: [],
    };
  }
  const specsObj =
    row.specs && typeof row.specs === "object" && !Array.isArray(row.specs)
      ? (row.specs as Record<string, unknown>)
      : {};
  const templateId = typeof specsObj._template_id === "string" ? specsObj._template_id : "";
  const specRows: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(specsObj)) {
    if (k.startsWith("_")) continue;
    if (v === null || v === undefined) continue;
    specRows.push({ key: k, value: typeof v === "string" ? v : String(v) });
  }
  return {
    name: row.name,
    category: row.category ?? "",
    externalId: row.externalId ?? "",
    sku: row.sku ?? "",
    brand: row.brand ?? "",
    currency: row.currency ?? "",
    priceDecimal:
      row.priceCents !== null && row.priceCents !== undefined
        ? (row.priceCents / 100).toFixed(2)
        : "",
    availability: row.availability,
    description: row.description ?? "",
    templateId,
    specs: specRows,
  };
}

function toInput(s: FormState): KnowledgeItemInput {
  const specs: KnowledgeItemSpecs = {};
  if (s.templateId.trim()) specs._template_id = s.templateId.trim();
  for (const r of s.specs) {
    const k = r.key.trim();
    const v = r.value.trim();
    if (!k || !v) continue;
    if (k.startsWith("_")) continue; // operators can't override reserved keys via spec rows
    specs[k] = v;
  }
  const priceTrim = s.priceDecimal.trim();
  let priceCents: number | undefined;
  if (priceTrim) {
    const parsed = Number.parseFloat(priceTrim);
    if (Number.isFinite(parsed) && parsed >= 0) {
      priceCents = Math.round(parsed * 100);
    }
  }
  const raw = {
    name: s.name.trim(),
    category: s.category.trim() || undefined,
    externalId: s.externalId.trim() || undefined,
    sku: s.sku.trim() || undefined,
    brand: s.brand.trim() || undefined,
    currency: s.currency.trim() || undefined,
    priceCents,
    availability: s.availability,
    description: s.description.trim() || undefined,
    specs,
  };
  // Re-parse to normalize defaults (availability default, specs default).
  return knowledgeItemInputSchema.parse(raw);
}

export function ItemForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: KnowledgeItem | null;
  onSubmit: (input: KnowledgeItemInput) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [s, setS] = useState<FormState>(initialFromRow(initial));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = initial !== null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  function addSpecRow() {
    setS((prev) => ({ ...prev, specs: [...prev.specs, { key: "", value: "" }] }));
  }
  function setSpecRow(i: number, patch: Partial<{ key: string; value: string }>) {
    setS((prev) => ({
      ...prev,
      specs: prev.specs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  }
  function removeSpecRow(i: number) {
    setS((prev) => ({ ...prev, specs: prev.specs.filter((_, idx) => idx !== i) }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let parsed: KnowledgeItemInput;
    try {
      parsed = toInput(s);
    } catch (err) {
      // Zod errors carry useful per-field messages — surface the first one.
      const msg = err instanceof Error ? err.message : "Invalid input";
      const issue = JSON.parse(msg)?.[0]?.message;
      setError(typeof issue === "string" ? issue : msg);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-6" noValidate>
      <header className="space-y-1">
        <h2 className="text-h3 text-[var(--text-primary)]">
          {isEdit ? "Edit product" : "New product"}
        </h2>
        <p className="text-body-sm text-[var(--text-secondary)]">
          Structured fields the AI references on every reply. Embedding regenerates
          automatically on save.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            value={s.name}
            onChange={(v) => update("name", v)}
            placeholder="Macbook Pro M3"
            maxLength={200}
            required
          />
        </Field>
        <Field label="Category">
          <Input
            value={s.category}
            onChange={(v) => update("category", v)}
            placeholder="laptops"
            maxLength={80}
          />
        </Field>
        <Field label="Brand">
          <Input
            value={s.brand}
            onChange={(v) => update("brand", v)}
            placeholder="Apple"
            maxLength={120}
          />
        </Field>
        <Field label="SKU">
          <Input
            value={s.sku}
            onChange={(v) => update("sku", v)}
            placeholder="MBP-M3-14"
            maxLength={120}
            mono
          />
        </Field>
        <Field label="Price" hint="Decimal — e.g. 220000.00">
          <Input
            value={s.priceDecimal}
            onChange={(v) => update("priceDecimal", v)}
            placeholder="220000.00"
            inputMode="decimal"
            mono
          />
        </Field>
        <Field label="Currency" hint="ISO 4217 (DZD / USD / EUR…)">
          <Input
            value={s.currency}
            onChange={(v) => update("currency", v.toUpperCase())}
            placeholder="DZD"
            maxLength={8}
            mono
          />
        </Field>
        <Field label="Availability">
          <Select
            value={s.availability}
            onChange={(v) => update("availability", v as ItemAvailability)}
          >
            {itemAvailabilityValues.map((a) => (
              <option key={a} value={a}>
                {AVAILABILITY_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="External ID" hint="Stable identifier for re-imports (Odoo, etc.)">
          <Input
            value={s.externalId}
            onChange={(v) => update("externalId", v)}
            placeholder="odoo-12345"
            maxLength={120}
            mono
          />
        </Field>
      </div>

      <Field label="Description" hint="Indexed for embedding. Visible to the AI.">
        <Textarea
          value={s.description}
          onChange={(v) => update("description", v)}
          placeholder="14-inch laptop with M3 chip, 16GB RAM, 512GB SSD."
          maxLength={4000}
          rows={3}
        />
      </Field>

      {/* Specs editor ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-body font-medium text-[var(--text-primary)]">Specs</h3>
            <p className="text-body-sm text-[var(--text-tertiary)]">
              Free-form key/value pairs (color, size, weight, technical details).
              Used for retrieval; spec values are folded into the embedding.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addSpecRow}>
            <Plus className="size-3.5" />
            Add spec
          </Button>
        </div>
        {s.specs.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-body-sm text-[var(--text-tertiary)]">
            No specs yet.
          </p>
        ) : (
          <div className="space-y-2">
            {s.specs.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  value={row.key}
                  onChange={(v) => setSpecRow(i, { key: v })}
                  placeholder="key (e.g. color)"
                  maxLength={80}
                />
                <Input
                  value={row.value}
                  onChange={(v) => setSpecRow(i, { value: v })}
                  placeholder="value (e.g. space gray)"
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => removeSpecRow(i)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-transparent text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--danger)]"
                  aria-label="Remove spec"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Field
        label="Template ID"
        hint="Reserved spec field. Pins a category form template for future per-category UI rendering. Optional."
      >
        <Input
          value={s.templateId}
          onChange={(v) => update("templateId", v)}
          placeholder="laptop-v1"
          maxLength={80}
          mono
        />
      </Field>

      {error ? (
        <div role="alert" className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-body-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving…
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create product"
          )}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny form primitives — kept local since this form is the only consumer.
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-body-sm font-medium text-[var(--text-primary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      {hint ? (
        <span className="block text-body-sm text-[var(--text-tertiary)]">{hint}</span>
      ) : null}
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  mono,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      type="text"
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "placeholder:text-[var(--text-tertiary)]",
        mono && "font-mono text-body-sm",
        className,
      )}
    />
  );
}

function Textarea({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return (
    <textarea
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "placeholder:text-[var(--text-tertiary)]",
        className,
      )}
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
      )}
    >
      {children}
    </select>
  );
}
