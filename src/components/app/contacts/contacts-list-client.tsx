"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { contactInputSchema, type ContactSummary } from "@/lib/contacts";
import {
  createContactAction,
  deleteContactAction,
  updateContactAction,
} from "@/server/contacts/actions";

/**
 * Contacts admin surface. Replaces the Phase-9 Billing placeholder.
 *
 * Operators (OWNER role) curate phone / email entries the AI suggests
 * when escalating to a human. Read floor is VIEWER so non-owner team
 * members see what's configured; mutating actions enforce OWNER
 * server-side.
 *
 * Minimal shape: one card-list with an add-button in the page header,
 * an inline modal for add/edit, and a confirmation modal for delete.
 * No search / filter / pagination — operators curate a small handful
 * per workspace (cap MAX_CONTACTS_IN_PROMPT = 6 hits the brain).
 */

type Status =
  | { kind: "idle" }
  | { kind: "pending"; what: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function ContactsListClient({
  tenantSlug,
  initialContacts,
  canEdit,
}: {
  tenantSlug: string;
  initialContacts: ContactSummary[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactSummary[]>(initialContacts);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  // editing === undefined → modal closed
  // editing === null      → add new
  // editing === row       → edit existing
  const [editing, setEditing] = useState<ContactSummary | null | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState<ContactSummary | null>(
    null,
  );

  // Re-sync from server when revalidatePath fires after a mutation.
  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const refresh = () => {
    startTransition(() => router.refresh());
  };

  const handleSave = async (input: ContactFormState) => {
    setStatus({ kind: "pending", what: editing ? "Saving…" : "Adding…" });
    try {
      const parsed = contactInputSchema.parse({
        name: input.name,
        phone: input.phone || undefined,
        email: input.email || undefined,
        role: input.role || undefined,
        position: input.position,
      });
      if (editing) {
        await updateContactAction({
          tenantSlug,
          contactId: editing.id,
          input: parsed,
        });
        setStatus({ kind: "ok", message: `Updated ${parsed.name}` });
      } else {
        await createContactAction({ tenantSlug, input: parsed });
        setStatus({ kind: "ok", message: `Added ${parsed.name}` });
      }
      setEditing(undefined);
      refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  };

  const handleDelete = async (row: ContactSummary) => {
    setStatus({ kind: "pending", what: "Deleting…" });
    try {
      await deleteContactAction({ tenantSlug, contactId: row.id });
      setStatus({ kind: "ok", message: `Removed ${row.name}` });
      setConfirmingDelete(null);
      refresh();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Delete failed",
      });
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Contacts"
        description="Phone numbers and emails the AI suggests when escalating to a human. Customers see these when the AI can't answer their question."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              Add contact
            </Button>
          ) : null
        }
      />

      {status.kind === "ok" ? (
        <StatusBanner tone="ok" message={status.message} onDismiss={() => setStatus({ kind: "idle" })} />
      ) : status.kind === "error" ? (
        <StatusBanner tone="error" message={status.message} onDismiss={() => setStatus({ kind: "idle" })} />
      ) : null}

      {contacts.length === 0 ? (
        <EmptyState canEdit={canEdit} onAdd={() => setEditing(null)} />
      ) : (
        <div className="space-y-3">
          {contacts.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              canEdit={canEdit}
              onEdit={() => setEditing(c)}
              onDelete={() => setConfirmingDelete(c)}
            />
          ))}
        </div>
      )}

      {editing !== undefined ? (
        <Modal onClose={() => setEditing(undefined)}>
          <ContactForm
            initial={editing}
            onCancel={() => setEditing(undefined)}
            onSubmit={handleSave}
            pending={status.kind === "pending"}
          />
        </Modal>
      ) : null}

      {confirmingDelete ? (
        <Modal onClose={() => setConfirmingDelete(null)}>
          <div className="p-6">
            <h2 className="text-h3 text-[var(--text-primary)]">
              Delete {confirmingDelete.name}?
            </h2>
            <p className="mt-2 text-body-sm text-[var(--text-secondary)]">
              Customers will no longer see this contact when the AI escalates.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmingDelete(null)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(confirmingDelete)}
                disabled={status.kind === "pending"}
              >
                {status.kind === "pending" ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + empty state
// ─────────────────────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  canEdit,
  onEdit,
  onDelete,
}: {
  contact: ContactSummary;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-medium text-[var(--text-primary)]">
            {contact.name}
          </h3>
          {contact.role ? <Badge variant="default" size="sm">{contact.role}</Badge> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-[var(--text-secondary)]">
          {contact.phone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="size-3.5 text-[var(--text-tertiary)]" aria-hidden />
              <a href={`tel:${contact.phone}`} className="hover:text-[var(--accent-hover)]">
                {contact.phone}
              </a>
            </span>
          ) : null}
          {contact.email ? (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="size-3.5 text-[var(--text-tertiary)]" aria-hidden />
              <a href={`mailto:${contact.email}`} className="hover:text-[var(--accent-hover)]">
                {contact.email}
              </a>
            </span>
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 />
            Delete
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({
  canEdit,
  onAdd,
}: {
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-10 text-center">
      <p className="text-body text-[var(--text-secondary)]">No contacts yet.</p>
      <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
        Add one so the AI has someone to refer customers to on escalation.
      </p>
      {canEdit ? (
        <Button className="mt-4" onClick={onAdd}>
          <Plus />
          Add contact
        </Button>
      ) : null}
    </div>
  );
}

function StatusBanner({
  tone,
  message,
  onDismiss,
}: {
  tone: "ok" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-body-sm",
        tone === "ok"
          ? "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]"
          : "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]",
      )}
      role="status"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-0.5 hover:bg-[var(--bg-surface-overlay)]"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal + form
// ─────────────────────────────────────────────────────────────────────────────

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Close on Esc — mirrors the Items modal so behaviour is consistent
  // across the app's admin surfaces.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="custom-scrollbar fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]"
        >
          <X className="size-4" aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}

type ContactFormState = {
  name: string;
  phone: string;
  email: string;
  role: string;
  position: number;
};

function ContactForm({
  initial,
  onCancel,
  onSubmit,
  pending,
}: {
  initial: ContactSummary | null;
  onCancel: () => void;
  onSubmit: (input: ContactFormState) => void;
  pending: boolean;
}) {
  const [state, setState] = useState<ContactFormState>({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    role: initial?.role ?? "",
    position: initial?.position ?? 0,
  });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!state.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!state.phone.trim() && !state.email.trim()) {
      setError("Provide at least a phone number or an email address");
      return;
    }
    onSubmit(state);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <h2 className="text-h3 text-[var(--text-primary)]">
        {initial ? "Edit contact" : "Add contact"}
      </h2>
      <div className="mt-6 space-y-4">
        <FormField label="Name" required>
          <input
            type="text"
            value={state.name}
            onChange={(e) => setState({ ...state, name: e.target.value })}
            placeholder="Sales team / Mohamed Karim"
            className={INPUT_CLASS}
            autoFocus
          />
        </FormField>
        <FormField
          label="Role"
          hint="Optional. Free text — Sales / Support / Returns / etc."
        >
          <input
            type="text"
            value={state.role}
            onChange={(e) => setState({ ...state, role: e.target.value })}
            placeholder="Sales"
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Phone" hint="Provide phone, email, or both.">
          <input
            type="text"
            value={state.phone}
            onChange={(e) => setState({ ...state, phone: e.target.value })}
            placeholder="0559 533 698"
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Email">
          <input
            type="email"
            value={state.email}
            onChange={(e) => setState({ ...state, email: e.target.value })}
            placeholder="commercial@example.test"
            className={INPUT_CLASS}
          />
        </FormField>
        <FormField label="Order" hint="Lower numbers appear first. Default 0.">
          <input
            type="number"
            min={0}
            max={9999}
            value={state.position}
            onChange={(e) =>
              setState({ ...state, position: Number(e.target.value) || 0 })
            }
            className={cn(INPUT_CLASS, "max-w-[120px]")}
          />
        </FormField>
      </div>
      {error ? (
        <p
          className="mt-4 text-body-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}

const INPUT_CLASS =
  "block w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-base)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-base)]";

function FormField({
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
    <div>
      <label className="block text-body-sm font-medium text-[var(--text-primary)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--danger)]">*</span> : null}
      </label>
      {hint ? (
        <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">{hint}</p>
      ) : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}
