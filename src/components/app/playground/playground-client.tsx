"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  PlaygroundMessage,
  type PlaygroundThreadMessage,
} from "./playground-message";
import type { PlaygroundCitation } from "./playground-citations";
import { EXAMPLE_PROMPTS } from "./playground-example-prompts";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/validators";
import { durationFast, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

const LANGUAGE_BUTTONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: "ar", label: "AR" },
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
  { value: "darija", label: "Darija" },
];

type PlaygroundClientProps = {
  tenantSlug: string;
  tenantName: string;
  defaultLanguage: SupportedLanguage;
  voiceTone: string;
};

export function PlaygroundClient({
  tenantSlug,
  tenantName,
  defaultLanguage,
  voiceTone,
}: PlaygroundClientProps) {
  const [messages, setMessages] = useState<PlaygroundThreadMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [language, setLanguage] = useState<SupportedLanguage>(defaultLanguage);
  const [conversationId, setConversationId] = useState<string>(() => mintId());
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  // Auto-grow textarea up to max height. Resets to single-line on clear.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [inputValue]);

  // Sticky-to-bottom on new messages OR streaming text growth. The bottom
  // anchor is below the messages container; scrollIntoView pins it.
  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({
      behavior: messages.length === 0 ? "auto" : "smooth",
      block: "end",
    });
  }, [messages]);

  // Cancel any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setStreamError(null);

      const customerId = mintId();
      const aiId = mintId();

      // History from completed turns. We snapshot before adding the new
      // pair so the API call carries the prior context, not the in-flight
      // turn (the API is asked the question; it doesn't need to be told
      // its own question back).
      const history: HistoryTurn[] = [];
      for (const m of messages) {
        if (m.role === "customer") {
          history.push({ role: "customer", text: m.text });
        } else if (!m.streaming && m.text.length > 0) {
          history.push({ role: "you", text: m.text });
        }
      }

      // Optimistic append: customer bubble + empty AI bubble in cursor mode.
      setMessages((prev) => [
        ...prev,
        { id: customerId, role: "customer", text: trimmed },
        { id: aiId, role: "ai", text: "", streaming: true },
      ]);
      setInputValue("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/playground/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantSlug,
            message: trimmed,
            language,
            conversationId,
            history,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(
            `Request failed (${response.status}): ${errBody.slice(0, 240) || "no body"}`,
          );
        }
        if (!response.body) {
          throw new Error("Response has no body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDone = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events delimited by blank line. Drain complete events from
          // the buffer; leave any partial trailing event for the next loop.
          let sepIdx;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const dataLine = rawEvent
              .split("\n")
              .find((ln) => ln.startsWith("data:"));
            if (!dataLine) continue;
            const payload = dataLine.slice(5).trim();
            if (!payload) continue;

            let event: WireEvent;
            try {
              event = JSON.parse(payload) as WireEvent;
            } catch {
              continue;
            }

            if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiId && m.role === "ai"
                    ? { ...m, text: m.text + event.text }
                    : m,
                ),
              );
            } else if (event.type === "done") {
              sawDone = true;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiId && m.role === "ai"
                    ? {
                        ...m,
                        text: event.reply,
                        streaming: false,
                        language: event.language,
                        citations: event.citations,
                        confidence: event.computedConfidence,
                        escalation: event.escalation,
                        modelId: event.modelId,
                      }
                    : m,
                ),
              );
            }
          }
        }

        if (!sawDone) {
          throw new Error("Stream ended without `done` event");
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          // Intentional cancel — drop the placeholder AI bubble entirely
          // so the thread doesn't show a half-rendered reply.
          setMessages((prev) => prev.filter((m) => m.id !== aiId));
        } else {
          const msg =
            err instanceof Error ? err.message : "Unknown stream error";
          setStreamError(msg);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId && m.role === "ai"
                ? { ...m, streaming: false }
                : m,
            ),
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [conversationId, isStreaming, language, messages, tenantSlug],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void send(inputValue);
    },
    [inputValue, send],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends (no modifier). Shift+Enter inserts a newline (default).
      // Cmd/Ctrl+Enter is the alternative submit.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(inputValue);
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send(inputValue);
      }
    },
    [inputValue, send],
  );

  const onNewSession = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInputValue("");
    setStreamError(null);
    setConversationId(mintId());
    textareaRef.current?.focus();
  }, []);

  const canSend = inputValue.trim().length > 0 && !isStreaming;

  return (
    <PageShell width="4xl">
      <PageHeader
        eyebrow={<Eyebrow>{tenantName}</Eyebrow>}
        title="Playground"
        description="Chat with your AI exactly as a customer would. Streams responses, surfaces which knowledge it used, and shows the confidence score."
        actions={
          <div className="flex items-center gap-3">
            <Badge variant="default" size="sm" className="capitalize">
              Using {voiceTone} voice
            </Badge>
            <button
              type="button"
              onClick={onNewSession}
              disabled={messages.length === 0 && !isStreaming}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-body-sm font-medium",
                "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]",
                "transition-colors duration-150 ease-out",
                "hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              New session
            </button>
          </div>
        }
      />

      <LanguageToggle
        value={language}
        onChange={setLanguage}
        disabled={isStreaming}
      />

      <div className="mt-6 space-y-4 pb-32">
        {messages.length === 0 ? (
          <EmptyState
            language={language}
            onPick={(prompt) => {
              setInputValue(prompt);
              textareaRef.current?.focus();
            }}
          />
        ) : (
          messages.map((m) => <PlaygroundMessage key={m.id} message={m} />)
        )}
        {streamError ? <StreamErrorBanner message={streamError} /> : null}
        <div ref={bottomAnchorRef} />
      </div>

      <InputRow
        ref={textareaRef}
        value={inputValue}
        onChange={setInputValue}
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
        canSend={canSend}
        isStreaming={isStreaming}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function LanguageToggle({
  value,
  onChange,
  disabled,
}: {
  value: SupportedLanguage;
  onChange: (lang: SupportedLanguage) => void;
  disabled: boolean;
}) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Test language"
      aria-describedby={groupId}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1",
      )}
    >
      {LANGUAGE_BUTTONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-7 min-w-[3.5rem] items-center justify-center rounded-sm px-2 text-caption font-medium",
              "transition-colors duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
              "disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
      <span id={groupId} className="sr-only">
        Seeds the example prompts. The brain detects language from each
        message regardless.
      </span>
    </div>
  );
}

