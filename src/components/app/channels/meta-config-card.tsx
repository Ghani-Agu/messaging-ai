"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Power,
  ShieldCheck,
} from "lucide-react";
import {
  disconnectInstagram,
  disconnectMessenger,
  reconnectInstagram,
  reconnectMessenger,
  testConnection,
  updateInstagramConfig,
  updateMessengerConfig,
} from "@/server/channels/meta/actions";
import {
  configUpdateInitialState,
  disconnectInitialState,
  testConnectionInitialState,
  type ConfigUpdateState,
  type DisconnectState,
  type TestConnectionState,
} from "@/server/channels/meta/state";
import { cn } from "@/lib/utils";

/**
 * Shared config card for Messenger + Instagram detail pages. The two
 * platforms share enough structure (status banner, displayName edit,
 * webhook URL display, test button, disconnect) that a single
 * parameterized component is cleaner than two near-duplicate ones. The
 * platform-specific metadata (page name + pageId vs @username +
 * igUserId + linked Page) lives in `readOnlyRows` passed by the parent
 * page.
 *
 * Per Gate 1 H3, disconnecting one platform doesn't affect the other
 * — each card binds its own server actions, scoped to its Channel row.
 */

export type MetaPlatform = "messenger" | "instagram";

type Props = {
  tenantSlug: string;
  platform: MetaPlatform;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  displayName: string;
  /**
   * Read-only metadata rows shown above the displayName field. Differs
   * by platform — the parent page projects from MessengerChannelConfig
   * or InstagramChannelConfig.
   */
  readOnlyRows: { label: string; value: string; mono?: boolean }[];
  webhookUrl: string;
  verifyToken: string | null;
  canEditConfig: boolean;
  canRotateOrDisconnect: boolean;
};

