"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { switchWorkspaceAction } from "@/server/tenancy/actions";
import { cn } from "@/lib/utils";

type Membership = {
  tenantId: string;
  tenant: { id: string; slug: string; name: string };
};

export function WorkspaceSwitcher({
  current,
  memberships,
  compact = false,
  currentHasBrandLogo = false,
}: {
  current: { id: string; slug: string; name: string };
  memberships: Membership[];
  /** Icon-only mode for collapsed sidebar — shows just the gradient square. */
  compact?: boolean;
  /** When true, render `/<current.slug>.png` inside the gradient square
   *  instead of the initial. Sourced from `getTenantBrand` in the layout. */
  currentHasBrandLogo?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "group flex items-center gap-2 rounded-md text-left transition-colors duration-150 ease-out",
          compact
            ? "size-10 justify-center"
            : "w-full px-2 py-1.5 hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
        aria-label={`Switch workspace. Current: ${current.name}`}
      >
        <BrandSquare
          name={current.name}
          slug={current.slug}
          hasBrandLogo={currentHasBrandLogo}
          compact={compact}
        />
        {compact ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
                {current.name}
              </span>
              <span className="truncate text-caption text-[var(--text-tertiary)]">
                messaging-ai.app/{current.slug}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
          </>
        )}
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
              href="/onboarding/create-tenant?intent=add"
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

/**
 * Tenant brand mark. When `hasBrandLogo` is true, renders `/<slug>.png`
 * directly on the sidebar surface (no gradient backdrop — the backdrop
 * competes with the logo). Otherwise, falls back to a gradient square with
 * the tenant initial so there's still a visual anchor for the brand block.
 *
 * The wrapper is fixed-size (size-9 expanded / size-7 collapsed) with
 * object-contain on the Image so an off-square logo aspect ratio stays
 * within a predictable cell and aligns with the workspace name text.
 *
 * `onError` swap covers the dev case where the manifest opted in but the
 * PNG hasn't been dropped into `public/` yet.
 */
function BrandSquare({
  name,
  slug,
  hasBrandLogo,
  compact,
}: {
  name: string;
  slug: string;
  hasBrandLogo: boolean;
  compact: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const showLogo = hasBrandLogo && !errored;
  const sizeClass = compact ? "size-7" : "size-9";

  if (showLogo) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden",
          sizeClass,
        )}
      >
        <Image
          src={`/${slug}.png`}
          alt={`${name} logo`}
          width={compact ? 28 : 36}
          height={compact ? 28 : 36}
          className="size-full object-contain"
          onError={() => setErrored(true)}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-body-sm font-semibold text-white",
        sizeClass,
      )}
      style={{ background: "var(--gradient-primary)" }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
