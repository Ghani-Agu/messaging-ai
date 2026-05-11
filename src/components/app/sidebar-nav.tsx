"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  ContactRound,
  Database,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  MessageSquareText,
  Package,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TooltipHint } from "@/components/ui/tooltip";
import type { PermissionSlug } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** Keys keep the count source in sync with the SidebarNavCounts shape. */
type CountKey = "conversations" | "gaps";

type NavItem = {
  href: (slug: string) => string;
  label: string;
  icon: LucideIcon;
  /** Phase the item becomes interactive — used as a tooltip hint for now. */
  phase?: number;
  /** When set, render a count badge sourced from props.counts[countKey]. */
  countKey?: CountKey;
  /** Page-view permission the user must have for this nav entry to render. */
  permission: PermissionSlug;
};

// Order: daily ops → knowledge → config.
//
// 1. Daily ops (Dashboard, Conversations, Contacts, Playground) — what an
//    operator touches on a typical day: monitoring + customer lookup + AI
//    testing.
// 2. Knowledge cluster (Documents → Products → Q&A → Business Info →
//    Live Data Sources → Knowledge Gaps) — sources of truth the brain
//    retrieves over, grouped contiguously. Business Info kept top-level
//    (not nested under "Knowledge") per the Gate-1 K8 override from
//    Phase 8 — these are daily operator actions and deserve top-level
//    visibility.
// 3. Config (Channels, Settings) — rare, sticky-bottom.
const ITEMS: NavItem[] = [
  { href: (s) => `/${s}/dashboard`, label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: (s) => `/${s}/conversations`, label: "Conversations", icon: MessageSquare, phase: 5, countKey: "conversations", permission: "conversations:view" },
  { href: (s) => `/${s}/contacts`, label: "Contacts", icon: ContactRound, permission: "contacts:view" },
  { href: (s) => `/${s}/playground`, label: "Playground", icon: Sparkles, phase: 4, permission: "playground:view" },
  { href: (s) => `/${s}/knowledge`, label: "Documents", icon: BookOpen, phase: 3, permission: "documents:view" },
  { href: (s) => `/${s}/knowledge/items`, label: "Products", icon: Package, phase: 8, permission: "products:view" },
  { href: (s) => `/${s}/knowledge/qna`, label: "Q&A", icon: MessageSquareText, phase: 8, permission: "qna:view" },
  { href: (s) => `/${s}/knowledge/business-info`, label: "Business Info", icon: Building2, phase: 8, permission: "business-info:view" },
  { href: (s) => `/${s}/knowledge/live-data`, label: "Live Data Sources", icon: Database, phase: 8, permission: "live-data:view" },
  { href: (s) => `/${s}/knowledge/gaps`, label: "Knowledge Gaps", icon: HelpCircle, phase: 8, countKey: "gaps", permission: "knowledge-gaps:view" },
  { href: (s) => `/${s}/channels`, label: "Channels", icon: Plug, phase: 5, permission: "channels:view" },
  { href: (s) => `/${s}/settings`, label: "Settings", icon: Settings, permission: "settings:view" },
];

export type SidebarNavCounts = Partial<Record<CountKey, number>>;

export function SidebarNav({
  tenantSlug,
  collapsed = false,
  counts,
  permissions,
}: {
  tenantSlug: string;
  collapsed?: boolean;
  counts?: SidebarNavCounts;
  /**
   * The current member's effective permission list. Items whose
   * `permission` slug isn't in this list get filtered out — VIEWER and
   * AGENT roles see a trimmed nav matching their access.
   */
  permissions: readonly string[];
}) {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);
  const filtered = ITEMS.filter((item) => permissionSet.has(item.permission));
  const resolved = filtered.map((item) => ({ item, href: item.href(tenantSlug) }));

  return (
    <nav
      className={cn(
        "space-y-0.5",
        collapsed && "flex flex-col items-center gap-0.5 space-y-0",
      )}
    >
      {resolved.map(({ item, href }) => {
        const matchesPrefix = pathname === href || pathname.startsWith(`${href}/`);
        const moreSpecificWins = resolved.some(({ href: other }) => {
          if (other === href) return false;
          if (!other.startsWith(`${href}/`)) return false;
          return pathname === other || pathname.startsWith(`${other}/`);
        });
        const active = matchesPrefix && !moreSpecificWins;
        const Icon = item.icon;
        const count = item.countKey ? (counts?.[item.countKey] ?? 0) : null;

        const linkInner = collapsed ? (
          // Icon-only: square hit-target, accent tint when active.
          <Link
            key={item.label}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "flex size-10 items-center justify-center rounded-md transition-colors duration-150 ease-out",
              active
                ? "bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </Link>
        ) : active ? (
          // Active expanded: tinted bg, accent-bordered icon tile, count badge.
          <Link
            key={item.label}
            href={href}
            aria-current="page"
            className={cn(
              "group flex h-11 items-center gap-3 rounded-md px-2.5 text-body-sm font-medium",
              "border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
              "bg-[color-mix(in_oklab,var(--accent-base)_12%,transparent)]",
              "text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                "border border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)]",
                "bg-[var(--bg-surface)] text-[var(--accent-hover)]",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {count !== null ? (
              <Badge variant="accent" size="sm">
                {count}
              </Badge>
            ) : null}
          </Link>
        ) : (
          // Inactive expanded: single-line.
          <Link
            key={item.label}
            href={href}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-md px-2.5 text-body-sm font-medium",
              "text-[var(--text-secondary)]",
              "transition-colors duration-150 ease-out",
              "hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon
              className="size-4 shrink-0 text-[var(--text-tertiary)] transition-colors duration-150 group-hover:text-[var(--text-secondary)]"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {count !== null ? (
              <Badge variant="default" size="sm">
                {count}
              </Badge>
            ) : null}
          </Link>
        );

        if (collapsed) {
          return (
            <TooltipHint key={item.label} label={item.label}>
              {linkInner}
            </TooltipHint>
          );
        }
        return linkInner;
      })}
    </nav>
  );
}
