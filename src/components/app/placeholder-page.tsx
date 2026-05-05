import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

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
    <PageShell width="3xl">
      <PageHeader title={title} eyebrow={<Eyebrow>Coming soon</Eyebrow>} />

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
    </PageShell>
  );
}