export function MetaConfigCard(props: Props) {
  return (
    <div className="space-y-6">
      <StatusBanner
        platform={props.platform}
        status={props.status}
        canRotateOrDisconnect={props.canRotateOrDisconnect}
        tenantSlug={props.tenantSlug}
      />
      <ConfigForm {...props} />
      <WebhookSetupSection {...props} />
      <TestAndDisconnectSection {...props} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status banner
// ─────────────────────────────────────────────────────────────────────────────

function StatusBanner({
  platform,
  status,
  canRotateOrDisconnect,
  tenantSlug,
}: {
  platform: MetaPlatform;
  status: Props["status"];
  canRotateOrDisconnect: boolean;
  tenantSlug: string;
}) {
  const reconnect =
    platform === "messenger" ? reconnectMessenger : reconnectInstagram;
  const [state, formAction, pending] = useActionState<
    DisconnectState,
    FormData
  >(reconnect, disconnectInitialState);

  if (status === "CONNECTED") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-4 py-2.5">
        <ShieldCheck aria-hidden className="size-4 text-[var(--success)]" />
        <span className="text-body-sm text-[var(--text-primary)]">
          Channel connected — webhooks are active.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Power aria-hidden className="size-4 text-[var(--warning)]" />
        <span className="text-body-sm text-[var(--text-primary)]">
          Channel paused — incoming webhooks 200 ack&rsquo;d but ignored.
        </span>
      </div>
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <button
          type="submit"
          disabled={!canRotateOrDisconnect || pending}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-transparent px-3 text-body-sm font-medium",
            "hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)]",
            "transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Reconnect
        </button>
      </form>
      {state.status === "error" ? (
        <span className="text-caption text-[var(--danger)]">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display-name edit
// ─────────────────────────────────────────────────────────────────────────────

function ConfigForm({
  tenantSlug,
  platform,
  displayName: initialDisplayName,
  readOnlyRows,
  canEditConfig,
}: Pick<
  Props,
  "tenantSlug" | "platform" | "displayName" | "readOnlyRows" | "canEditConfig"
>) {
  const updateAction =
    platform === "messenger" ? updateMessengerConfig : updateInstagramConfig;
  const [state, formAction, pending] = useActionState<
    ConfigUpdateState,
    FormData
  >(updateAction, configUpdateInitialState);

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state.status === "saved") {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2200);
      return () => clearTimeout(t);
    }
  }, [state]);

  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const formMessage =
    state.status === "error" ? state.formMessage : undefined;

  return (
    <section
      aria-labelledby="meta-config-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <h2
        id="meta-config-heading"
        className="text-h4 text-[var(--text-primary)]"
      >
        Configuration
      </h2>
      <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
        Display name is editable. The Meta IDs are immutable post-connect
        — to change them, disconnect and reconnect with a new Page or IG
        account.
      </p>

      <dl className="mt-4 space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-body-sm">
        {readOnlyRows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-3">
            <dt className="min-w-[8rem] text-[var(--text-secondary)]">
              {row.label}
            </dt>
            <dd
              className={cn(
                "text-[var(--text-primary)]",
                row.mono && "font-mono text-caption",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <form action={formAction} className="mt-5 space-y-5" noValidate>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <SmallField
          label="Display name"
          name="displayName"
          value={displayName}
          onChange={setDisplayName}
          disabled={!canEditConfig || pending}
          error={fieldErrors?.displayName}
        />

        {formMessage ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {formMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canEditConfig || pending}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-4 text-body-sm font-medium",
              "bg-[var(--accent-base)] text-white",
              "hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]",
              "active:bg-[var(--accent-active)]",
              "transition-[background-color,box-shadow] duration-150 ease-out",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </button>
          {showSaved ? (
            <span className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]">
              <Check className="size-4" /> Saved
            </span>
          ) : null}
          {!canEditConfig ? (
            <span className="text-body-sm text-[var(--text-tertiary)]">
              Agents and above can edit configuration.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SmallField({
  label,
  name,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
        {label}
      </span>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={cn(
          "block h-10 w-full max-w-md rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
          "transition-colors duration-150 ease-out",
          "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-[invalid=true]:border-[var(--danger)]",
        )}
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook setup — same URL + verify token for Messenger and Instagram
// ─────────────────────────────────────────────────────────────────────────────

function WebhookSetupSection({
  webhookUrl,
  verifyToken,
}: Pick<Props, "webhookUrl" | "verifyToken">) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <h2 className="text-h4 text-[var(--text-primary)]">Webhook setup</h2>
      <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
        This webhook URL handles both Messenger and Instagram for this
        Page. Configure it once in your Meta App dashboard — both
        channels share the same endpoint and verify token.
      </p>
      <div className="mt-4 space-y-3">
        <CopyableRow label="Webhook URL" value={webhookUrl} />
        {verifyToken ? (
          <CopyableRow label="Verify token" value={verifyToken} />
        ) : (
          <div className="rounded-md border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-3 py-2 text-body-sm text-[var(--text-primary)]">
            META_VERIFY_TOKEN is not set — webhook subscription will fail
            until the env var is configured.
          </div>
        )}
      </div>
    </section>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="min-w-[7rem] text-body-sm text-[var(--text-secondary)]">
        {label}
      </span>
      <code className="flex-1 truncate rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-body-sm text-[var(--text-primary)]">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-body-sm hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] transition-colors duration-150"
      >
        {copied ? (
          <>
            <Check className="size-3.5 text-[var(--success)]" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" /> Copy
          </>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test connection + disconnect
// ─────────────────────────────────────────────────────────────────────────────

function TestAndDisconnectSection({
  tenantSlug,
  platform,
  status,
  canRotateOrDisconnect,
}: Pick<
  Props,
  "tenantSlug" | "platform" | "status" | "canRotateOrDisconnect"
>) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <h2 className="text-h4 text-[var(--text-primary)]">
        Connection &amp; status
      </h2>
      <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
        Test connection hits the Graph API to verify the stored Page
        Access Token is still live (Meta tokens expire periodically).
        Disconnect pauses webhook processing without deleting the
        channel — credentials stay encrypted at rest for reconnect.
      </p>
      <div className="mt-4 space-y-3">
        <TestRow tenantSlug={tenantSlug} platform={platform} />
        {status === "CONNECTED" ? (
          <DisconnectRow
            tenantSlug={tenantSlug}
            platform={platform}
            canDisconnect={canRotateOrDisconnect}
          />
        ) : null}
      </div>
    </section>
  );
}

function TestRow({
  tenantSlug,
  platform,
}: {
  tenantSlug: string;
  platform: MetaPlatform;
}) {
  const [state, formAction, pending] = useActionState<
    TestConnectionState,
    FormData
  >(testConnection, testConnectionInitialState);
  return (
    <div className="space-y-1">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="platform" value={platform} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-3 text-body-sm font-medium hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Test connection
        </button>
        {state.status === "ok" ? (
          <span className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]">
            <Check className="size-4" /> Token valid
            {state.pageName ? (
              <span className="ml-1 text-[var(--text-secondary)]">
                ({state.pageName})
              </span>
            ) : null}
          </span>
        ) : null}
        {state.status === "error" ? (
          <span role="alert" className="text-body-sm text-[var(--danger)]">
            {state.message}
          </span>
        ) : null}
      </form>
    </div>
  );
}

function DisconnectRow({
  tenantSlug,
  platform,
  canDisconnect,
}: {
  tenantSlug: string;
  platform: MetaPlatform;
  canDisconnect: boolean;
}) {
  const action =
    platform === "messenger" ? disconnectMessenger : disconnectInstagram;
  const [state, formAction, pending] = useActionState<
    DisconnectState,
    FormData
  >(action, disconnectInitialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-1">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        {confirming ? (
          <>
            <span className="text-body-sm text-[var(--text-secondary)]">
              Pausing stops AI replies on this channel only; the other
              platform stays active.
            </span>
            <button
              type="submit"
              disabled={!canDisconnect || pending}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--warning)] bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] px-4 text-body-sm font-medium text-[var(--warning)] hover:bg-[color-mix(in_oklab,var(--warning)_22%,transparent)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Confirm disconnect
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-body-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!canDisconnect}
            onClick={() => setConfirming(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-3 text-body-sm font-medium hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Power className="size-3.5" /> Disconnect
          </button>
        )}
      </form>
      {state.status === "error" ? (
        <p role="alert" className="text-body-sm text-[var(--danger)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
