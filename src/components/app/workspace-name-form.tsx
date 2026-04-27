"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  updateTenantNameAction,
  updateTenantInitialState,
  type UpdateTenantState,
} from "@/server/tenancy/actions";
import { cn } from "@/lib/utils";

export function WorkspaceNameForm({
  tenantSlug,
  initialName,
  canEdit,
}: {
  tenantSlug: string;
  initialName: string;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<UpdateTenantState, FormData>(
    updateTenantNameAction,
    updateTenantInitialState,
  );
  const [name, setName] = useState(initialName);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (state.status === "saved") {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const error = state.status === "error" ? state.message : null;

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <label className="block">
        <span className="mb-1.5 block text-body-sm text-[var(--text-secondary)]">
          Workspace name
        </span>
        <input
          type="text"
          name="name"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit || pending}
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
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canEdit || pending || name.trim() === initialName}
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
        {!canEdit ? (
          <span className="text-body-sm text-[var(--text-tertiary)]">
            Only owners and admins can edit settings.
          </span>
        ) : null}
      </div>
    </form>
  );
}
