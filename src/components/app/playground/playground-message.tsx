"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Bot, User } from "lucide-react";
import {
  PlaygroundCitations,
  type PlaygroundCitation,
} from "./playground-citations";
import { PlaygroundConfidenceMeter } from "./playground-confidence-meter";
import { Badge } from "@/components/ui/badge";
import { durationFast, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Discriminated union for thread state. Customer messages are simple
 * strings; AI messages carry full BrainResult metadata so the bubble
 * can render citations + confidence + escalation alongside the text.
 * `streaming: true` puts the AI bubble in cursor-mode while deltas
 * accumulate; the cursor animates out (200ms fade) when the parent
 * flips it to false.
 */
export type PlaygroundThreadMessage =
  | { id: string; role: "customer"; text: string }
  | {
      id: string;
      role: "ai";
      text: string;
      streaming: boolean;
      language?: "ar" | "fr" | "en" | "darija";
      citations?: PlaygroundCitation[];
      confidence?: number;
      escalation?: string | null;
      modelId?: string;
    };

const LANG_LABEL = {
  ar: "AR",
  fr: "FR",
  en: "EN",
  darija: "Darija",
} as const;

export function PlaygroundMessage({
  message,
}: {
  message: PlaygroundThreadMessage;
}) {
  if (message.role === "customer") {
    return <CustomerBubble text={message.text} />;
  }
  return <AiBubble message={message} />;
}

function CustomerBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] items-start gap-2.5">
        <div
          className={cn(
            "rounded-md px-3 py-2 text-body-sm",
            "border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
            "bg-[color-mix(in_oklab,var(--accent-base)_12%,transparent)]",
            "text-[var(--text-primary)]",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            "border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
            "bg-[var(--bg-surface)] text-[var(--accent-hover)]",
          )}
        >
          <User className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

function AiBubble({
  message,
}: {
  message: Extract<PlaygroundThreadMessage, { role: "ai" }>;
}) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[88%] items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            "border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-[var(--text-secondary)]",
          )}
        >
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-body-sm text-[var(--text-primary)]",
            )}
          >
            <p className="whitespace-pre-wrap break-words">
              {message.text}
              {message.streaming || message.text.length > 0 ? (
                <BreathingCursor visible={message.streaming} />
              ) : null}
            </p>
          </div>

          {!message.streaming ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {message.language ? (
                <Badge variant="default" size="sm">
                  {LANG_LABEL[message.language]}
                </Badge>
              ) : null}
              {message.escalation ? (
                <Badge variant="warning" size="sm" className="gap-1">
                  <AlertTriangle className="size-3" aria-hidden />
                  {message.escalation.replaceAll("_", " ").toLowerCase()}
                </Badge>
              ) : null}
              {typeof message.confidence === "number" ? (
                <div className="ml-auto w-40 max-w-full">
                  <PlaygroundConfidenceMeter
                    confidence={message.confidence}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {!message.streaming && message.citations && message.citations.length > 0 ? (
            <PlaygroundCitations citations={message.citations} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Breathing cursor. Pulses ▎ at the end of a streaming AI bubble.
 * When the parent flips `visible` to false, the cursor fades out over
 * 200ms (per spec) and then unmounts via AnimatePresence-equivalent
 * mount-toggle.
 *
 * Reduced-motion: the pulse is disabled (static block); the fade-out
 * still happens but as an instant transition. The block stays visually
 * subtle either way.
 */
function BreathingCursor({ visible }: { visible: boolean }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      initial={false}
      animate={{
        opacity: visible ? (prefersReducedMotion ? 1 : [1, 0.35, 1]) : 0,
      }}
      transition={
        visible && !prefersReducedMotion
          ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
          : { duration: prefersReducedMotion ? 0 : durationFast, ease: easeOutExpo }
      }
      className="ml-0.5 inline-block align-baseline text-[var(--accent-hover)]"
    >
      ▎
    </motion.span>
  );
}
