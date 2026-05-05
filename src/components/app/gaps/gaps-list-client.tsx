"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Clock,
  HelpCircle,
  Loader2,
  MessagesSquare,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  dismissGapAction,
  loadGapsDigest,
  markClusterResolvedAction,
} from "@/server/knowledge/gaps/actions";
import { createQnaPairAction } from "@/server/knowledge/qna/actions";
import type {
  GapClusterSummary,
  UnclusteredGapSummary,
} from "@/server/db/knowledge-gaps";
import type { QnaPairInput } from "@/lib/qna";
import { QnaForm } from "@/components/app/qna/qna-form";

/**
 * Knowledge Gaps digest (Phase 8g-3).
 *
 * Two sections:
 *   - CLUSTERED: gap clusters from the last 30 days, grouped by
 *     clusterKey. Each cluster shows the representative (most-recent)
 *     question, member count, and date range. "Create Q&A from gap"
 *     opens the QnaForm pre-filled with the question; on save, the
 *     entire cluster gets marked resolved.
 *   - UNCLUSTERED: gaps where the worker skipped clustering past the
 *     candidate cap. Surfaces the backlog so operators see degraded
 *     clustering rather than silent failure.
 *
 * The dismiss action (per-cluster or per-gap) marks gap rows resolved
 * without creating a Q&A — for cases where the gap was a one-off, a
 * spam, or genuinely outside the AI's scope.
 */

