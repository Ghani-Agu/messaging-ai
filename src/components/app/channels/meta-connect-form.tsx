"use client";

import { useActionState, useState } from "react";
import { Facebook, Instagram, Loader2, MessageCircle } from "lucide-react";
import {
  confirmFacebookPage,
  previewFacebookPage,
} from "@/server/channels/meta/actions";
import {
  confirmMetaConnectInitialState,
  previewMetaConnectInitialState,
  type ConfirmMetaConnectState,
  type PreviewMetaConnectState,
} from "@/server/channels/meta/state";
import { cn } from "@/lib/utils";

/**
 * Two-step Meta connect form. Phase 1 (preview) validates the operator's
 * Page Access Token + fetches Page details without writing rows; Phase 2
 * (confirm) re-validates and creates the MESSENGER and/or INSTAGRAM
 * Channel rows.
 *
 * The same component drives both /channels/messenger and /channels/
 * instagram entry points — Gate 1 H2 calls for two detail pages but a
 * shared connect surface, since one Page Access Token grants access to
 * both products. The `entryPlatform` prop controls which platform's
 * checkbox starts checked + which icon greets the operator; both
 * checkboxes are still presented (when IG is available) so the operator
 * can land both with one paste.
 *
 * IG checkbox is hidden entirely when `igAvailable` is false on the
 * preview result — explicit Gate 1 carry-over from the Phase 7 prompt:
 * a disabled "Connect Instagram" checkbox confuses operators.
 */
