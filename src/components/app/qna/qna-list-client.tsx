"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";
import {
  bulkDeleteQnaPairsAction,
  createQnaPairAction,
  deleteQnaPairAction,
  loadQnaPair,
  loadQnaPairs,
  updateQnaPairAction,
} from "@/server/knowledge/qna/actions";
import type { QnaPairSummary } from "@/lib/qna";
import type { QnaPair } from "@prisma/client";
import { MAX_QNA_PER_TENANT } from "@/server/knowledge/limits";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/validators";
import { QnaForm } from "./qna-form";

/**
 * Q&A admin surface (Phase 8e).
 *
 * Lists Q&A pairs with search + language filter + tag filter, per-row
 * Edit / Delete, and bulk delete via row checkboxes. Add / edit happen
 * in an inline modal — same pattern as Items in P8c-3.
 *
 * Q&A retrieval is already wired in retrieveQnaMatches (P8c-1) — this
 * commit is the operator surface only. Smoke tests in the paste-back
 * verify end-to-end behavior (matching, cross-language, languageLock).
 */

const LANG_LABELS: Record<SupportedLanguage, string> = {
  ar: "Arabic (MSA)",
  fr: "French",
  en: "English",
  darija: "Darija",
};

type Status =
  | { kind: "idle" }
  | { kind: "pending"; what: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string; duplicateId?: string };

