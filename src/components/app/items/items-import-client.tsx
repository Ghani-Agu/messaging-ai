"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  commitImportedItemsAction,
  previewCsvImportAction,
  smartImportItemsAction,
} from "@/server/knowledge/items/actions";
import {
  itemAvailabilityValues,
  type KnowledgeItemInput,
} from "@/lib/items";
import type { ItemAvailability } from "@prisma/client";
import type { StructuredItemDraft } from "@/server/ai/claude-client";
import type { CsvImportResult } from "@/lib/csv-import";

/**
 * Items import surface (Phase 8c).
 *
 * Two tabs:
 *   - Smart import: paste free-text → Claude (currently the stub) returns
 *     structured drafts → operator reviews + edits inline → commits.
 *   - CSV upload: paste CSV → server parses + validates per-row → operator
 *     reviews failed rows + edits → commits.
 *
 * Both flows feed into the same preview table which renders inline-editable
 * text inputs for the most common edit cases (name, sku, brand, price,
 * currency, availability) and read-only display for the rest. Description
 * + specs aren't editable here — operators who need to edit those should
 * skip the row and create the item manually via the items list, or save
 * the row as-is and edit it post-create.
 */

type Tab = "smart" | "csv";

type EditableDraft = {
  /** Stable client-side key for React. */
  key: string;
  name: string;
  category: string;
  brand: string;
  sku: string;
  currency: string;
  /** Decimal currency string (UI), converted to cents on commit. */
  priceDecimal: string;
  availability: ItemAvailability;
  description: string;
  specs: Record<string, string>;
  /** When true, the row is skipped on commit (operator unchecked it). */
  selected: boolean;
  /** Pre-existing CSV failure surfaces here so the operator sees the issue. */
  importError?: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "pending"; what: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function ItemsImportClient({
  tenantSlug,
  canImport,
}: {
  tenantSlug: string;
  canImport: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("smart");
  const [smartText, setSmartText] = useState("");
  const [csvText, setCsvText] = useState("");
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const selectedCount = useMemo(
    () => drafts.filter((d) => d.selected).length,
    [drafts],
  );

  function flash(s: Status, durationMs = 3000) {
    setStatus(s);
    if (s.kind === "ok" || s.kind === "error") {
      setTimeout(() => {
        setStatus((cur) => (cur === s ? { kind: "idle" } : cur));
      }, durationMs);
    }
  }

  function runSmartImport() {
    if (!smartText.trim()) return;
    flash({ kind: "pending", what: "smart-import" });
    startTransition(async () => {
      try {
        const r = await smartImportItemsAction(tenantSlug, { text: smartText });
        setDrafts(
          r.items.map((it, i) => structuredDraftToEditable(it, `smart-${i}`)),
        );
        flash({
          kind: "ok",
          message: r.notes
            ? `${r.items.length} drafts ready · ${r.notes}`
            : `${r.items.length} drafts ready`,
        });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Smart import failed",
        });
      }
    });
  }

  function runCsvPreview() {
    if (!csvText.trim()) return;
    flash({ kind: "pending", what: "csv-preview" });
    startTransition(async () => {
      try {
        const r = await previewCsvImportAction(tenantSlug, { csv: csvText });
        setDrafts(csvResultToEditable(r));
        flash({
          kind: "ok",
          message: `${r.summary.ok}/${r.summary.total} rows parsed · ${r.summary.failed} failed`,
        });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "CSV preview failed",
        });
      }
    });
  }

  function commitSelected() {
    const selected = drafts.filter((d) => d.selected);
    if (selected.length === 0) return;
    if (!window.confirm(`Commit ${selected.length} items to your catalog?`)) return;
    flash({ kind: "pending", what: "commit" });
    startTransition(async () => {
      try {
        const inputs = selected.map((d) => editableToInput(d));
        const r = await commitImportedItemsAction(tenantSlug, { items: inputs });
        if (r.failed.length > 0) {
          flash({
            kind: "error",
            message: `${r.created.length} created, ${r.failed.length} failed (first error: ${r.failed[0]!.error})`,
          });
        } else {
          flash({
            kind: "ok",
            message: `${r.created.length} items created — embedding in progress`,
          });
          // Clear local state on full success.
          setDrafts([]);
          setSmartText("");
          setCsvText("");
          // Force a fresh server fetch when the operator returns to the list.
          router.refresh();
        }
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Commit failed",
        });
      }
    });
  }

  function patch(key: string, p: Partial<EditableDraft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d)));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-2">
        <Link
          href={`/${tenantSlug}/knowledge/items`}
          className="inline-flex items-center gap-1 text-body-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to Products
        </Link>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-h2 text-[var(--text-primary)]">Import products</h1>
            <p className="text-body-sm text-[var(--text-secondary)]">
              Paste catalog text or a CSV. Review the parsed drafts inline, then
              commit the ones you want. Each committed item gets embedded for
              semantic search.
            </p>
          </div>
          <StatusPill status={status} />
        </div>
      </header>

      {/* Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-[var(--border-subtle)]">
        <TabButton active={tab === "smart"} onClick={() => setTab("smart")}>
          <Sparkles className="size-3.5" />
          Smart import
        </TabButton>
        <TabButton active={tab === "csv"} onClick={() => setTab("csv")}>
          <FileText className="size-3.5" />
          CSV upload
        </TabButton>
      </div>

      {/* Tab content ──────────────────────────────────────────────── */}
      {tab === "smart" ? (
        <SmartImportPane
          text={smartText}
          onChange={setSmartText}
          onRun={runSmartImport}
          disabled={!canImport || status.kind === "pending"}
        />
      ) : (
        <CsvImportPane
          text={csvText}
          onChange={setCsvText}
          onRun={runCsvPreview}
          disabled={!canImport || status.kind === "pending"}
        />
      )}

      {/* Drafts table ─────────────────────────────────────────────── */}
      {drafts.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-h4 text-[var(--text-primary)]">
              Review drafts ({selectedCount} selected)
            </h2>
            <Button
              type="button"
              onClick={commitSelected}
              disabled={!canImport || selectedCount === 0 || status.kind === "pending"}
            >
              {status.kind === "pending" && status.what === "commit" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Committing…
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  Commit {selectedCount} item{selectedCount === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </div>
          <DraftsTable drafts={drafts} onPatch={patch} disabled={!canImport} />
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({
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
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-body-sm font-medium",
        "transition-colors duration-150 ease-out",
        active
          ? "border-[var(--accent-base)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}

function SmartImportPane({
  text,
  onChange,
  onRun,
  disabled,
}: {
  text: string;
  onChange: (v: string) => void;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-body-sm text-[var(--text-secondary)]">
        Paste anything: a supplier email, a price list, a product brief.
        The AI extracts structured items you can then edit and commit. Stub
        mode (current): one rotating field per call is intentionally left
        wrong so the correction UI gets exercised.
      </p>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Macbook Pro M3, $2200, in stock&#10;iPhone 15, $799, available&#10;Asus router AC2900, low stock"
        className={cn(
          "block w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-body text-[var(--text-primary)]",
          "transition-colors duration-150 ease-out",
          "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          "placeholder:text-[var(--text-tertiary)] font-mono text-body-sm",
        )}
      />
      <Button type="button" onClick={onRun} disabled={disabled || !text.trim()}>
        <Sparkles className="size-3.5" />
        Run smart import
      </Button>
    </div>
  );
}

function CsvImportPane({
  text,
  onChange,
  onRun,
  disabled,
}: {
  text: string;
  onChange: (v: string) => void;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-body-sm text-[var(--text-secondary)]">
        Paste a CSV with a header row. Standard headers map to typed fields
        (name, brand, sku, price, currency, availability, description); any
        other column becomes a spec key. Rows that fail validation are
        flagged below — you can fix them inline before committing.
      </p>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        placeholder="name,brand,sku,price,currency,availability,description&#10;Macbook Pro M3,Apple,MBP-M3-14,2200.00,USD,in_stock,14-inch laptop"
        className={cn(
          "block w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-body text-[var(--text-primary)]",
          "transition-colors duration-150 ease-out",
          "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          "placeholder:text-[var(--text-tertiary)] font-mono text-body-sm",
        )}
      />
      <Button type="button" onClick={onRun} disabled={disabled || !text.trim()}>
        <FileText className="size-3.5" />
        Preview CSV
      </Button>
    </div>
  );
}

function DraftsTable({
  drafts,
  onPatch,
  disabled,
}: {
  drafts: EditableDraft[];
  onPatch: (key: string, p: Partial<EditableDraft>) => void;
  disabled: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full min-w-[60rem] text-body-sm">
        <thead>
          <tr className="bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]">
            <th className="px-2 py-2 text-left font-medium">Include</th>
            <th className="px-2 py-2 text-left font-medium">Name *</th>
            <th className="px-2 py-2 text-left font-medium">Brand</th>
            <th className="px-2 py-2 text-left font-medium">SKU</th>
            <th className="px-2 py-2 text-right font-medium">Price</th>
            <th className="px-2 py-2 text-left font-medium">Currency</th>
            <th className="px-2 py-2 text-left font-medium">Availability</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {drafts.map((d) => (
            <tr
              key={d.key}
              className={cn(
                "hover:bg-[var(--bg-surface-elevated)]/50",
                d.importError ? "bg-[var(--danger)]/5" : "",
                !d.selected ? "opacity-60" : "",
              )}
            >
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) => onPatch(d.key, { selected: e.target.checked })}
                  disabled={disabled}
                  aria-label="Include in commit"
                />
                {d.importError ? (
                  <span
                    title={d.importError}
                    className="ml-1 inline-flex items-center text-[var(--danger)]"
                  >
                    <AlertCircle className="size-3.5" aria-hidden />
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-2">
                <CellInput
                  value={d.name}
                  onChange={(v) => onPatch(d.key, { name: v })}
                  disabled={disabled}
                />
              </td>
              <td className="px-2 py-2">
                <CellInput
                  value={d.brand}
                  onChange={(v) => onPatch(d.key, { brand: v })}
                  disabled={disabled}
                />
              </td>
              <td className="px-2 py-2">
                <CellInput
                  value={d.sku}
                  onChange={(v) => onPatch(d.key, { sku: v })}
                  disabled={disabled}
                  mono
                />
              </td>
              <td className="px-2 py-2 text-right">
                <CellInput
                  value={d.priceDecimal}
                  onChange={(v) => onPatch(d.key, { priceDecimal: v })}
                  disabled={disabled}
                  inputMode="decimal"
                  mono
                  align="right"
                />
              </td>
              <td className="px-2 py-2">
                <CellInput
                  value={d.currency}
                  onChange={(v) => onPatch(d.key, { currency: v.toUpperCase() })}
                  disabled={disabled}
                  mono
                  size={6}
                />
              </td>
              <td className="px-2 py-2">
                <select
                  value={d.availability}
                  onChange={(e) =>
                    onPatch(d.key, {
                      availability: e.target.value as ItemAvailability,
                    })
                  }
                  disabled={disabled}
                  className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 text-body-sm text-[var(--text-primary)] disabled:opacity-60"
                >
                  {itemAvailabilityValues.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellInput({
  value,
  onChange,
  disabled,
  mono,
  align,
  size,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  mono?: boolean;
  align?: "right";
  size?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "disabled" | "size">) {
  return (
    <input
      type="text"
      {...rest}
      size={size}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "block h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-body-sm text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-default)] focus:border-[var(--accent-base)] focus:bg-[var(--bg-base)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-base)]/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
        mono && "font-mono",
        align === "right" && "text-right",
      )}
    />
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status.kind === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-[var(--text-secondary)]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Working…
      </span>
    );
  }
  if (status.kind === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]">
        <Check className="size-4" aria-hidden />
        {status.message}
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span role="alert" className="inline-flex items-center gap-1 text-body-sm text-[var(--danger)]">
        <X className="size-4" aria-hidden />
        {status.message}
      </span>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function structuredDraftToEditable(
  d: StructuredItemDraft,
  key: string,
): EditableDraft {
  return {
    key,
    name: d.name ?? "",
    category: d.category ?? "",
    brand: d.brand ?? "",
    sku: d.sku ?? "",
    currency: d.currency ?? "",
    priceDecimal: d.price ?? "",
    availability: (d.availability as ItemAvailability) ?? "UNKNOWN",
    description: d.description ?? "",
    specs: d.specs ?? {},
    selected: true,
  };
}

function csvResultToEditable(r: CsvImportResult): EditableDraft[] {
  return r.rows.map((row, i) => {
    const key = `csv-${i}-${row.row}`;
    if (row.ok) {
      const parsed = row.input;
      const priceDecimal =
        parsed.priceCents !== null && parsed.priceCents !== undefined
          ? (parsed.priceCents / 100).toFixed(2)
          : "";
      return {
        key,
        name: parsed.name,
        category: parsed.category ?? "",
        brand: parsed.brand ?? "",
        sku: parsed.sku ?? "",
        currency: parsed.currency ?? "",
        priceDecimal,
        availability: parsed.availability,
        description: parsed.description ?? "",
        specs: stringifySpecs(parsed.specs ?? {}),
        selected: true,
      };
    }
    // Failed row — surface the error and don't pre-select.
    return {
      key,
      name: row.raw.name ?? row.raw.product ?? "",
      category: row.raw.category ?? "",
      brand: row.raw.brand ?? "",
      sku: row.raw.sku ?? "",
      currency: row.raw.currency ?? "",
      priceDecimal: row.raw.price ?? row.raw.cost ?? "",
      availability: "UNKNOWN" as ItemAvailability,
      description: row.raw.description ?? "",
      specs: {},
      selected: false,
      importError: row.error,
    };
  });
}

function stringifySpecs(specs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

function editableToInput(d: EditableDraft): KnowledgeItemInput {
  let priceCents: number | undefined;
  const priceTrim = d.priceDecimal.trim().replace(/,/g, ".");
  if (priceTrim) {
    const parsed = Number.parseFloat(priceTrim);
    if (Number.isFinite(parsed) && parsed >= 0) priceCents = Math.round(parsed * 100);
  }
  // Re-shape to KnowledgeItemInput; the Server Action will Zod-parse again.
  return {
    name: d.name.trim(),
    category: d.category.trim() || undefined,
    brand: d.brand.trim() || undefined,
    sku: d.sku.trim() || undefined,
    currency: d.currency.trim() || undefined,
    priceCents,
    availability: d.availability,
    description: d.description.trim() || undefined,
    specs: d.specs ?? {},
  };
}
