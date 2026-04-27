"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Shield } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/server/auth/actions";
import { ThemeToggleSubmenu } from "./theme-toggle-menu";
import { cn } from "@/lib/utils";

export function UserMenu({
  user,
}: {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
}) {
  const initials = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  const display = user.name ?? user.email ?? "Account";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
        aria-label="Open user menu"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface-overlay)] text-body-sm font-semibold text-[var(--text-secondary)]"
          >
            {initials}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
            {display}
          </span>
          {user.email && user.email !== display ? (
            <span className="truncate text-caption text-[var(--text-tertiary)]">
              {user.email}
            </span>
          ) : null}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-lg)]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            {user.email ?? "Account"}
          </DropdownMenu.Label>

          <ThemeToggleSubmenu />

          {user.isSuperAdmin ? (
            <DropdownMenu.Item asChild>
              <Link
                href="/admin"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
              >
                <Shield className="size-4 text-[var(--text-tertiary)]" />
                Admin
              </Link>
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

          <form action={signOutAction}>
            <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
              >
                <LogOut className="size-4 text-[var(--text-tertiary)]" />
                Sign out
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
