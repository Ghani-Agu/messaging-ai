"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { SidebarNav, type SidebarNavCounts } from "./sidebar-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";
import { Eyebrow } from "@/components/ui/eyebrow";
import { TooltipHint } from "@/components/ui/tooltip";
import { easeSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sidebar-collapsed";
const WIDTH_EXPANDED = 240;
const WIDTH_COLLAPSED = 64;

type SidebarProps = {
  tenant: { id: string; slug: string; name: string };
  memberships: Array<{
    tenantId: string;
    tenant: { id: string; slug: string; name: string };
  }>;
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
  /**
   * Live counts for badge-bearing nav items. Phase B passes zeros (the
   * placeholder visual lights up); phase D wires real numbers from the
   * dashboard-metrics queries.
   */
  counts?: SidebarNavCounts;
  /**
   * Whether the current tenant has a brand logo asset at `/<slug>.png`.
   * Resolved upstream from `getTenantBrand(slug)` so the sidebar doesn't
   * touch the filesystem at render time. Forwards to WorkspaceSwitcher.
   */
  hasBrandLogo?: boolean;
};

/**
 * Operator-app sidebar. Collapsible (persisted in localStorage), with an
 * eyebrow-sectioned layout: Workspace block → Navigation list → footer
 * (AI Brain card + UserMenu). The ⌘K trigger is no longer rendered as a
 * dedicated button — the global keybinding still works (see
 * CommandPaletteTrigger's keydown handler in the layout).
 */
export function Sidebar({
  tenant,
  memberships,
  user,
  counts,
  hasBrandLogo = false,
}: SidebarProps) {
  const prefersReducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);

  // Hydrate the saved preference. Default expanded.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable in private mode — silent fallback to default.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  return (
    <motion.aside
      aria-label="Primary navigation"
      initial={false}
      animate={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
      transition={prefersReducedMotion ? { duration: 0 } : easeSpring}
      className={cn(
        // Hidden at sm; flex column from md+. Mobile drawer is deferred —
        // see the placeholder hamburger in the tenant layout.
        // TODO: phase 11-9 — mobile drawer.
        "hidden h-screen shrink-0 flex-col overflow-hidden md:flex",
        "border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 backdrop-blur-md",
      )}
    >
      {/* Brand area */}
      <div className="flex flex-col gap-2 px-3 pt-3">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2 px-1">
            <Eyebrow>Workspace</Eyebrow>
            <CollapseToggle collapsed={collapsed} onToggle={toggle} />
          </div>
        ) : (
          <CollapseToggle collapsed={collapsed} onToggle={toggle} />
        )}
        <WorkspaceSwitcher
          current={tenant}
          memberships={memberships}
          compact={collapsed}
          currentHasBrandLogo={hasBrandLogo}
        />
      </div>

      {/* Navigation */}
      <div className="custom-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {!collapsed ? (
          <Eyebrow className="mb-2 px-2">Navigation</Eyebrow>
        ) : null}
        <SidebarNav
          tenantSlug={tenant.slug}
          collapsed={collapsed}
          counts={counts}
        />
      </div>

      {/* Footer */}
      <div className="space-y-3 border-t border-[var(--border-subtle)] p-3">
        {!collapsed ? <AiBrainCard /> : null}
        <UserMenu user={user} compact={collapsed} />
      </div>
    </motion.aside>
  );
}

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <TooltipHint label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
          "text-[var(--text-tertiary)]",
          "transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-secondary)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
      >
        {collapsed ? (
          <ChevronsRight className="size-3.5" />
        ) : (
          <ChevronsLeft className="size-3.5" />
        )}
      </button>
    </TooltipHint>
  );
}

/**
 * Footer info card. Phase B ships the visual + the eyebrow + the gradient
 * progress-bar shell; phase D wires the real confidence rate from a
 * server query and replaces the "—" caption with a percentage.
 */
function AiBrainCard() {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <Eyebrow icon={Sparkles} variant="accent">
          AI Brain
        </Eyebrow>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div
          aria-hidden
          className="h-full w-0 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, var(--accent-active) 0%, var(--accent-hover) 100%)",
            boxShadow: "0 0 6px var(--accent-glow)",
          }}
        />
      </div>
      <p className="mt-2 text-caption text-[var(--text-tertiary)]">—</p>
    </div>
  );
}