export function QnaListClient({
  tenantSlug,
  initialPairs,
  initialCount,
  canEdit,
}: {
  tenantSlug: string;
  initialPairs: QnaPairSummary[];
  initialCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pairs, setPairs] = useState(initialPairs);
  const [count, setCount] = useState(initialCount);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [, startTransition] = useTransition();

  const [editing, setEditing] = useState<QnaPair | null | "new" | undefined>(
    undefined,
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of pairs) for (const t of p.tags) set.add(t);
    return Array.from(set).sort();
  }, [pairs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pairs.filter((p) => {
      if (language && p.language !== language) return false;
      if (tag && !p.tags.includes(tag)) return false;
      if (q) {
        const hay = `${p.question} ${p.answer}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pairs, search, language, tag]);

  const selectedCount = selected.size;
  const overCap = count >= MAX_QNA_PER_TENANT;

  function flash(s: Status, durationMs = 3000) {
    setStatus(s);
    if (s.kind === "ok" || s.kind === "error") {
      setTimeout(() => {
        setStatus((cur) => (cur === s ? { kind: "idle" } : cur));
      }, durationMs);
    }
  }

  async function refresh() {
    const r = await loadQnaPairs(tenantSlug);
    setPairs(r.pairs);
    setCount(r.count);
    setSelected(new Set());
  }

  function toggleSelect(qnaId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qnaId)) next.delete(qnaId);
      else next.add(qnaId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)),
    );
  }

  function onDelete(qnaId: string, question: string) {
    if (!canEdit) return;
    if (
      !window.confirm(`Delete "${question.slice(0, 60)}${question.length > 60 ? "…" : ""}"? This cannot be undone.`)
    )
      return;
    flash({ kind: "pending", what: "delete" });
    startTransition(async () => {
      try {
        await deleteQnaPairAction(tenantSlug, qnaId);
        await refresh();
        flash({ kind: "ok", message: "Q&A deleted" });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Delete failed",
        });
      }
    });
  }

  function onBulkDelete() {
    if (!canEdit || selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} Q&A pairs? This cannot be undone.`)) return;
    flash({ kind: "pending", what: "bulk-delete" });
    startTransition(async () => {
      try {
        const r = await bulkDeleteQnaPairsAction(tenantSlug, {
          qnaIds: Array.from(selected),
        });
        await refresh();
        flash({ kind: "ok", message: `${r.count} Q&A pairs deleted` });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Bulk delete failed",
        });
      }
    });
  }

  async function onEditClick(qnaId: string) {
    const full = await loadQnaPair(tenantSlug, qnaId);
    if (full) setEditing(full);
  }

  async function onFormSubmit(input: unknown, currentEdit: QnaPair | "new") {
    flash({
      kind: "pending",
      what: currentEdit === "new" ? "create" : "save",
    });
    try {
      if (currentEdit === "new") {
        await createQnaPairAction(tenantSlug, input);
      } else {
        await updateQnaPairAction(tenantSlug, currentEdit.id, input);
      }
      setEditing(undefined);
      await refresh();
      flash({
        kind: "ok",
        message: currentEdit === "new" ? "Q&A created" : "Q&A saved",
      });
      router.refresh();
    } catch (err) {
      // Server Actions serialize errors as plain Error — parse the
      // duplicate marker out so we can link to the existing pair.
      const msg = err instanceof Error ? err.message : "Save failed";
      const dupMatch = /\[duplicate:([^\]]+)\]/.exec(msg);
      flash({
        kind: "error",
        message: msg.replace(/\s*\[duplicate:[^\]]+\]/, ""),
        duplicateId: dupMatch?.[1],
      });
    }
  }

  return (
    <PageShell width="6xl" className="space-y-6">
      <PageHeader
        eyebrow={<Eyebrow>Knowledge</Eyebrow>}
        title="Q&A pairs"
        description={`Authoritative answers to known questions. When a customer's question matches a Q&A above ${(85).toFixed(0)}% similarity, the AI uses the answer near-verbatim — only adapting language register. ${count} ${count === 1 ? "pair" : "pairs"} total.`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={status} tenantSlug={tenantSlug} />
            {canEdit ? (
            <>
              {selectedCount > 0 ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onBulkDelete}
                >
                  <Trash2 className="size-3.5" />
                  Delete {selectedCount}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={() => setEditing("new")}
                disabled={overCap}
              >
                <Plus className="size-3.5" />
                New Q&amp;A
              </Button>
            </>
          ) : null}
          </div>
        }
      />

      {overCap ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-body-sm text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            You&apos;ve reached the soft cap of {MAX_QNA_PER_TENANT} Q&amp;A pairs.
            Adding more is fine but the AUTHORITATIVE-ANSWER retrieval is
            tuned for ≤ 1,000 pairs — consider archiving stale entries.
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search question or answer…"
            className={cn(
              "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] pl-9 pr-3 text-body text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
            )}
          />
        </div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className={cn(
            "h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
            "transition-colors duration-150 ease-out",
            "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          )}
        >
          <option value="">All languages</option>
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANG_LABELS[l]}
            </option>
          ))}
        </select>
        {allTags.length > 0 ? (
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className={cn(
              "h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
            )}
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          hasPairs={pairs.length > 0}
          onAdd={() => canEdit && setEditing("new")}
          canEdit={canEdit}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]">
                {canEdit ? (
                  <th className="w-10 px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={
                        filtered.length > 0 && selected.size === filtered.length
                      }
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2 text-left font-medium">Question</th>
                <th className="px-3 py-2 text-left font-medium">Answer</th>
                <th className="px-3 py-2 text-left font-medium">Language</th>
                <th className="px-3 py-2 text-left font-medium">Tags</th>
                <th className="px-3 py-2 text-left font-medium">Embedding</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-[var(--bg-surface-elevated)]/50"
                >
                  {canEdit ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.question.slice(0, 40)}`}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 align-top text-[var(--text-primary)]">
                    <div className="line-clamp-2 max-w-[28rem]">{p.question}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--text-secondary)]">
                    <div className="line-clamp-2 max-w-[32rem]">{p.answer}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <LanguageBadge
                      language={p.language as SupportedLanguage | null}
                      lock={p.languageLock}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <TagsCell tags={p.tags} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {p.hasEmbedding ? (
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
                  <td className="px-3 py-2 align-top text-right">
                    {canEdit ? (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEditClick(p.id)}
                          title="Edit"
                          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        >
                          <Pencil className="size-4" aria-hidden />
                          <span className="sr-only">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(p.id, p.question)}
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

      {editing !== undefined ? (
        <Modal onClose={() => setEditing(undefined)}>
          <QnaForm
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

function LanguageBadge({
  language,
  lock,
}: {
  language: SupportedLanguage | null;
  lock: boolean;
}) {
  if (!language) {
    return (
      <span className="text-caption text-[var(--text-tertiary)]">any</span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption",
        lock
          ? "border-[var(--accent-base)]/40 bg-[var(--accent-glow)]/30 text-[var(--accent-hover)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)]",
      )}
      title={
        lock
          ? "Language-locked: this Q&A only matches queries detected to be in this language."
          : "Language hint only — this Q&A can match queries in any language."
      }
    >
      {lock ? <Lock className="size-3" aria-hidden /> : null}
      {language}
    </span>
  );
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-caption text-[var(--text-tertiary)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-caption text-[var(--text-secondary)]"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function StatusPill({
  status,
  tenantSlug,
}: {
  status: Status;
  tenantSlug: string;
}) {
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
        {status.duplicateId ? (
          <a
            href={`/${tenantSlug}/knowledge/qna#${status.duplicateId}`}
            className="ml-1 underline"
          >
            view
          </a>
        ) : null}
      </span>
    );
  }
  return null;
}

function EmptyState({
  hasPairs,
  onAdd,
  canEdit,
}: {
  hasPairs: boolean;
  onAdd: () => void;
  canEdit: boolean;
}) {
  if (hasPairs) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-10 text-center text-body-sm text-[var(--text-tertiary)]">
        No Q&amp;A pairs match the filters.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-12 text-center">
      <MessageSquareText
        aria-hidden
        className="mx-auto size-8 text-[var(--text-tertiary)]"
      />
      <p className="mt-3 text-body text-[var(--text-secondary)]">
        No Q&amp;A pairs yet.
      </p>
      <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
        Add canonical answers to common questions. The AI uses them
        near-verbatim when a customer asks a similar question.
      </p>
      {canEdit ? (
        <Button type="button" size="sm" onClick={onAdd} className="mt-4">
          <Plus className="size-3.5" />
          Add your first Q&amp;A
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
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
