"use client";

import { useActionState, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { connectWhatsAppChannel } from "@/server/channels/whatsapp/actions";
import {
  connectWhatsAppInitialState,
  type ConnectWhatsAppState,
} from "@/server/channels/whatsapp/state";
import { cn } from "@/lib/utils";

/**
 * Initial-setup form for a tenant's WhatsApp channel. Operator pastes:
 *   - 360dialog API key (encrypted at rest)
 *   - WABA phone-number-id (the routing key on every webhook)
 *   - Phone number in E.164 (display only)
 *   - Display name
 *
 * Server mints the HMAC webhookSecret and returns it in the response
 * state — rendered once on the success view so the operator can paste
 * it into 360dialog's webhook config. After that, the secret is hidden;
 * a fresh one requires the rotate flow.
 *
 * Cross-tenant phoneNumberId collision is surfaced as a per-field
 * error: "This phone number is already connected to another workspace.
 * Contact support to transfer it." Caught by the action via the P2002
 * Prisma error on the partial unique index.
 */
export function WhatsAppConnectForm({
  tenantSlug,
  canConnect,
}: {
  tenantSlug: string;
  canConnect: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ConnectWhatsAppState,
    FormData
  >(connectWhatsAppChannel, connectWhatsAppInitialState);

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [apiToken, setApiToken] = useState("");

  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const formMessage =
    state.status === "error" ? state.formMessage : undefined;

  if (state.status === "connected") {
    return (
      <ConnectedSuccess
        tenantSlug={tenantSlug}
        webhookSecret={state.webhookSecret}
      />
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
      <div className="mb-6 flex items-center gap-3">
        <div
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--accent-base) 15%, transparent)",
            color: "var(--accent-hover)",
          }}
        >
          <MessageCircle className="size-6" />
        </div>
        <div>
          <h2 className="text-h4 text-[var(--text-primary)]">
            Connect WhatsApp via 360dialog
          </h2>
          <p className="text-body-sm text-[var(--text-secondary)]">
            Paste your 360dialog API key and the WABA phone-number-id.
            We mint the HMAC webhook secret server-side.
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-5" noValidate>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <Field
          label="WABA phone-number-id"
          name="phoneNumberId"
          value={phoneNumberId}
          onChange={setPhoneNumberId}
          disabled={!canConnect || pending}
          error={fieldErrors?.phoneNumberId}
          mono
          required
          help="From your 360dialog dashboard. Forwarded on every webhook in entry[].changes[].value.metadata.phone_number_id."
        />

        <Field
          label="Phone number (E.164)"
          name="phoneNumber"
          value={phoneNumber}
          onChange={setPhoneNumber}
          disabled={!canConnect || pending}
          error={fieldErrors?.phoneNumber}
          placeholder="+213555123456"
          help="Display only — not used for routing. The phoneNumberId is what identifies this channel on inbound webhooks."
        />

        <Field
          label="Display name"
          name="displayName"
          value={displayName}
          onChange={setDisplayName}
          disabled={!canConnect || pending}
          error={fieldErrors?.displayName}
          required
          help="Shown in the dashboard channels list. Customer-facing in some surfaces."
        />

        <Field
          label="360dialog API key"
          name="apiToken"
          value={apiToken}
          onChange={setApiToken}
          disabled={!canConnect || pending}
          error={fieldErrors?.apiToken}
          required
          mono
          type="password"
          help="Encrypted at rest with AES-256-GCM. Sent as the D360-API-KEY header on outbound calls."
        />

        {formMessage ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {formMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canConnect || pending}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md px-5 text-body-sm font-medium",
              "transition-[background-color,box-shadow] duration-150 ease-out",
              "bg-[var(--accent-base)] text-white",
              "hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]",
              "active:bg-[var(--accent-active)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Connecting…
              </>
            ) : (
              "Connect WhatsApp"
            )}
          </button>
          {!canConnect ? (
            <span className="text-body-sm text-[var(--text-tertiary)]">
              Only admins can connect channels.
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  disabled,
  error,
  required,
  help,
  placeholder,
  type = "text",
  mono,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
  required?: boolean;
  help?: string;
  placeholder?: string;
  type?: "text" | "password";
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
        {label}
        {required ? null : (
          <span className="ml-1 text-[var(--text-tertiary)]">(optional)</span>
        )}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        className={cn(
          "block h-10 w-full max-w-xl rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
          "transition-colors duration-150 ease-out",
          "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-[invalid=true]:border-[var(--danger)]",
          mono && "font-mono",
        )}
      />
      {help ? (
        <p className="mt-1.5 max-w-xl text-body-sm text-[var(--text-tertiary)]">
          {help}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function ConnectedSuccess({
  tenantSlug,
  webhookSecret,
}: {
  tenantSlug: string;
  webhookSecret: string;
}) {
  return (
    <div className="rounded-xl border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[var(--bg-surface)] p-8">
      <h2 className="text-h4 text-[var(--text-primary)]">
        WhatsApp connected
      </h2>
      <p className="mt-2 max-w-xl text-body-sm text-[var(--text-secondary)]">
        Copy this webhook secret into 360dialog&rsquo;s dashboard now —{" "}
        <span className="text-[var(--text-primary)]">
          we won&rsquo;t show it again
        </span>
        . If you lose it, rotate to mint a fresh one.
      </p>
      <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
        <code className="block break-all font-mono text-body-sm text-[var(--text-primary)]">
          {webhookSecret}
        </code>
      </div>
      <a
        href={`/${tenantSlug}/channels/whatsapp`}
        className="mt-5 inline-flex items-center text-body-sm font-medium text-[var(--accent-hover)] hover:underline"
      >
        Continue to channel setup →
      </a>
    </div>
  );
}