function EmptyState({
  language,
  onPick,
}: {
  language: SupportedLanguage;
  onPick: (prompt: string) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const prompts = EXAMPLE_PROMPTS[language];
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { duration: durationFast, ease: easeOutExpo }
      }
      className="mx-auto max-w-md rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-6 py-10 text-center"
    >
      <span
        aria-hidden
        className={cn(
          "mx-auto mb-3 flex size-10 items-center justify-center rounded-md",
          "border border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)]",
          "bg-[var(--bg-surface)] text-[var(--accent-hover)]",
        )}
      >
        <Sparkles className="size-4" />
      </span>
      <h2 className="text-h3 text-[var(--text-primary)]">
        Ask your AI anything
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-body-sm text-[var(--text-secondary)]">
        Try a question your customers might send. Responses stream in
        real-time, with citations and confidence.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-body-sm",
              "border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)]",
              "transition-colors duration-150 ease-out",
              "hover:border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)]",
              "hover:bg-[color-mix(in_oklab,var(--accent-base)_8%,transparent)]",
              "hover:text-[var(--text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
            )}
          >
            <Plus className="size-3" aria-hidden />
            {p}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function StreamErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2",
        "border-[color-mix(in_oklab,var(--danger)_30%,transparent)]",
        "bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]",
      )}
    >
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-[var(--danger)]"
        aria-hidden
      />
      <p className="text-body-sm text-[var(--text-primary)]">
        <span className="font-medium">Stream interrupted.</span>{" "}
        <span className="text-[var(--text-secondary)]">{message}</span>
      </p>
    </div>
  );
}

function InputRow({
  ref,
  value,
  onChange,
  onKeyDown,
  onSubmit,
  canSend,
  isStreaming,
}: {
  ref: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  canSend: boolean;
  isStreaming: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "sticky bottom-4 z-10 mt-6",
        // Soft shadow + frosted glass so the input lifts off the page
        // as it stickies past the messages.
        "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 backdrop-blur-md",
        "shadow-[var(--shadow-md)]",
      )}
    >
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Type a customer-style question…"
          aria-label="Message"
          className={cn(
            "min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-body-sm text-[var(--text-primary)]",
            "placeholder:text-[var(--text-tertiary)]",
            "focus:outline-none",
          )}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-md",
            "transition-colors duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
            canSend
              ? "bg-[var(--accent-base)] text-white hover:bg-[var(--accent-hover)]"
              : "bg-[var(--bg-surface-elevated)] text-[var(--text-tertiary)]",
            "disabled:cursor-not-allowed",
          )}
        >
          {isStreaming ? (
            <span
              aria-hidden
              className="size-2 animate-pulse rounded-full bg-current"
            />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
        </button>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[10px] text-[var(--text-tertiary)]">
        <span>
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 font-mono">
            Enter
          </kbd>{" "}
          to send
        </span>
        <span>
          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 py-0.5 font-mono">
            Shift+Enter
          </kbd>{" "}
          newline
        </span>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire types — must mirror the API route's `done` envelope.
// ─────────────────────────────────────────────────────────────────────────────

type HistoryTurn = { role: "customer" | "you"; text: string };

type WireEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      conversationId?: string;
      reply: string;
      language: SupportedLanguage;
      citations: PlaygroundCitation[];
      computedConfidence: number;
      groundedness: number;
      escalation: string | null;
      modelId: string;
    };

function mintId(): string {
  // crypto.randomUUID() is available in modern browsers + Node 19+. The
  // playground page is dynamic-rendered (operator JWT required), so this
  // only runs in client + recent server runtimes.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: 16 bytes of pseudo-random hex. Good enough for an in-process
  // session ID; never persisted.
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

// Module-load assertion: keep LANGUAGE_BUTTONS in lockstep with the
// SUPPORTED_LANGUAGES enum so a future addition can't silently disappear
// from the toggle.
if (LANGUAGE_BUTTONS.length !== SUPPORTED_LANGUAGES.length) {
  throw new Error(
    "LANGUAGE_BUTTONS drifted from SUPPORTED_LANGUAGES — keep them in sync",
  );
}
