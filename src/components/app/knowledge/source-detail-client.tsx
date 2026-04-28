"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  Pencil,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { KnowledgeChunk, KnowledgeSource } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  deleteSource as deleteSourceAction,
  reingestSource,
} from "@/server/knowledge/actions";

const TYPE_ICON = {
  WEBSITE: Globe,
  FILE: FileText,
  MANUAL: Pencil,
} as const;

const STATUS_PILL = {
  PENDING: { label: "Queued", tone: "border-[var(--border-default)] text-[var(--text-secondary)]", icon: Clock },
  PROCESSING: { label: "Processing", tone: "border-[var(--accent-base)]/40 text-[var(--accent-hover)]", icon: Loader2, spin: true },
  READY: { label: "Ready", tone: "border-[var(--success)]/40 text-[var(--success)]", icon: CheckCircle2 },
  ERROR: { label: "Error", tone: "border-[var(--danger)]/40 text-[var(--danger)]", icon: AlertTriangle },
} as const;

type LogEntry = { ts: string; level: "info" | "ok" | "err"; text: string };

type ChunkMeta = {
  url?: string;
  headingPath?: string[];
  position?: number;
};

export function SourceDetailClient({
  slug,
  source,
  chunks,
}: {
  slug: string;
  source: KnowledgeSource;
  chunks: KnowledgeChunk[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"reingest" | "delete" | null>(null);

  // Polling: while processing or pending, refresh the route every 2500ms
  // so the SC re-fetches status / progress / new chunks.
  const inProgress = source.status === "PENDING" || source.status === "PROCESSING";
  React.useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [inProgress, router]);

  const Icon = TYPE_ICON[source.type];
  const pill = STATUS_PILL[source.status];
  const PillIcon = pill.icon;
  const log = ((source.metadata as { log?: LogEntry[] } | null)?.log ?? []) as LogEntry[];

  const handleReingest = async () => {
    setBusy("reingest");
    try {
      await reingestSource(slug, { sourceId: source.id });
      router.refresh();
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
      await deleteSourceAction(slug, { sourceId: source.id });
      router.push(`/${slug}/knowledge`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <a
        href={`/${slug}/knowledge`}
        className="inline-flex items-center gap-1 text-body-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to sources
      </a>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
              <h2 className="text-h3 text-[var(--text-primary)]">{source.name}</h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border bg-[var(--bg-surface)] px-2 py-0.5 text-caption",
                  pill.tone,
                )}
              >
                <PillIcon className={cn("h-3 w-3", "spin" in pill && pill.spin && "animate-spin")} />
                {pill.label}
              </span>
            </div>
            <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
              {chunks.length} chunks ·{" "}
              {source.lastIngestedAt
                ? new Date(source.lastIngestedAt).toLocaleString()
                : "not yet ingested"}
            </p>
            {source.sourceUrl && source.type === "WEBSITE" ? (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-caption text-[var(--accent-hover)] hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {source.sourceUrl}
              </a>
            ) : null}
            {source.error ? (
              <div className="mt-2 text-body-sm text-[var(--danger)]">
                {source.error}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy !== null} onClick={handleReingest}>
              <RefreshCcw
                className={cn("mr-1.5 h-4 w-4", busy === "reingest" && "animate-spin")}
              />
              Re-ingest
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={handleDelete}
              className="text-[var(--danger)] hover:text-[var(--danger)]"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-0">
          <div className="border-b border-[var(--border-subtle)] px-5 py-3 text-body-sm text-[var(--text-secondary)]">
            Chunks
          </div>
          {chunks.length === 0 ? (
            <div className="px-5 py-6 text-body-sm text-[var(--text-tertiary)]">
              {source.status === "PROCESSING"
                ? "Chunking in progress…"
                : source.status === "ERROR"
                  ? "Ingestion failed before any chunks landed."
                  : "No chunks yet."}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {chunks.map((c) => {
                const meta = (c.metadata ?? {}) as ChunkMeta;
                const path = meta.headingPath ?? [];
                return (
                  <li key={c.id} className="px-5 py-3">
                    {path.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
                        {path.map((h, i) => (
                          <React.Fragment key={i}>
                            <span>{h}</span>
                            {i < path.length - 1 ? (
                              <ChevronRight className="h-3 w-3" />
                            ) : null}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1 line-clamp-4 text-body-sm text-[var(--text-primary)]">
                      {c.content}
                    </p>
                    {meta.url ? (
                      <a
                        href={meta.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-caption text-[var(--accent-hover)] hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span className="truncate">{meta.url}</span>
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-[var(--border-subtle)] px-5 py-3 text-body-sm text-[var(--text-secondary)]">
            Ingestion log
          </div>
          {log.length === 0 ? (
            <div className="px-5 py-3 text-caption text-[var(--text-tertiary)]">
              No log entries yet.
            </div>
          ) : (
            <ul className="space-y-1 px-5 py-3 font-mono text-caption text-[var(--text-secondary)]">
              {log.map((l, i) => (
                <li
                  key={i}
                  className={cn(
                    l.level === "ok" && "text-[var(--success)]",
                    l.level === "err" && "text-[var(--danger)]",
                  )}
                >
                  <span className="mr-2 text-[var(--text-tertiary)]">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  {l.text}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
