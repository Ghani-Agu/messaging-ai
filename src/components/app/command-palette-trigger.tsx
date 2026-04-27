"use client";

import { Search } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Visible button + global ⌘K hotkey listener. The actual palette UI is
 * mounted in the (app) shell (see CommandPalette in step 10) and listens
 * for a custom event that this trigger dispatches.
 */
export function CommandPaletteTrigger() {
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
