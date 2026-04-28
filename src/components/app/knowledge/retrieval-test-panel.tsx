"use client";

import * as React from "react";
import {
  ExternalLink,
  FileText,
  Globe,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { runRetrieval } from "@/server/knowledge/actions";
import type { RetrievedChunk } from "@/server/knowledge/retriever";

const TYPE_ICON = {
  WEBSITE: Globe,
  FILE: FileText,
  MANUAL: Pencil,
} as const;

/**
 * ts_rank legitimately returns values like 1e-16; toFixed(2) renders those
 * as "0.00", which reads as "near-zero noise" to nobody. Show "<0.01"
 * instead so the chip stays narrow and the meaning is clear. Same threshold
 * applied to vector scores for visual consistency, even though they almost
 * never go that low.
 */
function formatScore(score: number | null): string {
  if (score == null) return "—";
  if (score > 0 && score < 0.01) return "<0.01";
  return score.toFixed(2);
}

export function RetrievalTestPanel({ slug }: { slug: string }) {
  const [query, setQuery] = React.useState("");
  const [topK, setTopK] = React.useState(8);
  const [results, setResults] = React.useState<RetrievedChunk[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleRun = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await runRetrieval(slug, { query, topK });
      setResults(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--accent-base)]" />
        <h3 className="text-h4 text-[var(--text-primary)]">Retrieval test</h3>
      </div>
      <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
        Ask anything a customer might. We show the top results with vector
        and lexical contributions.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && query.trim()) void handleRun();
        }}
        className="mt-4 flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            placeholder="ask anything your customers might"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] py-2 pl-9 pr-3 text-body text-[var(--text-primary)] outline-none focus:border-[var(--accent-base)]"
          />
        </div>
        <Button type="submit" disabled={busy || !query.trim()}>
          Run
        </Button>
      </form>

      <div className="mt-3 flex items-center gap-3 text-caption text-[var(--text-tertiary)]">
        <span>Top-K</span>
        <input
          type="range"
          min={1}
          max={20}
          value={topK}
          onChange={(e) => setTopK(Number(e.target.value))}
          className="h-1 w-40 accent-[var(--accent-base)]"
        />
        <span className="tabular-nums text-[var(--text-secondary)]">{topK}</span>
      </div>

      {error ? (
        <div className="mt-4 text-caption text-[var(--danger)]">{error}</div>
      ) : null}

      {results !== null ? (
        results.length === 0 ? (
          <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]/40 p-4 text-body-sm text-[var(--text-secondary)]">
            No results — add some sources first, or try a different query.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {results.map((h, i) => {
              const Icon = TYPE_ICON[h.sourceType];
              const meta = (h.metadata ?? {}) as { url?: string };
              return (
                <li
                  key={h.chunkId}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]/40 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-body-sm text-[var(--text-primary)]">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                      <span className="truncate">
                        {i + 1}. {h.sourceName}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-caption">
                      <span className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                        vec {formatScore(h.vectorScore)}
                      </span>
                      <span className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                        lex {formatScore(h.lexicalScore)}
                      </span>
                      <span className="rounded bg-[var(--accent-base)]/15 px-1.5 py-0.5 text-[var(--accent-hover)]">
                        rrf {h.rrfScore.toFixed(4)}
                      </span>
                      <span className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[var(--text-tertiary)]">
                        {h.embedProvider}
                      </span>
                    </div>
                  </div>
                  {meta.url ? (
                    <a
                      href={meta.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-caption text-[var(--accent-hover)] hover:underline"
                      title={meta.url}
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span className="truncate">{meta.url}</span>
                    </a>
                  ) : null}
                  <p className="mt-1.5 line-clamp-3 text-body-sm text-[var(--text-secondary)]">
                    {h.content}
                  </p>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </Card>
  );
}
