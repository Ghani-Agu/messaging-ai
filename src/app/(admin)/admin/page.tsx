import type { Metadata } from "next";
import { Activity, BarChart3, Users } from "lucide-react";

export const metadata: Metadata = { title: "Admin" };

const SECTIONS = [
  {
    icon: Users,
    title: "Tenants",
    description:
      "Browse every workspace, see plan / usage, suspend or restore.",
    phase: "Phase 10",
  },
  {
    icon: BarChart3,
    title: "Platform metrics",
    description:
      "Total messages processed, AI tokens, channel volume, growth.",
    phase: "Phase 10",
  },
  {
    icon: Activity,
    title: "System health",
    description:
      "Queue depth, worker status, channel webhook freshness, error rates.",
    phase: "Phase 10",
  },
];

export default function AdminDashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
      <header className="mb-10">
        <h1 className="text-h1 text-[var(--text-primary)]">Admin</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          The platform-wide control panel. Builds out alongside Phase 10
          (observability + ops).
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <li
              key={s.title}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-md"
                  style={{
                    backgroundColor:
                      "color-mix(in oklab, var(--accent-base) 15%, transparent)",
                    color: "var(--accent-hover)",
                  }}
                >
                  <Icon className="size-4" />
                </span>
                <h2 className="text-body font-medium text-[var(--text-primary)]">
                  {s.title}
                </h2>
              </div>
              <p className="text-body-sm text-[var(--text-secondary)]">
                {s.description}
              </p>
              <p className="mt-4 inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2 py-0.5 text-caption text-[var(--text-tertiary)]">
                {s.phase}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
