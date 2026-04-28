"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  createFileSource,
  createManualSource,
  createWebsiteSource,
  deleteSource as deleteSourceAction,
  finalizeFileUpload,
  listSources,
  reingestSource,
} from "@/server/knowledge/actions";
import type { SourceSummary } from "@/server/db/knowledge";
import { RetrievalTestPanel } from "./retrieval-test-panel";

const TYPE_ICON = {
  WEBSITE: Globe,
  FILE: FileText,
  MANUAL: Pencil,
} as const;

type Status = SourceSummary["status"];

const STATUS_PILL: Record<
  Status,
  { label: string; tone: string; icon: typeof Clock; spin?: boolean }
> = {
  PENDING: { label: "Queued", tone: "border-[var(--border-default)] text-[var(--text-secondary)]", icon: Clock },
  PROCESSING: { label: "Processing", tone: "border-[var(--accent-base)]/40 text-[var(--accent-hover)]", icon: Loader2, spin: true },
  READY: { label: "Ready", tone: "border-[var(--success)]/40 text-[var(--success)]", icon: CheckCircle2 },
  ERROR: { label: "Error", tone: "border-[var(--danger)]/40 text-[var(--danger)]", icon: AlertTriangle },
};

function StatusPill({ status }: { status: Status }) {
  const { label, tone, icon: Icon, spin } = STATUS_PILL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-[var(--bg-surface)] px-2 py-0.5 text-caption",
        tone,
      )}
    >
      <Icon className={cn("h-3 w-3", spin && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}

function relTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isInProgress(s: SourceSummary): boolean {
  return s.status === "PENDING" || s.status === "PROCESSING";
}

type Props = {
  slug: string;
  initialSources: SourceSummary[];
};

export function KnowledgeListClient({ slug, initialSources }: Props) {
  const router = useRouter();
  const [sources, setSources] = React.useState(initialSources);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Polling: while any source is PENDING/PROCESSING, refresh the list
  // every 2500ms via the listSources Server Action.
  const hasInProgress = sources.some(isInProgress);
  React.useEffect(() => {
    if (!hasInProgress) return;
    const id = setInterval(async () => {
      try {
        const next = await listSources(slug);
        setSources(next);
      } catch (err) {
        console.error("[poll] listSources failed:", err);
      }
    }, 2500);
    return () => clearInterval(id);
  }, [slug, hasInProgress]);

  return (
    <div className="space-y-12 pb-24">
      <header className="flex items-end justify-between border-b border-[var(--border-subtle)] pb-6">
        <div>
          <h1 className="text-h2 text-[var(--text-primary)]">Knowledge</h1>
          <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
            Teach your AI by adding website crawls, files, or manual entries.
            Sources are chunked, embedded, and made retrievable at reply time.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add source
        </Button>
      </header>

      {sources.length === 0 ? (
        <EmptyState onAdd={() => setModalOpen(true)} />
      ) : (
        <SourcesTable
          slug={slug}
          rows={sources}
          onChange={() => router.refresh()}
        />
      )}

      <RetrievalTestPanel slug={slug} />

      <AddSourceModal
        slug={slug}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + table
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-surface-elevated)]">
        <Sparkles className="h-5 w-5 text-[var(--accent-base)]" aria-hidden />
      </div>
      <h3 className="text-h4 text-[var(--text-primary)]">
        Your AI has nothing to read yet
      </h3>
      <p className="mt-2 max-w-md text-body-sm text-[var(--text-secondary)]">
        Paste your website URL, upload a PDF, or write a manual entry. Most
        setups are useful within a few minutes of the first crawl finishing.
      </p>
      <Button onClick={onAdd} className="mt-6">
        <Plus className="mr-1.5 h-4 w-4" />
        Add your first source
      </Button>
    </Card>
  );
}

