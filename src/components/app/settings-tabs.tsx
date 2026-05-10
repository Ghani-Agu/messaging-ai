"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { label: string; href: (slug: string) => string };

const TABS: Tab[] = [
  { label: "General", href: (s) => `/${s}/settings/general` },
  { label: "AI Behavior", href: (s) => `/${s}/settings/ai` },
  { label: "Members", href: (s) => `/${s}/settings/members` },
];

export function SettingsTabs({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="border-b border-[var(--border-subtle)]"
    >
      <ul className="-mb-px flex gap-6">
        {TABS.map((tab) => {
          const href = tab.href(tenantSlug);
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block py-3 text-body-sm font-medium transition-colors duration-150 ease-out",
                  active
                    ? "border-b-2 border-[var(--accent-base)] text-[var(--text-primary)]"
                    : "border-b-2 border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
