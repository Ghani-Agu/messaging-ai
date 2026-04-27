"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { useThemeSwitcher } from "@/hooks/use-theme-switcher";
import { cn } from "@/lib/utils";

type Option = { value: "light" | "dark" | "system"; label: string; icon: LucideIcon };

const OPTIONS: Option[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

/**
 * Compact theme picker rendered inside the user-menu dropdown. The richer
 * segmented control + view-transition crossfade lives in components/ui;
 * this is the menu-friendly variant.
 */
export function ThemeToggleSubmenu() {
  const { theme, switchTheme, resolvedTheme } = useThemeSwitcher();
  const current = theme ?? resolvedTheme ?? "system";

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-body-sm text-[var(--text-secondary)]",
          "transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)]",
          "focus:bg-[var(--bg-surface-overlay)] focus:text-[var(--text-primary)] focus:outline-none",
          "data-[state=open]:bg-[var(--bg-surface-overlay)] data-[state=open]:text-[var(--text-primary)]",
        )}
      >
        {current === "light" ? (
          <Sun className="size-4 text-[var(--text-tertiary)]" />
        ) : current === "dark" ? (
          <Moon className="size-4 text-[var(--text-tertiary)]" />
        ) : (
          <Laptop className="size-4 text-[var(--text-tertiary)]" />
        )}
        Theme
        <span className="ml-auto text-caption text-[var(--text-tertiary)]">
          {current === "system" ? "System" : current === "dark" ? "Dark" : "Light"}
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={4}
          className="z-50 min-w-[180px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-lg)]"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = current === opt.value;
            return (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => switchTheme(opt.value)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm",
                  "transition-colors duration-150 ease-out",
                  "hover:bg-[var(--bg-surface-overlay)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none",
                  active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                )}
              >
                <Icon className="size-4 text-[var(--text-tertiary)]" />
                <span className="flex-1">{opt.label}</span>
                {active ? (
                  <Check className="size-3.5 text-[var(--accent-hover)]" />
                ) : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
