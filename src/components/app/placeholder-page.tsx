import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Empty state used for every Phase-2 placeholder route. Real but inert —
 * the URL works, the breadcrumb works, the layout works; the body just
 * tells the user when this surface comes online.
 */
export function PlaceholderPage({
  icon: Icon,
  title,
  description,
  phaseNote,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phaseNote: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-10">
        <h1 className="text-h1 text-[var(--text-primary)]">{title}</h1>
      </header>

      <div className="flex flex-1 items-center justify-center">
        <div
          className="w-full max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center"
          aria-live="polite"
        >
          <div
            aria-hidden
            className="mx-auto mb-5 flex size-12 items-center justify-center rounded-full"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--accent-base) 15%, transparent)",
              color: "var(--accent-hover)",
            }}
          >
            <Icon className="size-6" />
          </div>
          <h2 className="mb-1.5 text-h4 text-[var(--text-primary)]">
            {title} arrives soon
          </h2>
          <p className="text-body-sm text-[var(--text-secondary)]">
            {description}
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2.5 py-1 text-caption text-[var(--text-tertiary)]">
            {phaseNote}
          </p>
          {children ? <div className="mt-6">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}
