"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { durationMedium, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Rendered on /knowledge/live-data when no LiveDataSource rows exist
 * for the tenant. Primary CTA opens the Connect Odoo modal; the footer
 * teases future integrations without overpromising.
 *
 * Member roles (non-OWNER) see the same empty state but with the
 * primary CTA hidden — operators that can't connect a source see
 * "no sources connected" without a dead-end button.
 */
export function LiveDataEmptyState({
  canConnect,
  onConnectOdoo,
  className,
}: {
  canConnect: boolean;
  onConnectOdoo: () => void;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { duration: durationMedium, ease: easeOutExpo }
      }
      className={cn(
        "rounded-lg border border-dashed border-[var(--border-subtle)]",
        "bg-[var(--bg-surface)]/50 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mx-auto mb-4 flex size-11 items-center justify-center rounded-md",
          "border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
          "bg-[var(--bg-surface)] text-[var(--accent-hover)]",
        )}
      >
        <Database className="size-5" />
      </span>
      <h2 className="text-h3 text-[var(--text-primary)]">
        Connect a live data source
      </h2>
      <p className="mx-auto mt-2 max-w-md text-body text-[var(--text-secondary)]">
        Auto-sync your product catalog so the AI always answers with
        current pricing, stock, and details. Manual edits stay
        side-by-side with synced products.
      </p>
      {canConnect ? (
        <div className="mt-6">
          <Button onClick={onConnectOdoo} size="md">
            <Plus className="size-4" aria-hidden />
            Connect Odoo
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-caption text-[var(--text-tertiary)]">
          Only workspace owners can connect a data source. Ask your
          owner to set this up.
        </p>
      )}
      <p className="mt-8 text-caption text-[var(--text-tertiary)]">
        More integrations coming: Shopify, WooCommerce, Google Sheets,
        CSV import.
      </p>
    </motion.div>
  );
}
