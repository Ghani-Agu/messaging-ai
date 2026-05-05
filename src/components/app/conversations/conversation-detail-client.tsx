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
import {
  buildConversationHeaderMetadata,
  customerDisplayLabel,
} from "@/lib/conversation-display";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
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
    <PageShell width="4xl" className="flex h-screen flex-col py-8 lg:py-10">
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
        className="custom-scrollbar mt-4 flex-1 space-y-5 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
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
    </PageShell>
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
  const headerMeta = buildConversationHeaderMetadata({
    channelType: conversation.channel.type,
    channelDisplayName: conversation.channel.displayName,
    channelConfig: conversation.channel.config,
    customerPhone: conversation.customer.phone,
    customerExternalId: conversation.customer.externalId,
  });
  const title = customerDisplayLabel({
    name: conversation.customer.name,
    externalId: conversation.customer.externalId,
    channelType: conversation.channel.type,
  });
  const eyebrowMeta = (
    <Eyebrow icon={ChannelIcon}>
      {headerMeta.channelLabel}
      {headerMeta.contextLabel ? (
        <>
          <span aria-hidden className="mx-1.5 text-[var(--text-tertiary)]">
            ·
          </span>
          <span className="font-mono normal-case tracking-normal">
            {headerMeta.contextLabel}
          </span>
        </>
      ) : null}
      {conversation.language ? (
        <>
          <span aria-hidden className="mx-1.5 text-[var(--text-tertiary)]">
            ·
          </span>
          <span className="font-mono normal-case tracking-normal">
            {conversation.language}
          </span>
        </>
      ) : null}
    </Eyebrow>
  );
  return (
    <div className="mt-3">
      <PageHeader
        eyebrow={eyebrowMeta}
        title={title}
        actions={
          <DetailStatusBadge
            status={conversation.status}
            aiEnabled={conversation.aiEnabled}
          />
        }
      />
      {conversation.status === "HUMAN_HANDLING" && escalationReason ? (
        <EscalationCallout reason={escalationReason} />
      ) : null}
    </div>
  );
}

// Map ConversationStatus → Badge variant. Detail-page label is more
// descriptive ("Escalated · awaiting human") than the list-page one
// because there's room.
const DETAIL_STATUS_BADGE: Record<
  ConversationStatus,
  { label: string; variant: "success" | "warning" | "default" }
> = {
  ACTIVE: { label: "Active", variant: "success" },
  HUMAN_HANDLING: {
    label: "Escalated · awaiting human",
    variant: "warning",
  },
  PAUSED: { label: "Paused", variant: "default" },
  CLOSED: { label: "Closed", variant: "default" },
};

function DetailStatusBadge({
  status,
  aiEnabled,
}: {
  status: ConversationStatus;
  aiEnabled: boolean;
}) {
  const v = DETAIL_STATUS_BADGE[status];
  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant={v.variant}>{v.label}</Badge>
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

function readEscalationReason(metadata: unknown): string | null {
  // markConversationForHandoff stashes { lastEscalationReason } on the JSON
  // metadata column. Defensive read — a malformed value just hides the
  // callout rather than crashing the page.
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)["lastEscalationReason"];
  return typeof value === "string" ? value : null;
}
