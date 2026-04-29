"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Facebook,
  Globe,
  Instagram,
  Lock,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { ChannelType, ConversationStatus } from "@prisma/client";
import { getConversationDetail } from "@/server/conversations/actions";
import type { ConversationWithMessages } from "@/server/db/conversations";
import { cn } from "@/lib/utils";
import { DashboardMessageBubble } from "./message-bubble";

const POLL_INTERVAL_MS = 4000;

const CHANNEL_ICON: Record<ChannelType, LucideIcon> = {
  WIDGET: Globe,
  WHATSAPP: MessageCircle,
  INSTAGRAM: Instagram,
  // Phase 7a — added so the ChannelType-keyed map is exhaustive after
  // the MESSENGER enum addition. 7f refines header rendering for
  // Messenger threads (Page name, customer PSID, etc).
  MESSENGER: Facebook,
};

export function ConversationDetailClient({
  slug,
  initialConversation,
}: {
  slug: string;
  initialConversation: ConversationWithMessages;
}) {
  const [conversation, setConversation] = useState(initialConversation);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(
    initialConversation.messages.at(-1)?.id ?? null,
  );

  // Polling: every 4s, refresh the conversation. If the trailing message
  // changed, scroll to the bottom; otherwise leave the user's scroll
  // position alone so reading mid-thread isn't disrupted by the refresh.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getConversationDetail(slug, conversation.id);
        if (cancelled || !next) return;
        const newLastId = next.messages.at(-1)?.id ?? null;
        const prevLastId = lastMessageIdRef.current;
        setConversation(next);
        if (newLastId !== prevLastId) {
          lastMessageIdRef.current = newLastId;
          // Defer to next tick so the DOM has the new bubble.
          requestAnimationFrame(() => scrollToBottom(messageListRef.current));
        }
      } catch (err) {
        if (!cancelled) console.error("[poll] getConversationDetail failed:", err);
      }
    };
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, conversation.id]);

  // Scroll to bottom on first mount.
  useEffect(() => {
    scrollToBottom(messageListRef.current);
  }, []);

  const ChannelIcon = CHANNEL_ICON[conversation.channel.type];

  return (
    <div className="mx-auto flex h-[calc(100vh-0px)] max-w-4xl flex-col px-6 py-8 lg:px-10 lg:py-10">
      <Link
        href={`/${slug}/conversations`}
        className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-tertiary)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="size-3.5" />
        Conversations
      </Link>

      <DetailHeader conversation={conversation} ChannelIcon={ChannelIcon} />

      <ReadOnlyBanner />

      <div
        ref={messageListRef}
        className="mt-4 flex-1 space-y-5 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      >
        {conversation.messages.length === 0 ? (
          <p className="text-center text-body-sm text-[var(--text-tertiary)]">
            No messages on this conversation yet.
          </p>
        ) : (
          conversation.messages.map((m) => (
            <DashboardMessageBubble key={m.id} message={m} />
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

function DetailHeader({
  conversation,
  ChannelIcon,
}: {
  conversation: ConversationWithMessages;
  ChannelIcon: LucideIcon;
}) {
  const escalationReason = readEscalationReason(conversation.metadata);
  return (
    <header className="mt-3 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2 text-[var(--text-primary)]">
            {customerLabel(conversation.customer)}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <ChannelIcon aria-hidden className="size-3.5" />
              {conversation.channel.displayName}
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono text-caption text-[var(--text-tertiary)]">
              {conversation.channel.type === "WHATSAPP" &&
              conversation.customer.phone
                ? conversation.customer.phone
                : conversation.customer.externalId}
            </span>
            {conversation.language ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  Language:{" "}
                  <span className="font-mono uppercase">
                    {conversation.language}
                  </span>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <DetailStatusBadge
          status={conversation.status}
          aiEnabled={conversation.aiEnabled}
        />
      </div>
      {conversation.status === "HUMAN_HANDLING" && escalationReason ? (
        <EscalationCallout reason={escalationReason} />
      ) : null}
    </header>
  );
}

const DETAIL_STATUS_VARIANTS: Record<
  ConversationStatus,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: "Active",
    className:
      "border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]",
  },
  HUMAN_HANDLING: {
    label: "Escalated · awaiting human",
    className:
      "border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning)]",
  },
  PAUSED: {
    label: "Paused",
    className:
      "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]",
  },
  CLOSED: {
    label: "Closed",
    className:
      "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)]",
  },
};

function DetailStatusBadge({
  status,
  aiEnabled,
}: {
  status: ConversationStatus;
  aiEnabled: boolean;
}) {
  const v = DETAIL_STATUS_VARIANTS[status];
  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-medium",
          v.className,
        )}
      >
        {v.label}
      </span>
      <span className="text-caption text-[var(--text-tertiary)]">
        {aiEnabled ? "AI replying" : "AI paused"}
      </span>
    </div>
  );
}

function EscalationCallout({ reason }: { reason: string }) {
  return (
    <div
      role="status"
      className="mt-3 flex items-start gap-3 rounded-lg border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-4 py-3"
    >
      <AlertTriangle
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
      />
      <div className="text-body-sm text-[var(--text-primary)]">
        <span className="font-medium">Escalated:</span>{" "}
        <span className="font-mono">{reason}</span>
        <p className="mt-0.5 text-[var(--text-secondary)]">
          The AI flagged this conversation and stopped replying. Phase 8 lights
          up takeover so an agent can step in directly from this view.
        </p>
      </div>
    </div>
  );
}

function ReadOnlyBanner() {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-3 py-1.5 text-caption text-[var(--text-tertiary)]">
      <Lock aria-hidden className="size-3" />
      Read-only view — replying as agent ships in Phase 8.
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function scrollToBottom(el: HTMLDivElement | null): void {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function customerLabel(c: ConversationWithMessages["customer"]): string {
  if (c.name && c.name.length > 0) return c.name;
  return "Anonymous customer";
}

function readEscalationReason(metadata: unknown): string | null {
  // markConversationForHandoff stashes { lastEscalationReason } on the JSON
  // metadata column. Defensive read — a malformed value just hides the
  // callout rather than crashing the page.
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)["lastEscalationReason"];
  return typeof value === "string" ? value : null;
}
