"use client";

import { useActionState } from "react";
import { Loader2, Plug } from "lucide-react";
import { enableWidgetChannel } from "@/server/channels/widget/actions";
import {
  enableWidgetChannelInitialState,
  type EnableWidgetChannelState,
} from "@/server/channels/widget/state";
import { cn } from "@/lib/utils";

/**
 * One-click enable button on the widget detail page when no row exists yet.
 * Mints the publicKey and creates the Channel; the page re-renders to the
 * configured state via revalidatePath.
 */
export function EnableWidgetForm({
  tenantSlug,
  canEnable,
}: {
  tenantSlug: string;
  canEnable: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    EnableWidgetChannelState,
    FormData
  >(enableWidgetChannel, enableWidgetChannelInitialState);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
      <div
        aria-hidden
        className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--accent-base) 15%, transparent)",
          color: "var(--accent-hover)",
        }}
      >
        <Plug className="size-6" />
      </div>
      <h2 className="text-h4 text-[var(--text-primary)]">
        Enable the website widget
      </h2>
      <p className="mx-auto mt-2 max-w-md text-body-sm text-[var(--text-secondary)]">
        Mints a public key and creates an embed snippet you can drop into any
        page. You can edit configuration and rotate the key afterwards.
      </p>
      <form action={formAction} className="mt-6 flex justify-center">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <button
          type="submit"
          disabled={!canEnable || pending}
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
              Enabling…
            </>
          ) : (
            "Enable widget"
          )}
        </button>
      </form>
      {!canEnable ? (
        <p className="mt-3 text-body-sm text-[var(--text-tertiary)]">
          Agents and above can enable channels.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-body-sm text-[var(--danger)]">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
