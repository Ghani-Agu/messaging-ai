"use client";

import { useState } from "react";
import { Loader2, Plus, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { qnaPairInputSchema, type QnaPairInput } from "@/lib/qna";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/validators";
import type { QnaPair } from "@prisma/client";

/**
 * Q&A create / edit form (Phase 8e).
 *
 * Single-form for both flows — `initial=null` means create, `initial=row`
 * means edit. Submits to a parent-supplied callback; the parent owns the
 * Server Action call and post-success refresh.
 */

const LANG_LABELS: Record<SupportedLanguage, string> = {
  ar: "Arabic (MSA)",
  fr: "French",
  en: "English",
  darija: "Darija",
};

type FormState = {
  question: string;
  answer: string;
  language: SupportedLanguage | "";
  languageLock: boolean;
  tags: string[];
  tagInput: string;
  sourceUrl: string;
};

function initialFromRow(
  row: QnaPair | null,
  initialQuestion?: string,
): FormState {
  if (!row) {
    return {
      question: initialQuestion ?? "",
      answer: "",
      language: "",
      languageLock: false,
      tags: [],
      tagInput: "",
      sourceUrl: "",
    };
  }
  return {
    question: row.question,
    answer: row.answer,
    language:
      row.language && (SUPPORTED_LANGUAGES as readonly string[]).includes(row.language)
        ? (row.language as SupportedLanguage)
        : "",
    languageLock: row.languageLock,
    tags: row.tags,
    tagInput: "",
    sourceUrl: row.sourceUrl ?? "",
  };
}

function toInput(s: FormState): QnaPairInput {
  const raw = {
    question: s.question.trim(),
    answer: s.answer.trim(),
    language: s.language === "" ? undefined : s.language,
    languageLock: s.languageLock,
    tags: s.tags,
    sourceUrl: s.sourceUrl.trim() || undefined,
  };
  return qnaPairInputSchema.parse(raw);
}

export function QnaForm({
  initial,
  initialQuestion,
  onSubmit,
  onCancel,
}: {
  initial: QnaPair | null;
  /**
   * Pre-fill the question field when creating a new Q&A. Used by the
   * "Create Q&A from gap" CTA in the knowledge-gaps digest, which seeds
   * the form with the gap's representative question.
   */
  initialQuestion?: string;
  onSubmit: (input: QnaPairInput) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [s, setS] = useState<FormState>(initialFromRow(initial, initialQuestion));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = initial !== null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  function addTag() {
    const t = s.tagInput.trim();
    if (!t) return;
    if (s.tags.includes(t)) {
      setS((prev) => ({ ...prev, tagInput: "" }));
      return;
    }
    if (s.tags.length >= 10) return; // schema cap
    setS((prev) => ({
      ...prev,
      tags: [...prev.tags, t],
      tagInput: "",
    }));
  }

  function removeTag(t: string) {
    setS((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== t) }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    let parsed: QnaPairInput;
    try {
      parsed = toInput(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid input";
      const issue = (() => {
        try {
          return JSON.parse(msg)?.[0]?.message;
        } catch {
          return undefined;
        }
      })();
      setError(typeof issue === "string" ? issue : msg);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-6" noValidate>
      <header className="space-y-1">
        <h2 className="text-h3 text-[var(--text-primary)]">
          {isEdit ? "Edit Q&A pair" : "New Q&A pair"}
        </h2>
        <p className="text-body-sm text-[var(--text-secondary)]">
          The AI uses the answer near-verbatim when a customer&apos;s question
          matches yours above the similarity threshold. Question embedding
          regenerates automatically on save.
        </p>
      </header>

      <Field label="Question" required>
        <Textarea
          value={s.question}
          onChange={(v) => update("question", v)}
          placeholder="What are your shipping times?"
          maxLength={500}
          rows={2}
          required
        />
      </Field>

      <Field
        label="Answer"
        hint="Used near-verbatim by the AI. Can include line breaks."
        required
      >
        <Textarea
          value={s.answer}
          onChange={(v) => update("answer", v)}
          placeholder="We ship in 2–3 business days within Algeria, 5–7 days for international orders."
          maxLength={4000}
          rows={5}
          required
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Language"
          hint="Author hint. The brain still detects per-message; this matters when language-lock is on."
        >
          <Select
            value={s.language}
            onChange={(v) =>
              update("language", v as SupportedLanguage | "")
            }
          >
            <option value="">Any (cross-language match)</option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Language lock"
          hint="When on, this Q&A only matches queries detected to be in the selected language. Default off — most tenants want cross-language reuse."
        >
          <label className="inline-flex h-10 items-center gap-2 text-body-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={s.languageLock}
              onChange={(e) => update("languageLock", e.target.checked)}
              disabled={!s.language}
              className="size-4 accent-[var(--accent-base)]"
            />
            Restrict to {s.language ? LANG_LABELS[s.language] : "selected language"}
          </label>
        </Field>
      </div>

      <Field label="Tags" hint="Up to 10. Press Enter to add.">
        <div className="space-y-2">
          {s.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {s.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] px-2 py-0.5 text-caption text-[var(--text-secondary)]"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    aria-label={`Remove ${t}`}
                    className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                  >
                    <XIcon className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Input
              value={s.tagInput}
              onChange={(v) => update("tagInput", v)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="shipping"
              maxLength={40}
              disabled={s.tags.length >= 10}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addTag}
              disabled={!s.tagInput.trim() || s.tags.length >= 10}
            >
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </div>
      </Field>

      <Field label="Source URL" hint="Optional — where the canonical answer came from.">
        <Input
          value={s.sourceUrl}
          onChange={(v) => update("sourceUrl", v)}
          placeholder="https://example.com/shipping-policy"
          maxLength={2048}
          mono
        />
      </Field>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-body-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving…
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create Q&A"
          )}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny form primitives
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-body-sm font-medium text-[var(--text-primary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </span>
      {hint ? (
        <span className="block text-body-sm text-[var(--text-tertiary)]">{hint}</span>
      ) : null}
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  mono,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      type="text"
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "placeholder:text-[var(--text-tertiary)]",
        mono && "font-mono text-body-sm",
        className,
      )}
    />
  );
}

function Textarea({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  return (
    <textarea
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
        "placeholder:text-[var(--text-tertiary)]",
        className,
      )}
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "block h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-3 text-body text-[var(--text-primary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-strong)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-base)]/30",
      )}
    >
      {children}
    </select>
  );
}
