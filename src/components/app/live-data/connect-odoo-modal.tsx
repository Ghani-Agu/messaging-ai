"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, ChevronDown, X } from "lucide-react";
import type { LiveDataSource } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  editOdooSourceAction,
  saveOdooSourceAction,
  testOdooConnectionAction,
} from "@/server/integrations/actions";
import { durationMedium, easeOutExpo } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Combined Connect / Edit modal for Odoo Live Data Sources.
 *
 * Modes:
 *   - "create" — empty form, default name, password required, save
 *     creates a new LiveDataSource (status = PENDING_TEST) and
 *     triggers an initial sync.
 *   - "edit"   — pre-populated from `editing` source's plaintext
 *     fields (NOT the password — that stays inside the encrypted
 *     blob; placeholder reads "Leave blank to keep existing"). Save
 *     PATCHes the source's encryptedConfig.
 *
 * The "Test connection" button calls testOdooConnectionAction which
 * does NOT persist anything — it's a pre-save sanity check that
 * authenticates against Odoo and returns a sample product + total
 * count for confidence.
 */

type Mode = { kind: "create" } | { kind: "edit"; source: LiveDataSource };

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; sampleProduct: { id: number; name: string }; productCount: number }
  | { kind: "error"; message: string };

export function ConnectOdooModal({
  tenantSlug,
  mode,
  open,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  mode: Mode;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [brandField, setBrandField] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset / repopulate when the modal opens.
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setTestResult({ kind: "idle" });
    if (mode.kind === "create") {
      setName("Production Odoo");
      setUrl("");
      setDatabase("");
      setUsername("");
      setPassword("");
      setBrandField("");
      setAdvancedOpen(false);
    } else {
      // Edit: pre-fill name only. The other fields (url/database/
      // username/brandField) live inside the encrypted blob — to keep
      // them populated we'd have to expose them via a Server Action,
      // which is fine but for v1 we let the operator re-enter only
      // what they want to change. Password stays blank with the
      // "leave blank to keep" placeholder semantics.
      setName(mode.source.name);
      setUrl("");
      setDatabase("");
      setUsername("");
      setPassword("");
      setBrandField("");
      setAdvancedOpen(false);
    }
  }, [open, mode]);

  const isEdit = mode.kind === "edit";

  const handleTest = () => {
    if (!url || !database || !username || !password) {
      setTestResult({
        kind: "error",
        message: "Fill URL, database, username, and password to test.",
      });
      return;
    }
    setTestResult({ kind: "testing" });
    startTransition(async () => {
      try {
        const result = await testOdooConnectionAction({
          tenantSlug,
          url,
          database,
          username,
          password,
          brandField: brandField || undefined,
        });
        if (result.ok) {
          setTestResult({
            kind: "ok",
            sampleProduct: result.sampleProduct,
            productCount: result.productCount,
          });
        } else {
          setTestResult({ kind: "error", message: result.error });
        }
      } catch (err) {
        setTestResult({
          kind: "error",
          message: err instanceof Error ? err.message : "Test failed",
        });
      }
    });
  };

  const handleSave = () => {
    setSubmitError(null);
    if (mode.kind === "create") {
      if (!name || !url || !database || !username || !password) {
        setSubmitError(
          "Fill name, URL, database, username, and password to save.",
        );
        return;
      }
      startTransition(async () => {
        try {
          await saveOdooSourceAction({
            tenantSlug,
            name,
            url,
            database,
            username,
            password,
            brandField: brandField || undefined,
          });
          onSaved();
        } catch (err) {
          setSubmitError(err instanceof Error ? err.message : "Save failed");
        }
      });
    } else {
      // Edit: only send fields the operator changed. Empty strings on
      // url/db/username/password mean "keep existing" — see the
      // editOdooSourceAction behavior. brandField empty means "clear."
      startTransition(async () => {
        try {
          await editOdooSourceAction({
            tenantSlug,
            sourceId: mode.source.id,
            name: name !== mode.source.name ? name : undefined,
            url: url || undefined,
            database: database || undefined,
            username: username || undefined,
            password: password || undefined,
            // We deliberately don't send brandField at all on edit
            // unless the operator opened the advanced section AND
            // typed a value — distinguishing "didn't touch" from
            // "wants to clear" via the advancedOpen flag would be
            // a footgun. v1 ships with: edit modal does not change
            // brandField; operator must disconnect + reconnect to
            // change it. (If this becomes a real ask, lift to a
            // dedicated control.)
          });
          onSaved();
        } catch (err) {
          setSubmitError(err instanceof Error ? err.message : "Save failed");
        }
      });
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="odoo-modal-title"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { duration: durationMedium, ease: easeOutExpo }
        }
        className="w-full max-w-xl"
      >
        <Card className="p-0">
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <div>
              <h3
                id="odoo-modal-title"
                className="text-h4 text-[var(--text-primary)]"
              >
                {isEdit ? "Edit Odoo connection" : "Connect Odoo"}
              </h3>
              <p className="text-body-sm text-[var(--text-secondary)]">
                {isEdit
                  ? "Leave fields blank to keep their current values."
                  : "Test the credentials before saving — we authenticate against your Odoo instance and confirm we can read products."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
              disabled={pending}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <FieldRow id="odoo-name" label="Name">
              <input
                id="odoo-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production Odoo"
                className={inputClass}
              />
            </FieldRow>
            <FieldRow id="odoo-url" label="URL">
              <input
                id="odoo-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={isEdit ? "Keep existing" : "https://example.odoo.com"}
                className={inputClass}
              />
            </FieldRow>
            <FieldRow id="odoo-database" label="Database">
              <input
                id="odoo-database"
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder={isEdit ? "Keep existing" : "company-name"}
                className={inputClass}
              />
            </FieldRow>
            <FieldRow id="odoo-username" label="Username">
              <input
                id="odoo-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={
                  isEdit ? "Keep existing" : "user@example.com"
                }
                autoComplete="username"
                className={inputClass}
              />
            </FieldRow>
            <FieldRow id="odoo-password" label="Password">
              <input
                id="odoo-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isEdit ? "Leave blank to keep existing" : "••••••••"
                }
                autoComplete="new-password"
                className={inputClass}
              />
            </FieldRow>

            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
              )}
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-150",
                  advancedOpen && "rotate-180",
                )}
                aria-hidden
              />
              Advanced
            </button>
            {advancedOpen ? (
              <FieldRow
                id="odoo-brand-field"
                label="Brand custom field"
                help="Many2one column on product.template that holds the brand. Tayssir-wrapped Odoo: marque_id. Stock Odoo with the brand module: brand_id."
              >
                <input
                  id="odoo-brand-field"
                  type="text"
                  value={brandField}
                  onChange={(e) => setBrandField(e.target.value)}
                  placeholder="marque_id"
                  className={inputClass}
                />
              </FieldRow>
            ) : null}
          </div>

          <TestResultDisplay result={testResult} />

          {submitError ? (
            <div
              role="alert"
              className={cn(
                "border-t px-5 py-3 text-body-sm",
                "border-[color-mix(in_oklab,var(--danger)_20%,transparent)]",
                "bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]",
                "text-[var(--text-primary)]",
              )}
            >
              {submitError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={pending}
            >
              Test connection
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={pending}
            >
              {isEdit ? "Save" : "Save and sync now"}
            </Button>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

const inputClass = cn(
  "w-full rounded-md border bg-[var(--bg-base)] px-3 py-1.5 text-body-sm text-[var(--text-primary)]",
  "border-[var(--border-subtle)]",
  "placeholder:text-[var(--text-tertiary)]",
  "focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
);

function FieldRow({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block">
        <Eyebrow>{label}</Eyebrow>
      </label>
      {children}
      {help ? (
        <p className="mt-1 text-caption text-[var(--text-tertiary)]">{help}</p>
      ) : null}
    </div>
  );
}

function TestResultDisplay({ result }: { result: TestResult }) {
  if (result.kind === "idle") return null;
  if (result.kind === "testing") {
    return (
      <div
        className={cn(
          "border-t px-5 py-3 text-body-sm",
          "border-[var(--border-subtle)]",
          "bg-[var(--bg-surface-elevated)]",
          "text-[var(--text-secondary)]",
        )}
      >
        Authenticating against Odoo…
      </div>
    );
  }
  if (result.kind === "ok") {
    return (
      <div
        role="status"
        className={cn(
          "flex items-start gap-2 border-t px-5 py-3 text-body-sm",
          "border-[color-mix(in_oklab,var(--success)_25%,transparent)]",
          "bg-[color-mix(in_oklab,var(--success)_10%,transparent)]",
          "text-[var(--text-primary)]",
        )}
      >
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
          aria-hidden
        />
        <div>
          <p className="font-medium">Connected.</p>
          <p className="text-[var(--text-secondary)]">
            Found product: <span className="text-[var(--text-primary)]">{result.sampleProduct.name}</span>
            {". "}Total: {result.productCount.toLocaleString()} products.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        "border-t px-5 py-3 text-body-sm",
        "border-[color-mix(in_oklab,var(--danger)_25%,transparent)]",
        "bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]",
        "text-[var(--text-primary)]",
      )}
    >
      <p className="font-medium">Connection failed.</p>
      <p className="break-words font-mono text-caption text-[var(--text-secondary)]">
        {result.message}
      </p>
    </div>
  );
}