export function MetaConnectForm({
  tenantSlug,
  canConnect,
  entryPlatform,
}: {
  tenantSlug: string;
  canConnect: boolean;
  entryPlatform: "messenger" | "instagram";
}) {
  const [previewState, previewAction, previewPending] = useActionState<
    PreviewMetaConnectState,
    FormData
  >(previewFacebookPage, previewMetaConnectInitialState);

  if (previewState.status === "preview") {
    return (
      <ConfirmStep
        tenantSlug={tenantSlug}
        canConnect={canConnect}
        entryPlatform={entryPlatform}
        preview={previewState}
      />
    );
  }

  return (
    <PreviewStep
      tenantSlug={tenantSlug}
      canConnect={canConnect}
      entryPlatform={entryPlatform}
      action={previewAction}
      pending={previewPending}
      state={previewState}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — paste token
// ─────────────────────────────────────────────────────────────────────────────

function PreviewStep({
  tenantSlug,
  canConnect,
  entryPlatform,
  action,
  pending,
  state,
}: {
  tenantSlug: string;
  canConnect: boolean;
  entryPlatform: "messenger" | "instagram";
  action: (formData: FormData) => void;
  pending: boolean;
  state: PreviewMetaConnectState;
}) {
  const [token, setToken] = useState("");
  const Icon = entryPlatform === "messenger" ? MessageCircle : Instagram;
  const platformLabel =
    entryPlatform === "messenger" ? "Messenger" : "Instagram";
  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const formMessage =
    state.status === "error" ? state.formMessage : undefined;

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
          <Icon className="size-6" />
        </div>
        <div>
          <h2 className="text-h4 text-[var(--text-primary)]">
            Connect {platformLabel} via your Facebook Page
          </h2>
          <p className="text-body-sm text-[var(--text-secondary)]">
            Paste the Page Access Token from your Meta App. We&rsquo;ll
            preview the Page details — you confirm before any rows are
            written.
          </p>
        </div>
      </div>

      <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <label className="block">
          <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
            Page Access Token
          </span>
          <textarea
            name="token"
            required
            rows={3}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={!canConnect || pending}
            aria-invalid={fieldErrors?.token ? true : undefined}
            autoComplete="off"
            className={cn(
              "block w-full max-w-xl rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 font-mono text-body-sm text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "aria-[invalid=true]:border-[var(--danger)]",
            )}
          />
          <p className="mt-1.5 max-w-xl text-body-sm text-[var(--text-tertiary)]">
            Long-lived (60d) Page Access Token. Encrypted at rest with
            AES-256-GCM. Used as the bearer for Graph API calls; the
            same token authorizes both Messenger and Instagram on the
            linked Page.
          </p>
          {fieldErrors?.token ? (
            <p
              role="alert"
              className="mt-1.5 text-body-sm text-[var(--danger)]"
            >
              {fieldErrors.token}
            </p>
          ) : null}
        </label>

        {formMessage ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {formMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canConnect || pending || token.trim().length === 0}
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
                Validating…
              </>
            ) : (
              "Preview Page details"
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — review preview, choose channels, confirm
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmStep({
  tenantSlug,
  canConnect,
  entryPlatform,
  preview,
}: {
  tenantSlug: string;
  canConnect: boolean;
  entryPlatform: "messenger" | "instagram";
  preview: Extract<PreviewMetaConnectState, { status: "preview" }>;
}) {
  const [confirmState, confirmAction, confirmPending] = useActionState<
    ConfirmMetaConnectState,
    FormData
  >(confirmFacebookPage, confirmMetaConnectInitialState);

  // Default both checkboxes on whenever the surface is available — one
  // Page Access Token usually means the operator wants both products
  // wired, and Gate 1 H2 explicitly notes the connect form is shared.
  // The entryPlatform prop only controls which icon greets them; it
  // doesn't gate the other checkbox.
  void entryPlatform;
  const [connectMessenger, setConnectMessenger] = useState<boolean>(true);
  const [connectInstagram, setConnectInstagram] = useState<boolean>(
    preview.igAvailable,
  );

  // Token has to be re-pasted on confirm — by design, per Gate 1 H8 (no
  // caching across the boundary). The form re-submits the token along
  // with the preview output, then the server re-validates it.
  const [confirmToken, setConfirmToken] = useState("");

  if (confirmState.status === "connected") {
    return (
      <ConnectedSuccess
        tenantSlug={tenantSlug}
        messengerChannelId={confirmState.messengerChannelId}
        instagramChannelId={confirmState.instagramChannelId}
      />
    );
  }

  const fieldErrors =
    confirmState.status === "error" ? confirmState.fieldErrors : undefined;
  const formMessage =
    confirmState.status === "error" ? confirmState.formMessage : undefined;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
      <div className="mb-6 flex items-center gap-3">
        <div
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--success) 15%, transparent)",
            color: "var(--success)",
          }}
        >
          <Facebook className="size-6" />
        </div>
        <div>
          <h2 className="text-h4 text-[var(--text-primary)]">
            Confirm: {preview.pageName}
          </h2>
          <p className="text-body-sm text-[var(--text-secondary)]">
            Token validated. Choose which surfaces to enable for this
            Page. Re-paste the token to confirm — we don&rsquo;t cache it
            between steps.
          </p>
        </div>
      </div>

      <dl className="mb-6 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-body-sm">
        <Row label="Page name" value={preview.pageName} />
        <Row label="Page id" value={preview.pageId} mono />
        {preview.igAvailable ? (
          <>
            <Row
              label="Instagram"
              value={
                preview.igUsername
                  ? `@${preview.igUsername}`
                  : "(linked, no @username)"
              }
            />
            {preview.igUserId ? (
              <Row label="IG user id" value={preview.igUserId} mono />
            ) : null}
          </>
        ) : (
          <p className="text-body-sm text-[var(--text-tertiary)]">
            No Instagram Business Account linked to this Page. Only
            Messenger is available to connect.
          </p>
        )}
      </dl>

      <form action={confirmAction} className="space-y-5" noValidate>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="pageId" value={preview.pageId} />
        <input type="hidden" name="pageName" value={preview.pageName} />
        {preview.igUserId ? (
          <input type="hidden" name="igUserId" value={preview.igUserId} />
        ) : null}
        {preview.igUsername ? (
          <input type="hidden" name="igUsername" value={preview.igUsername} />
        ) : null}

        <fieldset className="space-y-3">
          <legend className="mb-1 text-body-sm text-[var(--text-secondary)]">
            Connect channels
          </legend>
          <Checkbox
            name="connectMessenger"
            checked={connectMessenger}
            onChange={setConnectMessenger}
            disabled={!canConnect || confirmPending}
            label="Messenger DMs"
            description="Inbound + outbound free-form messages on the Page within the 24h customer-service window."
            error={fieldErrors?.messenger}
          />
          {preview.igAvailable ? (
            <Checkbox
              name="connectInstagram"
              checked={connectInstagram}
              onChange={setConnectInstagram}
              disabled={!canConnect || confirmPending}
              label={`Instagram DMs${preview.igUsername ? ` (@${preview.igUsername})` : ""}`}
              description="Inbound + outbound on the linked IG Business account. Same 24h window."
              error={fieldErrors?.instagram}
            />
          ) : null}
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
            Re-paste the Page Access Token
          </span>
          <textarea
            name="token"
            required
            rows={3}
            value={confirmToken}
            onChange={(e) => setConfirmToken(e.target.value)}
            disabled={!canConnect || confirmPending}
            aria-invalid={fieldErrors?.token ? true : undefined}
            autoComplete="off"
            className={cn(
              "block w-full max-w-xl rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 font-mono text-body-sm text-[var(--text-primary)]",
              "transition-colors duration-150 ease-out",
              "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "aria-[invalid=true]:border-[var(--danger)]",
            )}
          />
          <p className="mt-1.5 max-w-xl text-body-sm text-[var(--text-tertiary)]">
            We re-validate the token here so a token rotated between
            preview and confirm fails loud. The pasted value is encrypted
            at rest immediately on success.
          </p>
          {fieldErrors?.token ? (
            <p
              role="alert"
              className="mt-1.5 text-body-sm text-[var(--danger)]"
            >
              {fieldErrors.token}
            </p>
          ) : null}
        </label>

        {formMessage ? (
          <p role="alert" className="text-body-sm text-[var(--danger)]">
            {formMessage}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={
              !canConnect ||
              confirmPending ||
              confirmToken.trim().length === 0 ||
              (!connectMessenger && !connectInstagram)
            }
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
            {confirmPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Connecting…
              </>
            ) : (
              "Confirm and connect"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-[8rem] text-[var(--text-secondary)]">{label}</dt>
      <dd
        className={cn(
          "text-[var(--text-primary)]",
          mono && "font-mono text-body-sm",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Checkbox({
  name,
  checked,
  onChange,
  disabled,
  label,
  description,
  error,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  label: string;
  description: string;
  error?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 size-4 rounded border-[var(--border-default)] bg-transparent text-[var(--accent-base)] focus:ring-2 focus:ring-[var(--accent-base)]/30"
      />
      <div className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
        <p className="mt-0.5 text-body-sm text-[var(--text-tertiary)]">
          {description}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-body-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </label>
  );
}

function ConnectedSuccess({
  tenantSlug,
  messengerChannelId,
  instagramChannelId,
}: {
  tenantSlug: string;
  messengerChannelId?: string;
  instagramChannelId?: string;
}) {
  return (
    <div className="rounded-xl border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[var(--bg-surface)] p-8">
      <h2 className="text-h4 text-[var(--text-primary)]">Connected</h2>
      <p className="mt-2 max-w-xl text-body-sm text-[var(--text-secondary)]">
        {messengerChannelId && instagramChannelId
          ? "Messenger and Instagram are now wired to this workspace. Don't forget to register the webhook URL in your Meta App dashboard."
          : messengerChannelId
            ? "Messenger is now connected. Don't forget to register the webhook URL in your Meta App dashboard."
            : "Instagram is now connected. Don't forget to register the webhook URL in your Meta App dashboard."}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {messengerChannelId ? (
          <a
            href={`/${tenantSlug}/channels/messenger`}
            className="inline-flex items-center text-body-sm font-medium text-[var(--accent-hover)] hover:underline"
          >
            Configure Messenger →
          </a>
        ) : null}
        {instagramChannelId ? (
          <a
            href={`/${tenantSlug}/channels/instagram`}
            className="inline-flex items-center text-body-sm font-medium text-[var(--accent-hover)] hover:underline"
          >
            Configure Instagram →
          </a>
        ) : null}
      </div>
    </div>
  );
}
