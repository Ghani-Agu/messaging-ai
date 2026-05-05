import { ArrowRight, Bot, MessageSquare, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GlowCard } from "@/components/motion/glow-card";
import { FadeIn, FadeInItem } from "@/components/motion/fade-in";

export default function DemoPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Subtle mesh-gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "var(--gradient-mesh)" }}
      />

      <div className="mx-auto max-w-6xl px-6 py-24 lg:px-8 lg:py-32">
        {/* Hero */}
        <FadeIn stagger>
          <FadeInItem>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-caption text-[var(--text-secondary)]">
              <Sparkles className="size-3 text-[var(--accent-hover)]" aria-hidden />
              Phase 1 — Design system online
            </div>
          </FadeInItem>

          <FadeInItem>
            <h1 className="text-display max-w-3xl text-[var(--text-primary)]">
              The messaging brain for{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                modern businesses
              </span>
              .
            </h1>
          </FadeInItem>

          <FadeInItem>
            <p className="text-body-lg mt-6 max-w-2xl text-[var(--text-secondary)]">
              Multi-channel AI that handles WhatsApp, Instagram, web chat, and email — in
              Arabic, French, English, and Algerian Darija. Sounds like your best agent,
              never like a bot.
            </p>
          </FadeInItem>

          <FadeInItem>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button size="lg">
                Get started <ArrowRight />
              </Button>
              <Button variant="secondary" size="lg">
                See it live
              </Button>
              <Button variant="link" size="lg">
                Read the docs
              </Button>
            </div>
          </FadeInItem>
        </FadeIn>

        {/* Section: Typography scale */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Typography"
            title="The full Geist scale"
            description="Display through caption. Body defaults to 15px for Linear's denser feel."
          />
          <Card className="mt-8">
            <CardContent className="space-y-6 pt-6">
              <TypeRow label="display" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h1" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h2" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h3" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h4" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="body-lg" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="body" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="body-sm" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="caption" sample="LABEL · 12PX · UPPERCASE · TRACKED" upper />
            </CardContent>
          </Card>
        </section>

        {/* Section: Color tokens */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Color"
            title="Direction A — platform orange on charcoal"
            description="Tokens drive everything. Hard-coded hex codes are a code smell."
          />

          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Swatch name="bg-base" varName="--bg-base" />
            <Swatch name="bg-surface" varName="--bg-surface" />
            <Swatch name="bg-elevated" varName="--bg-surface-elevated" />
            <Swatch name="bg-overlay" varName="--bg-surface-overlay" />
            <Swatch name="accent" varName="--accent-base" />
            <Swatch name="accent-hover" varName="--accent-hover" />
            <Swatch name="accent-secondary" varName="--accent-secondary" />
            <Swatch name="success" varName="--success" />
            <Swatch name="warning" varName="--warning" />
            <Swatch name="danger" varName="--danger" />
            <Swatch name="border-default" varName="--border-default" />
            <Swatch name="border-strong" varName="--border-strong" />
          </div>
        </section>

        {/* Section: Buttons */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Components"
            title="Button variants"
            description="Six variants, five sizes, focus ring, glow on primary hover, 0.98 active scale."
          />
          <Card className="mt-8">
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
            </CardContent>
            <CardContent className="flex flex-wrap items-end gap-3 pt-0">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="xl">Extra large</Button>
              <Button size="icon" aria-label="More">
                <Sparkles />
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Section: Glow cards */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Motion"
            title="Glow on hover"
            description="Pointer-tracked halo, 2px lift, 150ms ease-out. Move your cursor."
          />

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <GlowCard>
              <Bot className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Tenant brain</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                Per-company AI trained on your site, files, and brand voice. Never a generic
                chatbot.
              </p>
            </GlowCard>

            <GlowCard>
              <MessageSquare className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Every channel</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                WhatsApp, Instagram, web widget, email — one inbox, one source of truth, one
                voice.
              </p>
            </GlowCard>

            <GlowCard>
              <Zap className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Smart handoff</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                Confidence-aware escalation. The AI knows when to call you in. No bluffing.
              </p>
            </GlowCard>
          </div>
        </section>

        {/* Section: Status */}
        <section className="mt-32 mb-12">
          <Card>
            <CardHeader>
              <CardTitle>Phase 1 — Foundation</CardTitle>
              <CardDescription>
                Next 15 + Tailwind v4 + Prisma + design tokens + motion primitives.
                Up next: Phase 2 — auth, multi-tenancy, dashboard shell.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-body-sm space-y-2 text-[var(--text-secondary)]">
                <CheckLine>Design tokens wired (colors, type, radius, shadows, motion)</CheckLine>
                <CheckLine>Geist Sans + Mono loaded</CheckLine>
                <CheckLine>shadcn-style primitives restyled to the system</CheckLine>
                <CheckLine>Framer Motion presets centralized in lib/motion.ts</CheckLine>
                <CheckLine>Prisma schema for Tenant / User / TenantUser + NextAuth tables</CheckLine>
                <CheckLine>docker-compose for Postgres+pgvector and Redis (boot pending Docker install)</CheckLine>
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-caption font-medium uppercase tracking-wider text-[var(--accent-hover)]">
        {eyebrow}
      </p>
      <h2 className="text-h2 mt-2 text-[var(--text-primary)]">{title}</h2>
      <p className="text-body mt-2 text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

// Literal map so Tailwind v4's content scanner can see every class.
const TYPE_CLASSES: Record<string, string> = {
  display: "text-display",
  h1: "text-h1",
  h2: "text-h2",
  h3: "text-h3",
  h4: "text-h4",
  "body-lg": "text-body-lg",
  body: "text-body",
  "body-sm": "text-body-sm",
  caption: "text-caption",
};

function TypeRow({
  label,
  sample,
  upper,
}: {
  label: string;
  sample: string;
  upper?: boolean;
}) {
  const sizeClass = TYPE_CLASSES[label] ?? "text-body";
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-6 last:border-0 last:pb-0 md:flex-row md:items-baseline md:gap-6">
      <span className="text-caption w-32 shrink-0 font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className={`${sizeClass} text-[var(--text-primary)] ${upper ? "uppercase tracking-wider" : ""}`}
      >
        {sample}
      </span>
    </div>
  );
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <div className="h-20" style={{ backgroundColor: `var(${varName})` }} />
      <div className="bg-[var(--bg-surface)] px-3 py-2">
        <p className="text-body-sm text-[var(--text-primary)]">{name}</p>
        <p className="text-caption font-mono text-[var(--text-tertiary)]">{varName}</p>
      </div>
    </div>
  );
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent-base)]"
      />
      <span>{children}</span>
    </li>
  );
}
