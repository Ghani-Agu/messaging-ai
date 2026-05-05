import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Plug,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";

type NextStep = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: (slug: string) => string;
  ctaLabel: string;
};

// Order matters: fastest-time-to-first-reply path.
const STEPS: NextStep[] = [
  {
    icon: BookOpen,
    title: "Add knowledge",
    description:
      "Paste your website URL or upload a PDF — your AI learns from it.",
    href: (s) => `/${s}/knowledge`,
    ctaLabel: "Add knowledge",
  },
  {
    icon: Plug,
    title: "Connect a channel",
    description:
      "Plug in WhatsApp, Instagram, or drop a widget on your site.",
    href: (s) => `/${s}/channels`,
    ctaLabel: "Connect a channel",
  },
  {
    icon: Sparkles,
    title: "Test in the playground",
    description:
      "Chat with your AI in any of four languages before customers do.",
    href: (s) => `/${s}/playground`,
    ctaLabel: "Open playground",
  },
  {
    icon: UserPlus,
    title: "Invite a teammate",
    description:
      "Add an agent so humans can take over when the AI escalates.",
    href: (s) => `/${s}/settings`,
    ctaLabel: "Invite",
  },
];

interface OnboardingStripProps {
  tenantSlug: string;
  /** Compact mode: smaller spacing. Used at the bottom of an active
   *  dashboard where some setup steps still remain. */
  compact?: boolean;
}

/**
 * "Next steps" strip — four card links covering the fastest path from
 * fresh tenant to first AI reply. Drives the empty-state dashboard;
 * also rendered (compact) at the bottom of the active dashboard while
 * any of the setup steps still apply.
 */
export function OnboardingStrip({
  tenantSlug,
  compact = false,
}: OnboardingStripProps) {
  return (
    <section
      aria-labelledby="next-steps-heading"
      className={compact ? "mt-12" : undefined}
    >
      <div className="mb-4">
        <Eyebrow>Next steps</Eyebrow>
        <h2 id="next-steps-heading" className="sr-only">
          Next steps
        </h2>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <Link
                href={step.href(tenantSlug)}
                className="group flex h-full flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--border-default)]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor:
                        "color-mix(in oklab, var(--accent-base) 15%, transparent)",
                      color: "var(--accent-hover)",
                    }}
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <h3 className="text-body font-medium text-[var(--text-primary)]">
                    {step.title}
                  </h3>
                </div>
                <p className="mb-4 flex-1 text-body-sm text-[var(--text-secondary)]">
                  {step.description}
                </p>
                <span className="inline-flex items-center gap-1 text-body-sm font-medium text-[var(--accent-hover)] transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                  {step.ctaLabel}
                  <ArrowRight className="size-3.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
