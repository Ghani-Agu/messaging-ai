"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Key,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import {
  rotateWidgetKey,
  updateWidgetConfig,
} from "@/server/channels/widget/actions";
import {
  rotateWidgetKeyInitialState,
  updateWidgetConfigInitialState,
  type RotateWidgetKeyState,
  type UpdateWidgetConfigState,
} from "@/server/channels/widget/state";
import { cn } from "@/lib/utils";

type WidgetConfigCardProps = {
  tenantSlug: string;
  publicKey: string;
  displayName: string;
  themeAccent: string | undefined;
  originsAllowlist: string[];
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  canEditConfig: boolean;
  canRotateKey: boolean;
  appUrl: string;
};

const ORIGINS_PLACEHOLDER = "https://acme.com\nhttps://www.acme.com";

export function WidgetConfigCard(props: WidgetConfigCardProps) {
  return (
    <div className="space-y-8">
      <ConfigForm {...props} />
      <KeySection {...props} />
      <EmbedSnippet
        appUrl={props.appUrl}
        publicKey={props.publicKey}
        displayName={props.displayName}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Config form (displayName, themeAccent, origins)
// ─────────────────────────────────────────────────────────────────────────────

function ConfigForm({
  tenantSlug,
  displayName: initialDisplayName,
  themeAccent: initialThemeAccent,
  originsAllowlist,
  canEditConfig,
}: WidgetConfigCardProps) {
  const [state, formAction, pending] = useActionState<
    UpdateWidgetConfigState,
    FormData
  >(updateWidgetConfig, updateWidgetConfigInitialState);

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [themeAccent, setThemeAccent] = useState(initialThemeAccent ?? "");
  const [originsText, setOriginsText] = useState(originsAllowlist.join("\n"));
  const [showSaved, setShowSaved] = useState(false);

  // After a successful save the parent re-renders with the canonicalized
  // server values; mirror them into local state so the textarea shows
  // exactly what was stored (e.g. "https://Acme.com/" → "https://acme.com").
  useEffect(() => {
    if (state.status === "saved") {
      setDisplayName(initialDisplayName);
      setThemeAccent(initialThemeAccent ?? "");
      setOriginsText(originsAllowlist.join("\n"));
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state, initialDisplayName, initialThemeAccent, originsAllowlist]);

  const fieldErrors =
    state.status === "error" ? state.fieldErrors : undefined;
  const formMessage =
    state.status === "error" ? state.formMessage : undefined;

  // Per-line errors keyed by the original split index. Render below the
  // textarea as "Line N: ..." (visual highlighting inside the textarea is
  // Phase 9 polish).
  const originsErrors = fieldErrors?.originsByIndex
    ? Object.entries(fieldErrors.originsByIndex)
        .map(([k, v]) => ({ idx: Number(k), message: v }))
        .sort((a, b) => a.idx - b.idx)
    : [];

  const showEmptyOriginsWarning = useMemo(() => {
    return originsAllowlist.length === 0;
  }, [originsAllowlist]);

  return (
    <section
      aria-labelledby="widget-config-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <h2
        id="widget-config-heading"
        className="text-h4 text-[var(--text-primary)]"
      >
        Configuration
      </h2>
      <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
        Settings the widget reads when it loads on a host page.
      </p>

      <form action={formAction} className="mt-6 space-y-6" noValidate>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />

        <FieldDisplayName
          value={displayName}
          onChange={setDisplayName}
          disabled={!canEditConfig || pending}
          error={fieldErrors?.displayName}
        />

        <FieldThemeAccent
          value={themeAccent}
          onChange={setThemeAccent}
          disabled={!canEditConfig || pending}
          error={fieldErrors?.themeAccent}
        />

        <FieldOrigins
          value={originsText}
          onChange={setOriginsText}
          disabled={!canEditConfig || pending}
          perLineErrors={originsErrors}
          formMessage={formMessage}
          showEmptyWarning={showEmptyOriginsWarning}
        />

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canEditConfig || pending}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-4 text-body-sm font-medium",
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
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </button>
          {showSaved ? (
            <span className="inline-flex items-center gap-1 text-body-sm text-[var(--success)]">
              <Check className="size-4" />
              Saved
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

function FieldDisplayName({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
        Display name
      </span>
      <input
        type="text"
        name="displayName"
        required
        maxLength={80}
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
      <p className="mt-1.5 text-body-sm text-[var(--text-tertiary)]">
        Shown in the widget panel header on customer-facing pages.
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function FieldThemeAccent({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
        Theme accent <span className="text-[var(--text-tertiary)]">(optional)</span>
      </span>
      <input
        type="text"
        name="themeAccent"
        maxLength={64}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="#7C3AED"
        aria-invalid={error ? true : undefined}
        className={cn(
          "block h-10 w-full max-w-md rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
          "font-mono",
          "transition-colors duration-150 ease-out",
          "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
          "disabled:cursor-not-allowed disabled:opacity-60",
          "aria-[invalid=true]:border-[var(--danger)]",
        )}
      />
      <p className="mt-1.5 text-body-sm text-[var(--text-tertiary)]">
        Hex / hsl / oklch — overrides the widget&rsquo;s default violet on this
        tenant&rsquo;s embeds. Leave blank to use the platform default.
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-body-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function FieldOrigins({
  value,
  onChange,
  disabled,
  perLineErrors,
  formMessage,
  showEmptyWarning,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  perLineErrors: { idx: number; message: string }[];
  formMessage: string | undefined;
  showEmptyWarning: boolean;
}) {
  const hasErrors = perLineErrors.length > 0 || Boolean(formMessage);
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
          Allowed origins
        </span>
        <textarea
          name="originsText"
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={ORIGINS_PLACEHOLDER}
          aria-invalid={hasErrors ? true : undefined}
          className={cn(
            "block w-full max-w-2xl rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-body text-[var(--text-primary)]",
            "font-mono",
            "transition-colors duration-150 ease-out",
            "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "aria-[invalid=true]:border-[var(--danger)]",
          )}
        />
      </label>
      <p className="mt-1.5 max-w-2xl text-body-sm text-[var(--text-tertiary)]">
        One origin per line (or comma-separated). Origins are normalized on
        save: case-folded host, scheme included, no path. Default ports
        (443 / 80) are stripped.
      </p>

      {showEmptyWarning ? <EmptyOriginsWarning /> : null}

      {formMessage ? (
        <p
          role="alert"
          className="mt-2 max-w-2xl text-body-sm text-[var(--danger)]"
        >
          {formMessage}
        </p>
      ) : null}

      {perLineErrors.length > 0 ? (
        <ul
          role="alert"
          aria-label="Origin validation errors"
          className="mt-2 max-w-2xl space-y-1"
        >
          {perLineErrors.map((err) => (
            <li
              key={err.idx}
              className="text-body-sm text-[var(--danger)]"
            >
              Line {err.idx + 1}: {err.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyOriginsWarning() {
  return (
    <div
      role="status"
      className="mt-2 flex max-w-2xl items-start gap-3 rounded-lg border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-4 py-3"
    >
      <AlertTriangle
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
      />
      <p className="text-body-sm text-[var(--text-primary)]">
        <span className="font-medium">No origins set</span> — your widget can
        be embedded on any site. Add your domain(s) above to restrict access.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public key + rotate
// ─────────────────────────────────────────────────────────────────────────────

function KeySection({
  tenantSlug,
  publicKey,
  canRotateKey,
}: WidgetConfigCardProps) {
  const [state, formAction, pending] = useActionState<
    RotateWidgetKeyState,
    FormData
  >(rotateWidgetKey, rotateWidgetKeyInitialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      aria-labelledby="widget-key-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="widget-key-heading"
            className="text-h4 text-[var(--text-primary)]"
          >
            Public key
          </h2>
          <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
            Identifies this tenant on incoming widget requests. Safe to expose
            on the host page — origin allowlist + rate limits enforce access.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Key aria-hidden className="size-4 shrink-0 text-[var(--text-tertiary)]" />
        <code className="block rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-body-sm text-[var(--text-primary)]">
          {publicKey}
        </code>
      </div>

      <form action={formAction} className="mt-5 flex flex-wrap items-center gap-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        {confirming ? (
          <>
            <span className="text-body-sm text-[var(--text-secondary)]">
              Rotating breaks every embed snippet currently deployed.
            </span>
            <button
              type="submit"
              disabled={!canRotateKey || pending}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-4 text-body-sm font-medium",
                "border border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-[var(--danger)]",
                "hover:bg-[color-mix(in_oklab,var(--danger)_22%,transparent)]",
                "transition-colors duration-150 ease-out",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {pending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Rotating…
                </>
              ) : (
                "Confirm rotate"
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-default)] bg-transparent px-3 text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!canRotateKey}
              onClick={() => setConfirming(true)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-body-sm font-medium",
                "border-[var(--border-default)] bg-transparent text-[var(--text-primary)]",
                "transition-colors duration-150 ease-out",
                "hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)]",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <RefreshCcw className="size-3.5" />
              Rotate key
            </button>
            {!canRotateKey ? (
              <span className="text-body-sm text-[var(--text-tertiary)]">
                Only admins can rotate the key.
              </span>
            ) : null}
          </>
        )}
      </form>

      {state.status === "rotated" ? (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-1 text-body-sm text-[var(--success)]"
        >
          <Check className="size-4" />
          Key rotated — update your embed snippet.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-body-sm text-[var(--danger)]">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed snippet
// ─────────────────────────────────────────────────────────────────────────────

function EmbedSnippet({
  appUrl,
  publicKey,
  displayName,
}: {
  appUrl: string;
  publicKey: string;
  displayName: string;
}) {
  const snippet = buildSnippet({ appUrl, publicKey, displayName });
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Browsers without clipboard API in non-secure contexts — silently
      // ignore; the user can select the <code> block manually.
    }
  }

  return (
    <section
      aria-labelledby="widget-embed-heading"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="widget-embed-heading"
            className="text-h4 text-[var(--text-primary)]"
          >
            Embed snippet
          </h2>
          <p className="mt-1 max-w-xl text-body-sm text-[var(--text-secondary)]">
            Paste this just before <code className="font-mono">&lt;/body&gt;</code> on
            every page where the widget should appear.
          </p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-body-sm font-medium",
            "border-[var(--border-default)] bg-transparent text-[var(--text-primary)]",
            "transition-colors duration-150 ease-out",
            "hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)]",
          )}
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-[var(--success)]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 font-mono text-body-sm text-[var(--text-primary)]">
        <code>{snippet}</code>
      </pre>
    </section>
  );
}

function buildSnippet({
  appUrl,
  publicKey,
  displayName,
}: {
  appUrl: string;
  publicKey: string;
  displayName: string;
}): string {
  // The trailing slash on appUrl is variable; trim once so the resulting
  // src URL is always exactly one slash before "widget.js".
  const base = appUrl.replace(/\/+$/, "");
  // displayName goes into an HTML attribute; escape the four characters
  // that matter (and ampersand to be safe).
  const escapedName = displayName
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<script async src="${base}/widget.js"
        data-key="${publicKey}"
        data-name="${escapedName}"></script>`;
}
