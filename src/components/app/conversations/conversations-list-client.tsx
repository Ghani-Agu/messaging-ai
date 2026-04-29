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
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-h1 text-[var(--text-primary)]">
              Conversations
            </h1>
            <p className="mt-2 text-body text-[var(--text-secondary)]">
              Live inbox of every customer thread. Read-only this phase —
              takeover and reply-as-agent ship in Phase 8.
            </p>
          </div>
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
        </div>
      </header>

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
        <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {rows.map((row) => (
            <li key={row.id}>
              <ConversationRow slug={slug} row={row} />
            </li>
          ))}
        </ul>
      )}

      {rows.length === 50 ? (
        <p className="mt-4 text-body-sm text-[var(--text-tertiary)]">
          Showing the 50 most recent. Pagination arrives in Phase 9.
        </p>
      ) : null}
    </div>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!filter.enabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-body-sm font-medium",
        "transition-colors duration-150 ease-out",
        active
          ? "border-[var(--accent-base)] bg-[color-mix(in_oklab,var(--accent-base)_15%,transparent)] text-[var(--accent-hover)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]",
        !filter.enabled && "cursor-not-allowed opacity-60",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {filter.label}
      {!filter.enabled && filter.comingInPhase !== undefined ? (
        <span className="text-caption text-[var(--text-tertiary)]">
          (Phase {filter.comingInPhase})
        </span>
      ) : null}
    </button>
  );
}

function ConversationRow({
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
  return (
    <Link
      href={`/${slug}/conversations/${row.id}`}
      className={cn(
        "group flex items-center gap-4 px-4 py-3.5",
        "transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-elevated)]",
        "focus-visible:outline-none focus-visible:bg-[var(--bg-surface-elevated)]",
      )}
    >
      <CustomerAvatar row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body font-medium text-[var(--text-primary)]">
            {label}
          </span>
          <ConversationStatusPill status={row.status} />
          {row.language ? <LanguageFlag language={row.language} /> : null}
        </div>
        <p className="mt-0.5 truncate text-body-sm text-[var(--text-tertiary)]">
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
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <time
          dateTime={row.lastMessageAt.toISOString()}
          className="text-caption text-[var(--text-tertiary)]"
        >
          {formatRelative(row.lastMessageAt)}
        </time>
        <span className="text-caption text-[var(--text-tertiary)]">
          {row._count.messages}{" "}
          {row._count.messages === 1 ? "msg" : "msgs"}
        </span>
      </div>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-[var(--text-tertiary)] transition-colors duration-150 group-hover:text-[var(--text-secondary)]"
      />
    </Link>
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

const STATUS_PILLS: Record<
  ConversationStatus,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: "Active",
    className:
      "border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]",
  },
  HUMAN_HANDLING: {
    label: "Escalated",
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

function ConversationStatusPill({ status }: { status: ConversationStatus }) {
  const v = STATUS_PILLS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0 text-caption font-medium",
        v.className,
      )}
    >
      {v.label}
    </span>
  );
}

function LanguageFlag({ language }: { language: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0 font-mono text-caption uppercase text-[var(--text-tertiary)]">
      {language}
    </span>
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
