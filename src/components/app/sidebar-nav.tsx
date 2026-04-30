"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: (slug: string) => string;
  label: string;
  icon: LucideIcon;
  /** Phase the item becomes interactive — used as a tooltip hint for now. */
  phase?: number;
};

// Order: most-used → least-used. Phase 8 added "Business Info" (Operational
// Facts) as a top-level entry per Gate-1 K8 override (flat sidebar — these
// are daily operator actions and deserve top-level visibility, not nesting
// under "Knowledge"). Placed alongside Knowledge so the two
// knowledge-shaped surfaces sit together.
const ITEMS: NavItem[] = [
  { href: (s) => `/${s}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
  { href: (s) => `/${s}/conversations`, label: "Conversations", icon: MessageSquare, phase: 5 },
  { href: (s) => `/${s}/knowledge`, label: "Knowledge", icon: BookOpen, phase: 3 },
  { href: (s) => `/${s}/knowledge/business-info`, label: "Business Info", icon: Building2, phase: 8 },
  { href: (s) => `/${s}/channels`, label: "Channels", icon: Plug, phase: 5 },
  { href: (s) => `/${s}/playground`, label: "Playground", icon: Sparkles, phase: 4 },
  { href: (s) => `/${s}/settings`, label: "Settings", icon: Settings },
  { href: (s) => `/${s}/billing`, label: "Billing", icon: CreditCard, phase: 9 },
];

export function SidebarNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  // Pre-compute resolved hrefs so the active-state pass can compare across
  // items. Without this, an item whose href is a prefix of another's (e.g.
  // /knowledge vs /knowledge/business-info) would both match on
  // /knowledge/business-info.
  const resolved = ITEMS.map((item) => ({ item, href: item.href(tenantSlug) }));

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-2">
      {resolved.map(({ item, href }) => {
        const matchesPrefix = pathname === href || pathname.startsWith(`${href}/`);
        // Another item is "more specific" if its href is a strict child of
        // this one's AND that item also matches the current pathname.
        // When that's true, suppress the parent's active state so only the
        // longest-matching item highlights.
        const moreSpecificWins = resolved.some(({ href: other }) => {
          if (other === href) return false;
          if (!other.startsWith(`${href}/`)) return false;
          return pathname === other || pathname.startsWith(`${other}/`);
        });
        const active = matchesPrefix && !moreSpecificWins;
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-md px-2.5 text-body-sm font-medium transition-colors duration-150 ease-out",
              active
                ? "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 transition-colors duration-150",
                active ? "text-[var(--accent-hover)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]",
              )}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
