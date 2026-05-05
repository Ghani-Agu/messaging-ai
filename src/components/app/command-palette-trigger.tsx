"use client";

import { Search } from "lucide-react";
import { useEffect } from "react";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Visible button + global ⌘K / Ctrl-K hotkey listener. The actual palette
 * UI is mounted in the tenant layout (see CommandPalette) and listens for
 * a `command-palette:open` custom event that this trigger dispatches.
 *
 * Both the click handler and the keydown listener dispatch the same event,
 * so mounting this once anywhere in the chrome wires both affordances.
 */
export function CommandPaletteTrigger({
  compact = false,
}: {
  /** Icon-only square button for the collapsed sidebar. */
  compact?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMacMeta = e.metaKey;
      const isOtherCtrl = e.ctrlKey && !e.metaKey;
      if ((isMacMeta || isOtherCtrl) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("command-palette:open"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function open() {
    window.dispatchEvent(new CustomEvent("command-palette:open"));
  }

  if (compact) {
    return (
      <TooltipHint label="Search (⌘K)">
        <button
          type="button"
          onClick={open}
          aria-label="Search"
          className={cn(
            "flex size-10 items-center justify-center rounded-md",
            "text-[var(--text-secondary)]",
            "transition-colors duration-150 ease-out",
            "hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
          )}
        >
          <Search className="size-4" aria-hidden />
        </button>
      </TooltipHint>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5",
        "text-body-sm text-[var(--text-tertiary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
      )}
    >
      <Search className="size-3.5" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
        ⌘K
      </kbd>
    </button>
  );
}