function SourcesTable({
  slug,
  rows,
  onChange,
}: {
  slug: string;
  rows: SourceSummary[];
  onChange: () => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-body-sm">
        <thead className="bg-[var(--bg-surface-elevated)]/50 text-caption uppercase tracking-wide text-[var(--text-tertiary)]">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">Source</th>
            <th className="px-4 py-2.5 text-left font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Chunks</th>
            <th className="px-4 py-2.5 text-left font-medium">Last ingested</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const Icon = TYPE_ICON[r.type];
            const progress = (r.progress ?? {}) as {
              pagesCrawled?: number;
              totalPages?: number;
              chunksEmbedded?: number;
              totalChunks?: number;
            };
            return (
              <tr
                key={r.id}
                className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-surface-elevated)]/40"
              >
                <td className="px-4 py-3">
                  <a
                    href={`/${slug}/knowledge/${r.id}`}
                    className="flex items-center gap-2.5 text-[var(--text-primary)] hover:text-[var(--accent-hover)]"
                  >
                    <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
                    <span>{r.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  </a>
                  {r.status === "PROCESSING" && progress.totalPages ? (
                    <div className="mt-1 ml-6 text-caption text-[var(--text-tertiary)]">
                      Crawled {progress.pagesCrawled ?? 0} /{" "}
                      {progress.totalPages} pages
                    </div>
                  ) : null}
                  {r.status === "PROCESSING" && progress.totalChunks ? (
                    <div className="mt-1 ml-6 text-caption text-[var(--text-tertiary)]">
                      Embedded {progress.chunksEmbedded ?? 0} /{" "}
                      {progress.totalChunks} chunks
                    </div>
                  ) : null}
                  {r.status === "ERROR" && r.error ? (
                    <div className="mt-1 ml-6 text-caption text-[var(--danger)]/80">
                      {r.error}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                  {r.chunkCount}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {relTime(r.lastIngestedAt)}
                </td>
                <td className="px-4 py-3">
                  <RowActions slug={slug} sourceId={r.id} onChange={onChange} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function RowActions({
  slug,
  sourceId,
  onChange,
}: {
  slug: string;
  sourceId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = React.useState<"reingest" | "delete" | null>(null);

  const handleReingest = async () => {
    setBusy("reingest");
    try {
      await reingestSource(slug, { sourceId });
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Re-ingest failed");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this source and all its chunks?")) return;
    setBusy("delete");
    try {
      await deleteSourceAction(slug, { sourceId });
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={handleReingest}
        aria-label="Re-ingest"
      >
        <RefreshCcw
          className={cn(
            "h-3.5 w-3.5",
            busy === "reingest" && "animate-spin",
          )}
        />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={handleDelete}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add source modal
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "website" | "file" | "manual";

function AddSourceModal({
  slug,
  open,
  onClose,
  onCreated,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>("website");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Form state per tab.
  const [websiteUrl, setWebsiteUrl] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [manualName, setManualName] = React.useState("");
  const [manualContent, setManualContent] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      // Reset form when closed.
      setError(null);
      setWebsiteUrl("");
      setFile(null);
      setManualName("");
      setManualContent("");
      setSubmitting(false);
      setTab("website");
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (tab === "website") {
        await createWebsiteSource(slug, { url: websiteUrl });
      } else if (tab === "file") {
        if (!file) throw new Error("Choose a file first");
        const { sourceId, signedUrl } = await createFileSource(slug, {
          filename: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
        });
        const put = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream" },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await finalizeFileUpload(slug, { sourceId });
      } else {
        await createManualSource(slug, {
          name: manualName,
          content: manualContent,
        });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-xl p-0">
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h3 className="text-h4 text-[var(--text-primary)]">
              Add knowledge source
            </h3>
            <p className="text-body-sm text-[var(--text-secondary)]">
              Crawls run on our side; you can close this dialog and watch
              progress in the list.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-1 border-b border-[var(--border-subtle)] px-5">
          {(["website", "file", "manual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-body-sm capitalize transition-colors",
                tab === t
                  ? "border-[var(--accent-base)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="px-5 py-5">
          {tab === "website" && (
            <>
              <label className="text-body-sm text-[var(--text-secondary)]">
                Website URL
              </label>
              <input
                type="url"
                placeholder="https://your-store.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--accent-base)]"
              />
              <ul className="mt-3 space-y-1 text-caption text-[var(--text-tertiary)]">
                <li>• Crawls up to 50 pages, depth ≤ 3, same-domain only.</li>
                <li>• You can re-ingest later to pick up changes.</li>
              </ul>
            </>
          )}

          {tab === "file" && (
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface-elevated)]/40 px-6 py-10 text-center hover:border-[var(--accent-base)]/60"
            >
              <Upload className="h-5 w-5 text-[var(--text-tertiary)]" />
              <div className="text-body text-[var(--text-primary)]">
                {file ? file.name : "Drop a file or click to browse"}
              </div>
              <div className="text-caption text-[var(--text-tertiary)]">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || "—"}`
                  : "PDF, DOCX, TXT — up to 25 MB"}
              </div>
              <input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}

          {tab === "manual" && (
            <>
              <label className="text-body-sm text-[var(--text-secondary)]">
                Title
              </label>
              <input
                placeholder="e.g. Returns policy"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="mb-3 mt-1.5 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--accent-base)]"
              />
              <label className="text-body-sm text-[var(--text-secondary)]">
                Content
              </label>
              <textarea
                rows={8}
                placeholder="Paste the answer or policy text here…"
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                className="mt-1.5 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--accent-base)]"
              />
              <div className="mt-2 text-caption text-[var(--text-tertiary)]">
                Up to ~50,000 characters.
              </div>
            </>
          )}

          {error ? (
            <div className="mt-3 text-caption text-[var(--danger)]">{error}</div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {tab === "manual" ? "Save entry" : "Start ingestion"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
