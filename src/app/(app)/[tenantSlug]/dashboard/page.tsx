import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Plug,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";

export const metadata: Metadata = {
  title: "Dashboard",
};

type NextStep = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: (slug: string) => string;
  ctaLabel: string;
  available: boolean;
};

const NEXT_STEPS: NextStep[] = [
  {
    icon: BookOpen,
    title: "Add knowledge",
    description: "Paste your website URL or upload a PDF — your AI learns from it.",
    href: (s) => `/${s}/knowledge`,
    ctaLabel: "Add knowledge",
    available: false,
  },
  {
    icon: Plug,
    title: "Connect a channel",
    description: "Plug in WhatsApp, Instagram, or drop a widget on your site.",
    href: (s) => `/${s}/channels`,
    ctaLabel: "Connect a channel",
    available: false,
  },
  {
    icon: Sparkles,
    title: "Test in the playground",
    description: "Chat with your AI in any of four languages before customers do.",
    href: (s) => `/${s}/playground`,
    ctaLabel: "Open playground",
    available: false,
  },
  {
    icon: UserPlus,
    title: "Invite a teammate",
    description: "Add an agent so humans can take over when the AI escalates.",
    href: (s) => `/${s}/settings`,
    ctaLabel: "Invite",
    available: false,
  },
];

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const greeting = ctx.user.name ?? ctx.user.email?.split("@")[0] ?? "there";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-10">
        <p className="mb-1 text-body-sm text-[var(--text-tertiary)]">
          {ctx.tenant.name}
        </p>
        <h1 className="text-h1 text-[var(--text-primary)]">
          Welcome, {greeting}.
        </h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          You&apos;re a few steps away from your AI replying to customers.
        </p>
      </header>

      <section aria-labelledby="next-steps-heading" className="mb-12">
        <h2
          id="next-steps-heading"
          className="mb-4 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          Next steps
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {NEXT_STEPS.map((step) => {
            const Icon = step.icon;
            const href = step.href(tenantSlug);
            return (
              <li key={step.title}>
                <Link
                  href={href}
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

      <section aria-labelledby="overview-heading">
        <h2
          id="overview-heading"
          className="mb-4 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          This week
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Conversations", value: "—" },
            { label: "AI replies sent", value: "—" },
            { label: "Avg. response time", value: "—" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            >
              <p className="text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
                {stat.label}
              </p>
              <p className="mt-2 text-h2 text-[var(--text-primary)]">
                {stat.value}
              </p>
              <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
                Once channels are connected
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
