"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import {
  createItemAction,
  deleteItemAction,
  loadItem,
  markAllItemsVerifiedAction,
  markItemVerifiedAction,
  updateItemAction,
} from "@/server/knowledge/items/actions";
import type { ItemSummary } from "@/lib/items";
import type { ItemAvailability, KnowledgeItem } from "@prisma/client";
import { MAX_ITEMS_PER_TENANT } from "@/server/knowledge/limits";
import { ItemForm } from "./item-form";

/**
 * Items / Products admin surface (Phase 8c).
 *
 * Lists items with search + category filter, per-row Edit / Delete /
 * Mark verified, and bulk "Mark all as verified" for catalog-refresh
 * workflows (Gate-1 P8c note 7). Add / edit happen in an inline modal
 * (no route change) so distributors entering 50 items in a session
 * don't bounce back to a list page each time.
 *
 * AGENT-floor enforcement is server-side; canEdit gates the UI
 * affordances so VIEWERs see a read-only view.
 */

const AVAILABILITY_LABEL: Record<ItemAvailability, string> = {
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  UNKNOWN: "—",
};

const AVAILABILITY_TONE: Record<ItemAvailability, string> = {
  IN_STOCK: "border-[var(--success)]/40 text-[var(--success)]",
  LOW_STOCK: "border-[var(--warning)]/40 text-[var(--warning)]",
  OUT_OF_STOCK: "border-[var(--danger)]/40 text-[var(--danger)]",
  UNKNOWN: "border-[var(--border-default)] text-[var(--text-tertiary)]",
};

