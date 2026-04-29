"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Power,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import {
  disconnectWhatsAppChannel,
  reconnectWhatsAppChannel,
  rotateWhatsAppWebhookSecret,
  testWhatsAppConnection,
  updateWhatsAppConfig,
} from "@/server/channels/whatsapp/actions";
import {
  disconnectWhatsAppInitialState,
  rotateWhatsAppSecretInitialState,
  testWhatsAppConnectionInitialState,
  updateWhatsAppConfigInitialState,
  type DisconnectWhatsAppState,
  type RotateWhatsAppSecretState,
  type TestWhatsAppConnectionState,
  type UpdateWhatsAppConfigState,
} from "@/server/channels/whatsapp/state";
import { cn } from "@/lib/utils";

type Props = {
  tenantSlug: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  phoneNumberId: string;
  phoneNumber: string | undefined;
  displayName: string;
  webhookUrl: string;
  verifyToken: string | null;
  canEditConfig: boolean;
  canRotateOrDisconnect: boolean;
};

export function WhatsAppConfigCard(props: Props) {
  return (
    <div className="space-y-6">
      <StatusBanner
        status={props.status}
        canRotateOrDisconnect={props.canRotateOrDisconnect}
        tenantSlug={props.tenantSlug}
      />
      <ConfigForm {...props} />
      <WebhookSetupSection {...props} />
      <KeyAndConnectionSection {...props} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top status banner
// ─────────────────────────────────────────────────────────────────────────────

function StatusBanner({
  status,
  canRotateOrDisconnect,
  tenantSlug,
}: {
  status: Props["status"];
  canRotateOrDisconnect: boolean;
  tenantSlug: string;
}) {
  const [state, formAction, pending] = useActionState<
    DisconnectWhatsAppState,
    FormData
  >(reconnectWhatsAppChannel, disconnectWhatsAppInitialState);

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
// Config form (displayName, phoneNumber)
// ─────────────────────────────────────────────────────────────────────────────

function ConfigForm({
  tenantSlug,
  displayName: initialDisplayName,
  phoneNumber: initialPhoneNumber,
  phoneNumberId,
  canEditConfig,
}: Pick<
  Props,
  | "tenantSlug"
  | "displayName"
  | "phoneNumber"
  | "phoneNumberId"
  | "canEditConfig"
>) {
  const [state, formAction, pending] = useActionState<
    UpdateWhatsAppConfigState,
    FormData
  >(updateWhatsAppConfig, updateWhatsAppConfigInitialState);

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? "");
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state.status === "saved") {
      setDisplayName(initialDisplayName);
      setPhoneNumber(initialPhoneNumber ?? "");
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2200);
      return () => clearTimeout(t);
    }
  }, [state, initialDisplayName, initialPhoneNumber]);

  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const formMessage =
    state.status === "error" ? state.formMessage : undefined;

  return (
    <section
      aria-labelledby="wa-config-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <h2
        id="wa-config-heading"
        className="text-h4 text-[var(--text-primary)]"
      >
        Configuration
      </h2>
      <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
        Display name and phone number can be edited freely. The
        phone-number-id and provider are immutable post-connect — to
        change them, disconnect and reconnect.
      </p>

      <div className="mt-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-body-sm text-[var(--text-tertiary)]">
        <span className="text-[var(--text-secondary)]">Phone-number-id:</span>{" "}
        <code className="font-mono text-[var(--text-primary)]">
          {phoneNumberId}
        </code>
      </div>

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
        <SmallField
          label="Phone number (E.164)"
          name="phoneNumber"
          value={phoneNumber}
          onChange={setPhoneNumber}
          disabled={!canEditConfig || pending}
          error={fieldErrors?.phoneNumber}
          placeholder="+213555123456"
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
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
  placeholder?: string;
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
        placeholder={placeholder}
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
// Webhook setup details
// ─────────────────────────────────────────────────────────────────────────────

function WebhookSetupSection({
  webhookUrl,
  verifyToken,
}: Pick<Props, "webhookUrl" | "verifyToken">) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <h2 className="text-h4 text-[var(--text-primary)]">Webhook setup</h2>
      <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
        Paste these into 360dialog&rsquo;s webhook configuration. The
        URL is the same across all your channels; only the HMAC secret
        differs per channel.
      </p>
      <div className="mt-4 space-y-3">
        <CopyableRow label="Webhook URL" value={webhookUrl} />
        {verifyToken ? (
          <CopyableRow label="Verify token" value={verifyToken} />
        ) : (
          <div className="rounded-md border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-3 py-2 text-body-sm text-[var(--text-primary)]">
            META_VERIFY_TOKEN is not set — register the webhook in
            360dialog with any non-empty token, then set the env var to
            match before going live.
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
// Webhook secret rotate + test connection + disconnect
// ─────────────────────────────────────────────────────────────────────────────

function KeyAndConnectionSection({
  tenantSlug,
  status,
  canRotateOrDisconnect,
}: Pick<Props, "tenantSlug" | "status" | "canRotateOrDisconnect">) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
      <h2 className="text-h4 text-[var(--text-primary)]">
        Secret &amp; connection
      </h2>
      <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
        Rotate breaks every webhook delivery against the old secret —
        update 360dialog immediately. Test connection runs a config-
        validity check (encryption keys + schema); the first real
        webhook is the network test.
      </p>
      <div className="mt-4 space-y-3">
        <RotateRow
          tenantSlug={tenantSlug}
          canRotate={canRotateOrDisconnect}
        />
        <TestRow tenantSlug={tenantSlug} />
        {status === "CONNECTED" ? (
          <DisconnectRow
            tenantSlug={tenantSlug}
            canDisconnect={canRotateOrDisconnect}
          />
        ) : null}
      </div>
    </section>
  );
}

function RotateRow({
  tenantSlug,
  canRotate,
}: {
  tenantSlug: string;
  canRotate: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    RotateWhatsAppSecretState,
    FormData
  >(rotateWhatsAppWebhookSecret, rotateWhatsAppSecretInitialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        {confirming ? (
          <>
            <span className="text-body-sm text-[var(--text-secondary)]">
              Rotating breaks every existing webhook. Update 360dialog
              immediately.
            </span>
            <button
              type="submit"
              disabled={!canRotate || pending}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] px-4 text-body-sm font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_22%,transparent)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Confirm rotate
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
          <>
            <button
              type="button"
              disabled={!canRotate}
              onClick={() => setConfirming(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-3 text-body-sm font-medium hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw className="size-3.5" /> Rotate webhook secret
            </button>
            {!canRotate ? (
              <span className="text-body-sm text-[var(--text-tertiary)]">
                Only admins can rotate.
              </span>
            ) : null}
          </>
        )}
      </form>
      {state.status === "rotated" ? (
        <div className="rounded-md border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] p-3 text-body-sm">
          <p className="text-[var(--text-primary)]">
            New secret minted. Copy it into 360dialog now — it
            won&rsquo;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-[var(--bg-base)] p-2 font-mono text-caption text-[var(--text-primary)]">
            {state.webhookSecret}
          </code>
        </div>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-body-sm text-[var(--danger)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function TestRow({ tenantSlug }: { tenantSlug: string }) {
  const [state, formAction, pending] = useActionState<
    TestWhatsAppConnectionState,
    FormData
  >(testWhatsAppConnection, testWhatsAppConnectionInitialState);
  return (
    <div className="space-y-1">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
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
            <Check className="size-4" /> Config valid
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
  canDisconnect,
}: {
  tenantSlug: string;
  canDisconnect: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    DisconnectWhatsAppState,
    FormData
  >(disconnectWhatsAppChannel, disconnectWhatsAppInitialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-1">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        {confirming ? (
          <>
            <span className="text-body-sm text-[var(--text-secondary)]">
              Pausing stops AI replies; webhooks still 200-ack.
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