type Status =
  | { kind: "idle" }
  | { kind: "pending"; what: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

type CreateQnaTarget =
  | { from: "cluster"; clusterKey: string; question: string }
  | { from: "gap"; gapId: string; question: string };

export function GapsListClient({
  tenantSlug,
  initialClusters,
  initialUnclustered,
  canResolve,
}: {
  tenantSlug: string;
  initialClusters: GapClusterSummary[];
  initialUnclustered: UnclusteredGapSummary[];
  canResolve: boolean;
}) {
  const router = useRouter();
  const [clusters, setClusters] = useState(initialClusters);
  const [unclustered, setUnclustered] = useState(initialUnclustered);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [creatingFrom, setCreatingFrom] = useState<CreateQnaTarget | null>(null);
  const [, startTransition] = useTransition();

  function flash(s: Status, durationMs = 3000) {
    setStatus(s);
    if (s.kind === "ok" || s.kind === "error") {
      setTimeout(() => {
        setStatus((cur) => (cur === s ? { kind: "idle" } : cur));
      }, durationMs);
    }
  }

  async function refresh() {
    const r = await loadGapsDigest(tenantSlug);
    setClusters(r.clusters);
    setUnclustered(r.unclustered);
  }

  function onDismissCluster(clusterKey: string, count: number) {
    if (!canResolve) return;
    if (!window.confirm(`Dismiss this cluster (${count} gap${count === 1 ? "" : "s"})?`)) return;
    flash({ kind: "pending", what: "dismiss-cluster" });
    startTransition(async () => {
      try {
        const r = await markClusterResolvedAction(tenantSlug, { clusterKey });
        await refresh();
        flash({ kind: "ok", message: `Dismissed ${r.count} gap${r.count === 1 ? "" : "s"}` });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Dismiss failed",
        });
      }
    });
  }

  function onDismissGap(gapId: string) {
    if (!canResolve) return;
    flash({ kind: "pending", what: "dismiss-gap" });
    startTransition(async () => {
      try {
        await dismissGapAction(tenantSlug, { gapId });
        await refresh();
        flash({ kind: "ok", message: "Gap dismissed" });
      } catch (err) {
        flash({
          kind: "error",
          message: err instanceof Error ? err.message : "Dismiss failed",
        });
      }
    });
  }

  async function onQnaSave(input: QnaPairInput) {
    if (!creatingFrom) return;
    flash({ kind: "pending", what: "create-qna" });
    try {
      await createQnaPairAction(tenantSlug, input);
      // Roll up the resolution: mark every gap in the cluster (or just
      // this single unclustered gap) as resolved.
      if (creatingFrom.from === "cluster") {
        await markClusterResolvedAction(tenantSlug, {
          clusterKey: creatingFrom.clusterKey,
        });
      } else {
        await dismissGapAction(tenantSlug, { gapId: creatingFrom.gapId });
      }
      setCreatingFrom(null);
      await refresh();
      flash({ kind: "ok", message: "Q&A created — cluster resolved" });
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      flash({
        kind: "error",
        message: msg.replace(/\s*\[duplicate:[^\]]+\]/, ""),
      });
    }
  }

  return (
    <PageShell width="5xl" className="space-y-6">
      <PageHeader
        eyebrow={<Eyebrow>Knowledge</Eyebrow>}
        title="Knowledge gaps"
        description={`Customer questions the AI couldn't answer in the last 30 days. Similar questions cluster together so a single new Q&A pair can resolve a whole pattern. ${clusters.length} active cluster${clusters.length === 1 ? "" : "s"}${unclustered.length > 0 ? ` · ${unclustered.length} unclustered` : ""}.`}
        actions={<StatusPill status={status} />}
      />

      {/* Clustered section ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-h4 text-[var(--text-primary)]">Clusters</h2>
        {clusters.length === 0 ? (
          <ClustersEmptyState />
        ) : (
          <div className="space-y-2">
            {clusters.map((c) => (
              <ClusterCard
                key={c.clusterKey}
                cluster={c}
                canResolve={canResolve}
                pending={status.kind === "pending"}
                onCreateQna={() =>
                  setCreatingFrom({
                    from: "cluster",
                    clusterKey: c.clusterKey,
                    question: c.representativeQuestion,
                  })
                }
                onDismiss={() => onDismissCluster(c.clusterKey, c.count)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Unclustered backlog ────────────────────────────────────── */}
      {unclustered.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-3 text-body-sm text-[var(--warning)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">
                {unclustered.length} unclustered gap{unclustered.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[var(--text-secondary)]">
                The clusterer skipped these — either the candidate cap was hit
                during cluster-on-write, or the gap is too dissimilar to recent
                ones to fold into a cluster yet. They&apos;re still answerable
                individually.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {unclustered.map((g) => (
              <UnclusteredCard
                key={g.id}
                gap={g}
                canResolve={canResolve}
                pending={status.kind === "pending"}
                onCreateQna={() =>
                  setCreatingFrom({
                    from: "gap",
                    gapId: g.id,
                    question: g.question,
                  })
                }
                onDismiss={() => onDismissGap(g.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Create Q&A modal ─────────────────────────────────────── */}
      {creatingFrom !== null ? (
        <Modal onClose={() => setCreatingFrom(null)}>
          <QnaForm
            initial={null}
            initialQuestion={creatingFrom.question}
            onCancel={() => setCreatingFrom(null)}
            onSubmit={onQnaSave}
          />
        </Modal>
      ) : null}
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function ClusterCard({
  cluster,
  canResolve,
  pending,
  onCreateQna,
  onDismiss,
}: {
  cluster: GapClusterSummary;
  canResolve: boolean;
  pending: boolean;
  onCreateQna: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-base)]/40 bg-[var(--accent-glow)]/30 px-2 py-0.5 text-caption text-[var(--accent-hover)]">
              <MessagesSquare className="size-3" aria-hidden />
              {cluster.count} gap{cluster.count === 1 ? "" : "s"}
            </span>
            {cluster.language ? (
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-caption text-[var(--text-secondary)]">
                {cluster.language}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
              <Clock className="size-3" aria-hidden />
              {formatRange(cluster.firstSeenAt, cluster.lastSeenAt)}
            </span>
          </div>
          <p className="text-body text-[var(--text-primary)]">{cluster.representativeQuestion}</p>
        </div>
        {canResolve ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onCreateQna}
              disabled={pending}
            >
              <Sparkles className="size-3.5" />
              Create Q&amp;A
            </Button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={pending}
              title="Dismiss cluster"
              className="text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-60"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UnclusteredCard({
  gap,
  canResolve,
  pending,
  onCreateQna,
  onDismiss,
}: {
  gap: UnclusteredGapSummary;
  canResolve: boolean;
  pending: boolean;
  onCreateQna: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-body-sm text-[var(--text-primary)]">{gap.question}</p>
          <div className="flex items-center gap-3 text-caption text-[var(--text-tertiary)]">
            {gap.language ? <span>{gap.language}</span> : null}
            <span>{relTime(gap.createdAt)}</span>
          </div>
        </div>
        {canResolve ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCreateQna}
              disabled={pending}
            >
              Create Q&amp;A
            </Button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={pending}
              title="Dismiss"
              className="text-[var(--text-tertiary)] hover:text-[var(--danger)] disabled:opacity-60"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ClustersEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-6 py-12 text-center">
      <HelpCircle aria-hidden className="mx-auto size-8 text-[var(--text-tertiary)]" />
      <p className="mt-3 text-body text-[var(--text-secondary)]">No gaps yet.</p>
      <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
        When a customer asks something the AI can&apos;t answer (escalation
        =&nbsp;<code>OUTSIDE_SCOPE</code>), the question logs here and similar
        ones cluster together so you can answer them once.
      </p>
    </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function relTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRange(first: Date | string, last: Date | string): string {
  const f = typeof first === "string" ? new Date(first) : first;
  const l = typeof last === "string" ? new Date(last) : last;
  if (f.toDateString() === l.toDateString()) return relTime(l);
  return `${relTime(f)} → ${relTime(l)}`;
}
