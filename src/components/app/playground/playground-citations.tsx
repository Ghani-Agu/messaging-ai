"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { durationFast, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  iconForKind,
  labelForKind,
  type CitationKind,
} from "./playground-citation-kinds";

/**
 * Wire shape produced by /api/playground/messages and the widget route.
 * Mirrors the BrainCitation discriminated union, flattened for transport:
 * every citation has an index, kind, sourceName, optional sourceUrl, and
 * a preview snippet. `kind` is widened to `string` so a new server-side
 * citation kind doesn't crash the client — see playground-citation-kinds
 * for the fallback icon/label.
 */
export type PlaygroundCitation = {
  index: number;
  kind: CitationKind | (string & {});
  sourceName: string;
  sourceUrl?: string;
  preview: string;
};

/**
 * Citations strip rendered below an AI message. Each citation is a
 * clickable chip. Clicking expands an inline preview of the chunk's
 * content; clicking again collapses. Multiple chips can be open at once
 * — this matches the operator-debug use case (compare two sources).
 */
export function PlaygroundCitations({
  citations,
}: {
  citations: PlaygroundCitation[];
}) {
  const prefersReducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (citations.length === 0) return null;

  function toggle(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {citations.map((c) => {
          const Icon = iconForKind(c.kind);
          const isOpen = expanded.has(c.index);
          return (
            <button
              key={c.index}
              type="button"
              onClick={() => toggle(c.index)}
              aria-expanded={isOpen}
              aria-label={`${labelForKind(c.kind)}: ${c.sourceName}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                "transition-colors duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
                isOpen
                  ? "border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
              )}
            >
              <Icon className="size-3" aria-hidden />
              <span className="font-mono tabular-nums">[{c.index}]</span>
              <span className="max-w-[14ch] truncate">{c.sourceName}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence initial={false}>
        {citations
          .filter((c) => expanded.has(c.index))
          .map((c) => (
            <motion.div
              key={c.index}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: durationFast, ease: easeOutExpo }
              }
              className="overflow-hidden"
            >
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-caption font-medium text-[var(--text-tertiary)]">
                    [{c.index}] {labelForKind(c.kind)} — {c.sourceName}
                  </span>
                  {c.sourceUrl ? (
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-caption text-[var(--accent-hover)] hover:underline"
                    >
                      Open
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </div>
                <p className="text-body-sm text-[var(--text-secondary)]">
                  {c.preview}
                </p>
              </div>
            </motion.div>
          ))}
      </AnimatePresence>
    </div>
  );
}
