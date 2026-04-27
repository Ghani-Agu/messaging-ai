"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { switchWorkspaceAction } from "@/server/tenancy/actions";
import { cn } from "@/lib/utils";

type Membership = {
  tenantId: string;
  tenant: { id: string; slug: string; name: string };
};

export function WorkspaceSwitcher({
  current,
  memberships,
}: {
  current: { id: string; slug: string; name: string };
  memberships: Membership[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
        aria-label={`Switch workspace. Current: ${current.name}`}
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-body-sm font-semibold text-white"
          style={{ background: "var(--gradient-primary)" }}
        >
          {current.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
            {current.name}
          </span>
          <span className="truncate text-caption text-[var(--text-tertiary)]">
            messaging-ai.app/{current.slug}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[260px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-lg)]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            Workspaces
          </DropdownMenu.Label>

          {memberships.map((m) => {
            const isCurrent = m.tenantId === current.id;
            return (
              <form key={m.tenantId} action={switchWorkspaceAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <input type="hidden" name="slug" value={m.tenant.slug} />
                <DropdownMenu.Item
                  asChild
                  // Don't auto-close before the form submits.
                  onSelect={(e) => e.preventDefault()}
                >
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm",
                      "transition-colors duration-150 ease-out",
                      "hover:bg-[var(--bg-surface-overlay)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-caption font-semibold text-white"
                      style={{ background: "var(--gradient-primary)" }}
                    >
                      {m.tenant.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[var(--text-primary)]">
                        {m.tenant.name}
                      </span>
                      <span className="truncate text-caption text-[var(--text-tertiary)]">
                        /{m.tenant.slug}
                      </span>
                    </span>
                    {isCurrent ? (
                      <Check className="size-4 shrink-0 text-[var(--accent-hover)]" />
                    ) : null}
                  </button>
                </DropdownMenu.Item>
              </form>
            );
          })}

          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

          <DropdownMenu.Item asChild>
            <Link
              href="/onboarding/create-tenant"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
            >
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border-default)]"
              >
                <Plus className="size-3.5" />
              </span>
              Create workspace
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
