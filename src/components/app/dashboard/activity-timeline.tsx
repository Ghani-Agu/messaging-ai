import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import type { ActivityEvent } from "@/lib/dashboard-activity";

interface ActivityTimelineProps {
  events: ActivityEvent[];
}

/**
 * Right-rail activity feed on the active dashboard. Renders up to N
 * events from getRecentActivity(); empty-state inline message when
 * the tenant has no activity yet.
 */
export function ActivityTimeline({ events }: ActivityTimelineProps) {
  return (
    <Card className="flex flex-col p-5">
      <header className="mb-4">
        <Eyebrow>Activity</Eyebrow>
        <p className="mt-1 text-body-sm font-medium text-[var(--text-primary)]">
          Recent events
        </p>
      </header>
      {events.length === 0 ? (
        <p className="text-body-sm text-[var(--text-tertiary)]">
          No activity yet — connect a channel to start.
        </p>
      ) : (
        <Timeline>
          {events.map((event) => (
            <TimelineItem
              key={event.id}
              variant={event.kind === "escalation_flagged" ? "default" : "muted"}
              eyebrow={formatRelative(event.timestamp)}
              title={renderTitle(event)}
              meta={renderMeta(event)}
            />
          ))}
        </Timeline>
      )}
    </Card>
  );
}

function renderTitle(event: ActivityEvent): string {
  switch (event.kind) {
    case "conversation_created":
      return `New conversation${
        event.customerName ? ` with ${event.customerName}` : ""
      }`;
    case "escalation_flagged":
      return `Escalated${
        event.customerName ? ` — ${event.customerName}` : ""
      }`;
    case "gap_logged":
      return `Knowledge gap: "${truncate(event.question, 56)}"`;
    case "item_verified":
      return `Verified item — ${event.itemName}`;
  }
}

function renderMeta(event: ActivityEvent): string | null {
  switch (event.kind) {
    case "conversation_created":
      return event.channelType.toLowerCase();
    case "escalation_flagged":
      return event.reason ?? null;
    case "gap_logged":
    case "item_verified":
      return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

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
