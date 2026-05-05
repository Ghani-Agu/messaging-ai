"use client";

import { Boxes } from "lucide-react";
import { FadeIn, FadeInItem } from "@/components/motion/fade-in";

/**
 * Auth-page hero column. Renders only at lg+ — the auth layout switches
 * to single-column below lg and the hero is hidden. Three stacked
 * elements: chip eyebrow, gradient-spanned headline, supporting body.
 *
 * Pre-tenant surface: stays on the platform brand. The per-tenant accent
 * override layer is operator-scoped and out of scope here.
 */
export function AuthHero() {
  return (
    <FadeIn
      stagger
      className="hidden lg:flex lg:flex-col lg:justify-center"
    >
      <FadeInItem>
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-caption font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          <Boxes
            className="size-3.5 text-[var(--accent-hover)]"
            aria-hidden
          />
          WBP · AI customer messaging
        </span>
      </FadeInItem>

      <FadeInItem>
        <h2 className="mt-8 max-w-xl text-display text-[var(--text-primary)]">
          AI that handles every customer inquiry,{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "var(--gradient-primary)" }}
          >
            in your voice
          </span>
          .
        </h2>
      </FadeInItem>

      <FadeInItem>
        <p className="mt-6 max-w-md text-body-lg text-[var(--text-secondary)]">
          Multi-channel AI trained on your catalog, your policies, your
          tone. Customers reach you on WhatsApp, Instagram, Messenger, or
          your website — and get the right answer, in their language,
          every time.
        </p>
      </FadeInItem>
    </FadeIn>
  );
}
