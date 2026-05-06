"use client";

import { useState, useTransition } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  Database,
  Pencil,
  RefreshCw,
  Unplug,
} from "lucide-react";
import type { LiveDataSource, LiveDataSourceStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import {
  disconnectSourceAction,
  syncNowAction,
} from "@/server/integrations/actions";
import { durationFast, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Per-source tile shown on /knowledge/live-data once a source is
 * connected. Renders status, last-sync timestamp, total record count,
 * and inline error (when status=ERROR).
 *
 * Action buttons (Sync now / Edit / Disconnect) are gated by canEdit
 * — non-OWNER roles see the card but with actions hidden.
 */
export function LiveDataSourceCard({
  source,
  canEdit,
  tenantSlug,
  onEdit,
}: {
  source: LiveDataSource;
  canEdit: boolean;
  tenantSlug: string;
  onEdit: (source: LiveDataSource) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSyncNow = () => {
    setActionError(null);
    startTransition(async () => {
      try {
        await syncNowAction(tenantSlug, source.id);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Sync failed",
        );
      }
    });
  };

  const handleDisconnect = () => {
    setActionError(null);
    startTransition(async () => {
      try {
        await disconnectSourceAction(tenantSlug, source.id);
        setConfirmingDisconnect(false);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Disconnect failed",
        );
      }
    });
  };

  return (
    <>
      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md",
                "border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-[var(--accent-hover)]",
              )}
            >
              <Database className="size-4" />
            </span>
            <div>
              <h3 className="text-h4 text-[var(--text-primary)]">
                {source.name}
              </h3>
              <p className="text-caption text-[var(--text-tertiary)]">
                {source.type === "ODOO" ? "Odoo" : source.type}
              </p>
            </div>
          </div>
          <StatusPill status={source.status} pending={pending} />
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-3">
          <Field label="Last synced" value={formatLastSync(source)} />
          <Field
            label="Products synced"
            value={source.syncedRecordCount.toLocaleString()}
          />
          <Field label="Status" value={statusLabel(source.status)} />
        </div>

        {source.status === "ERROR" && source.lastSyncError ? (
          <ErrorBanner message={source.lastSyncError} />
        ) : null}
        {actionError ? (
          <ErrorBanner message={actionError} variant="action" />
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSyncNow}
              disabled={pending || source.status === "DISCONNECTED"}
            >
              <RefreshCw
                className={cn(
                  "size-3.5",
                  pending && "animate-[spin_1s_linear_infinite] motion-reduce:animate-none",
                )}
                aria-hidden
              />
              Sync now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(source)}
              disabled={pending}
            >
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDisconnect(true)}
              disabled={pending || source.status === "DISCONNECTED"}
            >
              <Unplug className="size-3.5" aria-hidden />
              Disconnect
            </Button>
          </div>
        ) : null}
      </Card>

      {confirmingDisconnect ? (
        <DisconnectConfirmModal
          name={source.name}
          pending={pending}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={handleDisconnect}
        />
      ) : null}
    </>
  );
}

function StatusPill({
  status,
  pending,
}: {
  status: LiveDataSourceStatus;
  pending: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  if (pending) {
    return (
      <Badge variant="info" size="md" className="gap-1.5">
        <motion.span
          aria-hidden
          className="size-1.5 rounded-full bg-current"
          animate={{ opacity: prefersReducedMotion ? 1 : [1, 0.3, 1] }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 1, repeat: Infinity, ease: "easeInOut" }
          }
        />
        Syncing…
      </Badge>
    );
  }
  switch (status) {
    case "PENDING_TEST":
      return (
        <Badge variant="warning" size="md">
          Pending first sync
        </Badge>
      );
    case "CONNECTED":
      return (
        <Badge variant="success" size="md">
          Connected
        </Badge>
      );
    case "ERROR":
      return (
        <Badge variant="danger" size="md">
          Error
        </Badge>
      );
    case "DISCONNECTED":
      return (
        <Badge variant="default" size="md">
          Disconnected
        </Badge>
      );
  }
}

function statusLabel(status: LiveDataSourceStatus): string {
  switch (status) {
    case "PENDING_TEST":
      return "Pending";
    case "CONNECTED":
      return "Connected";
    case "ERROR":
      return "Error";
    case "DISCONNECTED":
      return "Disconnected";
  }
}

function formatLastSync(source: LiveDataSource): string {
  if (!source.lastSyncedAt) return "Never";
  const minutes = Math.round(
    (Date.now() - source.lastSyncedAt.getTime()) / 60_000,
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function ErrorBanner({
  message,
  variant = "sync",
}: {
  message: string;
  variant?: "sync" | "action";
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 border-t px-5 py-3",
        "border-[color-mix(in_oklab,var(--danger)_20%,transparent)]",
        "bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]",
      )}
    >
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-[var(--danger)]"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-body-sm text-[var(--text-primary)]">
          {variant === "action" ? "Action failed" : "Last sync failed"}
        </p>
        <p
          className={cn(
            "mt-0.5 break-words font-mono text-caption text-[var(--text-secondary)]",
          )}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

function DisconnectConfirmModal({
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { duration: durationFast, ease: easeOutExpo }
        }
        className="w-full max-w-md"
      >
        <Card className="p-0">
          <div className="px-5 py-4">
            <h3
              id="disconnect-title"
              className="text-h4 text-[var(--text-primary)]"
            >
              Disconnect {name}?
            </h3>
            <p className="mt-2 text-body-sm text-[var(--text-secondary)]">
              This stops syncing. Synced products remain in your
              catalog. You can reconnect later from the same screen.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              disabled={pending}
            >
              Disconnect
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