type Status =
  | { kind: "idle" }
  | { kind: "pending"; what: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function ItemsListClient({
  tenantSlug,
  initialItems,
  initialCount,
  page,
  pageSize,
  totalPages,
  search,
  category,
  allCategories,
  canEdit,
}: {
  tenantSlug: string;
  initialItems: ItemSummary[];
  initialCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  search: string;
  category: string;
  allCategories: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  // Items + count are server-driven by the URL — props are the source of
  // truth. Filter / search / pagination all live in the query string; the
  // server re-fetches on every change. After CRUD we call router.refresh()
  // to reload the current view.
  const items = initialItems;
  const count = initialCount;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  // Local input state for the search box. Initialised from the URL-driven
  // `search` prop on mount, then re-synced when the URL changes (browser
  // back/forward, direct paste, programmatic clear). Decoupled from the
  // URL so typing doesn't await a roundtrip per keystroke.
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Modal state — open with `null` for create, with the item for edit.
  const [editing, setEditing] = useState<KnowledgeItem | null | "new" | undefined>(
    undefined,
  );

  const buildItemsHref = useCallback(
    (next: { q?: string; category?: string; page?: number }) => {
      const params = new URLSearchParams();
      if (next.q && next.q.trim()) params.set("q", next.q.trim());
      if (next.category && next.category.trim())
        params.set("category", next.category.trim());
      if (next.page && next.page > 1) params.set("page", String(next.page));
      const qs = params.toString();
      return `/${tenantSlug}/knowledge/items${qs ? `?${qs}` : ""}`;
    },
    [tenantSlug],
  );

  // Debounced URL push when the search input changes. 300 ms keeps the
  // URL history clean (one entry per intent, not per keystroke) and gives
  // the server time to respond between presses on a slow connection.
  // Filter changes always reset page to 1 — paginating into "page 5 of
  // results-for-foo" then narrowing to "results-for-fooo" rarely matches
  // user intent.
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      router.push(buildItemsHref({ q: searchInput, category, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search, category, router, buildItemsHref]);

  function onCategoryChange(next: string) {
    // No debounce for the dropdown — selection is a single deliberate
    // action, not a keystroke stream.
    router.push(buildItemsHref({ q: searchInput, category: next, page: 1 }));
  }

  function onClearSearch() {
    setSearchInput("");
    router.push(buildItemsHref({ q: "", category, page: 1 }));
  }

  const filtersActive = search.length > 0 || category.length > 0;

  function flash(s: Status, durationMs = 2200) {
    setStatus(s);
    if (s.kind === "ok" || s.kind === "error") {
      setTimeout(() => {
        setStatus((cur) => (cur === s ? { kind: "idle" } : cur));
      }, durationMs);
    }
  }

  function refresh() {
    router.refresh();
  }

  function onMarkVerified(itemId: string) {
    if (!canEdit) return;
    flash({ kind: "pending", what: "verify" });
    startTransition(async () => {
      try {
        await markItemVerifiedAction(tenantSlug, itemId);
        refresh();
        flash({ kind: "ok", message: "Marked verified" });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to verify",
        });
      }
    });
  }

  function onMarkAllVerified() {
    if (!canEdit) return;
    if (!window.confirm(`Mark all ${count} items as verified today?`)) return;
    flash({ kind: "pending", what: "bulk-verify" });
    startTransition(async () => {
      try {
        const r = await markAllItemsVerifiedAction(tenantSlug);
        refresh();
        flash({ kind: "ok", message: `${r.count} items marked verified` });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Bulk verify failed",
        });
      }
    });
  }

  function onDelete(itemId: string, name: string) {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    flash({ kind: "pending", what: "delete" });
    startTransition(async () => {
      try {
        await deleteItemAction(tenantSlug, itemId);
        refresh();
        flash({ kind: "ok", message: "Item deleted" });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Delete failed",
        });
      }
    });
  }

  async function onEditClick(itemId: string) {
    // Hydrate the full row (the list select doesn't return all fields).
    const full = await loadItem(tenantSlug, itemId);
    if (full) setEditing(full);
  }

  async function onFormSubmit(input: unknown, currentEdit: KnowledgeItem | "new") {
    flash({ kind: "pending", what: currentEdit === "new" ? "create" : "save" });
    try {
      if (currentEdit === "new") {
        await createItemAction(tenantSlug, input);
      } else {
        await updateItemAction(tenantSlug, currentEdit.id, input);
      }
      setEditing(undefined);
      flash({
        kind: "ok",
        message: currentEdit === "new" ? "Item created" : "Item saved",
      });
      router.refresh();
    } catch (err) {
      flash({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  const overCap = count >= MAX_ITEMS_PER_TENANT;

  return (
    <PageShell width="6xl" className="space-y-6">
      {/* Header ─────────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow={<Eyebrow>Knowledge</Eyebrow>}
        title="Products"
        description={`Structured items the AI can reason about — products, services, packages. Each item has typed fields (name, price, availability, specs) plus a semantic embedding for retrieval. ${count} ${count === 1 ? "item" : "items"} total.`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={status} />
            {canEdit ? (
            <>
              <Link
                href={`/${tenantSlug}/knowledge/items/import`}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] px-3 text-body-sm font-medium text-[var(--text-primary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:border-[var(--border-strong)]"
              >
                <Upload className="size-3.5" />
                Import
              </Link>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onMarkAllVerified}
                disabled={count === 0}
              >
                <CheckCircle2 className="size-3.5" />
                Mark all verified
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setEditing("new")}
                disabled={overCap}
              >
                <Plus className="size-3.5" />
                New item
              </Button>
            </>
          ) : null}
          </div>
        }
      />

      {/* Soft-cap banner ─────────────────────────────────────────── */}
      {overCap ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-body-sm text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            You&apos;ve reached the soft cap of {MAX_ITEMS_PER_TENANT} items.
            Adding more is fine but performance may degrade as the catalog grows.
            Consider archiving stale entries.
          </p>
        </div>
      ) : null}

      {/* Filters ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, brand, SKU…"
            className={cn(
              "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] pl-9 text-body text-[var(--text-primary)]",
              searchInput ? "pr-9" : "pr-3",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
            )}
          />
          {searchInput ? (
            <button
              type="button"
              onClick={onClearSearch}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {allCategories.length > 0 ? (
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className={cn(
              "h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out motion-reduce:transition-none",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
            )}
          >
            <option value="">All categories</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Filter summary ───────────────────────────────────────────── */}
      {filtersActive ? (
        <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--text-tertiary)]">
          <span>
            {count} {count === 1 ? "match" : "matches"}
            {search ? ` for “${search}”` : ""}
            {category ? ` in “${category}”` : ""}
          </span>
          <Link
            href={buildItemsHref({ page: 1 })}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-caption text-[var(--text-secondary)] transition-colors duration-150 ease-out motion-reduce:transition-none hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]"
          >
            Clear filters
          </Link>
        </div>
      ) : null}

      {/* Table ──────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <EmptyState
          hasItems={filtersActive}
          onAdd={() => canEdit && setEditing("new")}
          canEdit={canEdit}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]">
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Brand</th>
                <th className="px-3 py-2 text-left font-medium">SKU</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-left font-medium">Availability</th>
                <th className="px-3 py-2 text-left font-medium">Embedding</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-[var(--bg-surface-elevated)]/50">
                  <td className="px-3 py-2 text-[var(--text-primary)]">
                    <div className="font-medium">{it.name}</div>
                    {it.category ? (
                      <div className="text-caption text-[var(--text-tertiary)]">
                        {it.category}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">
                    {it.brand ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-caption text-[var(--text-secondary)]">
                    {it.sku ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                    {it.priceCents !== null
                      ? `${it.currency ?? ""} ${(it.priceCents / 100).toFixed(2)}`.trim()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border bg-[var(--bg-surface)] px-2 py-0.5 text-caption",
                        AVAILABILITY_TONE[it.availability],
                      )}
                    >
                      {AVAILABILITY_LABEL[it.availability]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {it.hasEmbedding ? (
                      <span className="inline-flex items-center gap-1 text-caption text-[var(--success)]">
                        <Sparkles className="size-3" aria-hidden />
                        ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                        embedding
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onMarkVerified(it.id)}
                          title="Mark as verified today"
                          className="text-[var(--text-tertiary)] hover:text-[var(--success)]"
                        >
                          <CheckCircle2 className="size-4" aria-hidden />
                          <span className="sr-only">Mark verified</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditClick(it.id)}
                          title="Edit"
                          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        >
                          <Pencil className="size-4" aria-hidden />
                          <span className="sr-only">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(it.id, it.name)}
                          title="Delete"
                          className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="size-4" aria-hidden />
                          <span className="sr-only">Delete</span>
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer ─────────────────────────────────────── */}
      {count > 0 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalCount={count}
          pageSize={pageSize}
          itemLabel="product"
          itemLabelPlural="products"
          pageHref={(n) => buildItemsHref({ q: search, category, page: n })}
        />
      ) : null}

      {/* Modal — create / edit ─────────────────────────────────── */}
      {editing !== undefined ? (
        <Modal onClose={() => setEditing(undefined)}>
          <ItemForm
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(undefined)}
            onSubmit={(input) => onFormSubmit(input, editing!)}
          />
        </Modal>
      ) : null}
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

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
      <span role="alert" className="text-body-sm text-[var(--danger)]">
        {status.message}
      </span>
    );
  }
  return null;
}

function EmptyState({
  hasItems,
  onAdd,
  canEdit,
}: {
  hasItems: boolean;
  onAdd: () => void;
  canEdit: boolean;
}) {
  if (hasItems) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-10 text-center text-body-sm text-[var(--text-tertiary)]">
        No items match the filters.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-12 text-center">
      <p className="text-body text-[var(--text-secondary)]">
        No products yet.
      </p>
      <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
        Add products manually now, or wait for CSV / smart import in a later commit.
      </p>
      {canEdit ? (
        <Button type="button" size="sm" onClick={onAdd} className="mt-4">
          <Plus className="size-3.5" />
          Add your first product
        </Button>
      ) : null}
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="custom-scrollbar fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]"
        >
          <X className="size-4" aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}

// Re-export the dummy reload action for any consumer that wants to refresh
// after a side-effecting action in another tab — present even if unused
// today, kept for parity with the knowledge list pattern.
export { RefreshCcw };
