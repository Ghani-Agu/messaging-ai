"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  ImageIcon,
  Mic,
  Paperclip,
  User,
  UserCog,
} from "lucide-react";
import type { Message } from "@prisma/client";
import { cn } from "@/lib/utils";
import { resolveDirection } from "@/lib/rtl";
import type {
  MessageAiMetadata,
  MessageDeliveryStatus,
} from "@/server/db/conversations";

/**
 * Dashboard MessageBubble. Three visual variants:
 *
 *   INBOUND + CUSTOMER       → left, surface bg, customer icon
 *   OUTBOUND + AI            → right, accent-tinted bg, bot icon, citations
 *   OUTBOUND + HUMAN_AGENT   → right, neutral elevated bg, agent icon
 *
 * RTL handled per-bubble via `dir` — the AI's stored language wins for
 * its own bubbles; customer bubbles fall back to first-strong-character
 * detection. Citations live below the AI bubble; clicking a chip
 * expands the preview inline (matches the widget's interaction).
 */
export function DashboardMessageBubble({ message }: { message: Message }) {
  const isInbound = message.direction === "INBOUND";
  const isAi = message.sender === "AI";
  const meta = parseAiMetadata(message);

  const dir = resolveDirection({
    lang: meta?.language ?? null,
    text: message.content,
  });

  const align = isInbound ? "items-start" : "items-end";
  const bubbleVariant = isInbound
    ? "bg-[var(--bg-surface-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
    : isAi
      ? "bg-[color-mix(in_oklab,var(--accent-base)_18%,var(--bg-surface))] border-[color-mix(in_oklab,var(--accent-base)_30%,transparent)] text-[var(--text-primary)]"
      : "bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-primary)]";

  return (
    <div className={cn("flex flex-col gap-1", align)}>
      <div className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
        <SenderIcon sender={message.sender} />
        <span>{senderLabel(message.sender)}</span>
        <span aria-hidden>·</span>
        <time dateTime={message.createdAt.toISOString()}>
          {formatTimestamp(message.createdAt)}
        </time>
        {meta?.language ? (
          <>
            <span aria-hidden>·</span>
            <span className="font-medium uppercase tracking-wider">
              {meta.language}
            </span>
          </>
        ) : null}
      </div>
      <div
        dir={dir}
        className={cn(
          "max-w-[80%] rounded-2xl border px-4 py-2.5 text-body",
          "whitespace-pre-wrap break-words",
          bubbleVariant,
        )}
      >
        <MessageBody message={message} />
      </div>
      {meta?.deliveryStatus && !isInbound ? (
        <DeliveryStatusIndicator
          status={meta.deliveryStatus}
          error={meta.outboundSendError}
        />
      ) : null}
      {meta?.citations && meta.citations.length > 0 ? (
        <CitationStrip
          citations={meta.citations}
          used={meta.citationsUsed ?? []}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Body — TEXT vs IMAGE vs VOICE vs FILE
// ─────────────────────────────────────────────────────────────────────────────

function MessageBody({ message }: { message: Message }) {
  const t = message.contentType;
  if (t === "TEXT") {
    return <span>{message.content}</span>;
  }
  // For IMAGE: if mediaUrl looks like an http(s) URL we render the
  // image inline; otherwise it's a 360dialog media-id (resolves via
  // an authenticated /media/<id> call we don't ship in Phase 6 v1) —
  // show a placeholder. The caption/content shows underneath.
  if (t === "IMAGE") {
    const httpUrl = isHttpUrl(message.mediaUrl);
    return (
      <div className="space-y-2">
        {httpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={httpUrl}
            alt={message.content}
            className="max-h-64 max-w-full rounded-md border border-[var(--border-subtle)]"
          />
        ) : (
          <MediaPlaceholder
            icon={<ImageIcon aria-hidden className="size-3.5" />}
            label="Image"
            mediaId={message.mediaUrl}
          />
        )}
        {message.content && message.content !== "[image]" ? (
          <span>{message.content}</span>
        ) : null}
      </div>
    );
  }
  if (t === "VOICE") {
    return (
      <MediaPlaceholder
        icon={<Mic aria-hidden className="size-3.5" />}
        label="Voice message"
        mediaId={message.mediaUrl}
      />
    );
  }
  if (t === "FILE") {
    return (
      <MediaPlaceholder
        icon={<FileText aria-hidden className="size-3.5" />}
        label={
          message.content.startsWith("[document:")
            ? message.content.slice(11, -1).trim()
            : "File"
        }
        mediaId={message.mediaUrl}
      />
    );
  }
  return <span>{message.content}</span>;
}

function MediaPlaceholder({
  icon,
  label,
  mediaId,
}: {
  icon: React.ReactNode;
  label: string;
  mediaId: string | null;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]/40 px-2.5 py-1.5 text-body-sm">
      <Paperclip aria-hidden className="size-3.5 text-[var(--text-tertiary)]" />
      {icon}
      <span className="text-[var(--text-primary)]">{label}</span>
      {mediaId ? (
        <span className="font-mono text-caption text-[var(--text-tertiary)]">
          ({truncateMid(mediaId, 18)})
        </span>
      ) : null}
    </div>
  );
}

function isHttpUrl(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return null;
}

function truncateMid(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const head = Math.ceil(maxLen / 2) - 1;
  const tail = Math.floor(maxLen / 2) - 1;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery status indicator (non-widget outbound only)
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_STATUS_VARIANTS: Record<
  MessageDeliveryStatus,
  { label: string; className: string; Icon: typeof Check }
> = {
  sent: {
    label: "Sent",
    className: "text-[var(--text-tertiary)]",
    Icon: Check,
  },
  delivered: {
    label: "Delivered",
    className: "text-[var(--text-secondary)]",
    Icon: CheckCheck,
  },
  read: {
    label: "Read",
    className: "text-[var(--accent-hover)]",
    Icon: CheckCheck,
  },
  failed: {
    label: "Failed",
    className: "text-[var(--danger)]",
    Icon: AlertTriangle,
  },
  skipped_outside_window: {
    label: "Not delivered — 24h window closed",
    className: "text-[var(--warning)]",
    Icon: Clock,
  },
  skipped_unsupported_channel: {
    label: "Not delivered — channel not supported",
    className: "text-[var(--text-tertiary)]",
    Icon: AlertTriangle,
  },
};

function DeliveryStatusIndicator({
  status,
  error,
}: {
  status: MessageDeliveryStatus;
  error: string | undefined;
}) {
  const v = DELIVERY_STATUS_VARIANTS[status];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 self-end text-caption",
        v.className,
      )}
    >
      <v.Icon aria-hidden className="size-3" />
      <span>{v.label}</span>
      {error && status === "failed" ? (
        <span className="ml-1 max-w-[40ch] truncate text-[var(--text-tertiary)]">
          ({error})
        </span>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Citations
// ─────────────────────────────────────────────────────────────────────────────

type Citation = MessageAiMetadata["citations"][number];

function CitationStrip({
  citations,
  used,
}: {
  citations: Citation[];
  used: number[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open =
    openIndex !== null ? citations.find((c) => c.index === openIndex) : null;
  const usedSet = new Set(used);

  return (
    <div className="max-w-[80%] space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {citations.map((c) => {
          const isUsed = usedSet.has(c.index);
          const isOpen = openIndex === c.index;
          return (
            <button
              key={c.index}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenIndex(isOpen ? null : c.index)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption",
                "transition-colors duration-150 ease-out",
                isUsed
                  ? "border-[color-mix(in_oklab,var(--accent-base)_35%,transparent)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)]",
                "hover:border-[var(--border-strong)]",
                isOpen && "border-[var(--accent-base)]",
              )}
            >
              <span className="font-mono">[{c.index}]</span>
              <span className="max-w-[18ch] truncate">{citationLabel(c)}</span>
            </button>
          );
        })}
      </div>
      {open ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-body-sm text-[var(--text-secondary)]">
          {open.kind === "chunk" && open.sourceUrl ? (
            <a
              href={open.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-mono text-caption text-[var(--accent-hover)] hover:underline"
            >
              {open.sourceUrl}
            </a>
          ) : null}
          <p className="mt-1.5 whitespace-pre-wrap text-[var(--text-primary)]">
            {open.preview}
          </p>
          <div className="mt-2 flex gap-3 text-caption text-[var(--text-tertiary)]">
            {(open.kind === "chunk" || open.kind === "item") &&
            typeof open.vectorScore === "number" ? (
              <span>vector {open.vectorScore.toFixed(2)}</span>
            ) : null}
            {(open.kind === "chunk" || open.kind === "item") &&
            typeof open.lexicalScore === "number" ? (
              <span>lexical {open.lexicalScore.toFixed(2)}</span>
            ) : null}
            {open.kind === "qna" ? (
              <span>match {open.score.toFixed(2)}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-kind display label for the citation chip. P8c-5 layers proper kind
 * badges on top; P8c-2 just gets the text right so the discriminated union
 * compiles + renders without crashes.
 */
function citationLabel(c: Citation): string {
  switch (c.kind) {
    case "chunk":
      return c.sourceName;
    case "item":
      return c.brand ? `${c.name} (${c.brand})` : c.name;
    case "qna":
      return `Q&A: ${c.question.slice(0, 40)}${c.question.length > 40 ? "…" : ""}`;
    case "operational_fact":
      return `Fact: ${c.field}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function SenderIcon({ sender }: { sender: Message["sender"] }) {
  const cls = "size-3";
  if (sender === "CUSTOMER") return <User aria-hidden className={cls} />;
  if (sender === "AI") return <Bot aria-hidden className={cls} />;
  return <UserCog aria-hidden className={cls} />;
}

function senderLabel(sender: Message["sender"]): string {
  if (sender === "CUSTOMER") return "Customer";
  if (sender === "AI") return "AI";
  return "Agent";
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseAiMetadata(message: Message): MessageAiMetadata | null {
  if (message.sender !== "AI" || !message.aiMetadata) return null;
  // Typed-JSON cast: Phase-4 brain orchestrator is the only writer; the
  // stored shape always matches MessageAiMetadata. A bad row would just
  // skip citations rendering — not crash.
  return message.aiMetadata as unknown as MessageAiMetadata;
}
