"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Facebook,
  Globe,
  Inbox,
  Instagram,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { ChannelType, ConversationStatus } from "@prisma/client";
import { listConversations } from "@/server/conversations/actions";
import type { ConversationListRow } from "@/server/db/conversations";
import {
  customerDisplayLabel,
  customerInitial,
} from "@/lib/conversation-display";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";

const POLL_INTERVAL_MS = 4000;

type FilterOption = {
  value: ChannelType;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  comingInPhase?: number;
};

const FILTERS: FilterOption[] = [
  { value: "WIDGET", label: "Website", icon: Globe, enabled: true },
  { value: "WHATSAPP", label: "WhatsApp", icon: MessageCircle, enabled: true },
  { value: "MESSENGER", label: "Messenger", icon: Facebook, enabled: true },
  { value: "INSTAGRAM", label: "Instagram", icon: Instagram, enabled: true },
];

export function ConversationsListClient({
  slug,
  initialConversations,
}: {
  slug: string;
  initialConversations: ConversationListRow[];
}) {
  const [filter, setFilter] = useState<ChannelType>("WIDGET");
  const [rows, setRows] = useState(initialConversations);
  const [polling, setPolling] = useState(false);

  // Polling: every 4s, re-fetch the list under the current filter. Same
  // cadence as the Knowledge page. Mounts/unmounts the interval whenever
  // `slug` or `filter` changes; race-tolerant via a stale-check token.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await listConversations(slug, { channelType: filter });
        if (!cancelled) setRows(next);
      } catch (err) {
        if (!cancelled) console.error("[poll] listConversations failed:", err);
      } finally {
        if (!cancelled) setPolling(false);
      }
    };
    setPolling(true);
    void poll();
    const id = setInterval(() => {
      setPolling(true);
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, filter]);

  return (
    <PageShell width="5xl">
      <PageHeader
        eyebrow={<Eyebrow>Inbox</Eyebrow>}
        title="Conversations"
        description="Live inbox of every customer thread. Read-only this phase — takeover and reply-as-agent ship in Phase 8."
        actions={
          <span
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]",
              "transition-opacity duration-200",
              polling ? "opacity-100" : "opacity-0",
            )}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent-base)]" />
            Refreshing
          </span>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <ChannelFilterButton
            key={f.value}
            filter={f}
            active={filter === f.value}
            onSelect={() => f.enabled && setFilter(f.value)}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ConversationCard slug={slug} row={row} />
            </li>
          ))}
        </ul>
      )}

      {rows.length === 50 ? (
        <p className="mt-4 text-body-sm text-[var(--text-tertiary)]">
          Showing the 50 most recent. Pagination arrives in Phase 9.
        </p>
      ) : null}
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ChannelFilterButton({
  filter,
  active,
  onSelect,
}: {
  filter: FilterOption;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = filter.icon;
  // Badge asChild lets us keep the design-system pill chrome while
  // the underlying element stays a real <button> (focus, disabled, etc).
  // The override className bumps the pill height for a comfortable hit
  // target — Badge's `md` is sized for inline tags.
  return (
    <Badge
      asChild
      variant={active ? "accent" : "default"}
      className={cn(
        "h-8 cursor-pointer gap-2 px-3 text-body-sm",
        "transition-colors duration-150 ease-out",
        !active &&
          "hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
        !filter.enabled && "cursor-not-allowed opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!filter.enabled}
      >
        <Icon aria-hidden className="size-3.5" />
        {filter.label}
        {!filter.enabled && filter.comingInPhase !== undefined ? (
          <span className="text-caption text-[var(--text-tertiary)]">
            (Phase {filter.comingInPhase})
          </span>
        ) : null}
      </button>
    </Badge>
  );
}

function ConversationCard({
  slug,
  row,
}: {
  slug: string;
  row: ConversationListRow;
}) {
  const lastMessage = row.messages[0] ?? null;
  const label = customerDisplayLabel({
    name: row.customer.name,
    externalId: row.customer.externalId,
    channelType: row.channel.type,
  });
  const channelLabel = row.channel.type.toLowerCase();
  const idShort = row.id.slice(-6);
  return (
    <Card className="transition-colors duration-150 ease-out hover:border-[var(--border-default)]">
      <Link
        href={`/${slug}/conversations/${row.id}`}
        className={cn(
          "group flex items-start gap-4 p-4",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] focus-visible:rounded-lg",
        )}
      >
        <CustomerAvatar row={row} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>
              conv:{idShort} · {channelLabel}
            </Eyebrow>
            <ConversationStatusBadge status={row.status} />
            {row.language ? (
              <Badge variant="default" size="sm" className="font-mono uppercase">
                {row.language}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-body font-medium text-[var(--text-primary)]">
            {label}
          </p>
          <p className="line-clamp-2 text-body-sm text-[var(--text-tertiary)]">
            {lastMessage ? (
              <>
                <span className="font-medium text-[var(--text-secondary)]">
                  {lastMessage.sender === "CUSTOMER"
                    ? "Customer"
                    : lastMessage.sender === "AI"
                      ? "AI"
                      : "Agent"}
                  :{" "}
                </span>
                {lastMessage.content}
              </>
            ) : (
              <span className="italic">No messages yet</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field
              label="Last activity"
              value={formatRelative(row.lastMessageAt)}
            />
            <Field
              label="Messages"
              value={`${row._count.messages.toLocaleString()} ${
                row._count.messages === 1 ? "msg" : "msgs"
              }`}
            />
            <Field
              label="Customer"
              value={row.customer.name ?? row.customer.externalId.slice(-8)}
            />
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 self-center text-body-sm font-medium text-[var(--text-tertiary)] transition-colors duration-150 group-hover:text-[var(--accent-hover)]">
          Open
          <ChevronRight
            aria-hidden
            className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </Card>
  );
}

function CustomerAvatar({ row }: { row: ConversationListRow }) {
  const initial = customerInitial({
    name: row.customer.name,
    externalId: row.customer.externalId,
  });
  return (
    <div
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface-elevated)] text-body-sm font-medium text-[var(--text-secondary)]"
    >
      {initial}
    </div>
  );
}

// Map ConversationStatus → Badge variant. Keeps the design-system
// status semantics (success/warning/default) consistent across the
// list, the conversation detail header, and any future surfaces that
// surface a conversation pill.
const STATUS_BADGE: Record<
  ConversationStatus,
  { label: string; variant: "success" | "warning" | "default" }
> = {
  ACTIVE: { label: "Active", variant: "success" },
  HUMAN_HANDLING: { label: "Escalated", variant: "warning" },
  PAUSED: { label: "Paused", variant: "default" },
  CLOSED: { label: "Closed", variant: "default" },
};

function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  const v = STATUS_BADGE[status];
  return (
    <Badge variant={v.variant} size="sm">
      {v.label}
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-8 py-16 text-center">
      <div
        aria-hidden
        className="mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--bg-surface-elevated)] text-[var(--text-tertiary)]"
      >
        <Inbox className="size-5" />
      </div>
      <h3 className="text-h4 text-[var(--text-primary)]">No conversations yet</h3>
      <p className="mt-2 max-w-md text-body-sm text-[var(--text-secondary)]">
        Once a customer messages you on a connected channel, the thread shows
        up here. The widget snippet on the channels page is the fastest way to
        get a first conversation in.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatRelative(d: Date): string {
  const now = Date.now();
  const ms = now - d.getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds <= 5 ? "just now" : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
