"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
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

const ITEMS: NavItem[] = [
  { href: (s) => `/${s}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
  { href: (s) => `/${s}/conversations`, label: "Conversations", icon: MessageSquare, phase: 5 },
  { href: (s) => `/${s}/knowledge`, label: "Knowledge", icon: BookOpen, phase: 3 },
  { href: (s) => `/${s}/channels`, label: "Channels", icon: Plug, phase: 5 },
  { href: (s) => `/${s}/playground`, label: "Playground", icon: Sparkles, phase: 4 },
  { href: (s) => `/${s}/settings`, label: "Settings", icon: Settings },
  { href: (s) => `/${s}/billing`, label: "Billing", icon: CreditCard, phase: 9 },
];

export function SidebarNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-0.5 px-3 py-2">
      {ITEMS.map((item) => {
        const href = item.href(tenantSlug);
        const active = pathname === href || pathname.startsWith(`${href}/`);
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
