"use client";

import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useThemeSwitcher } from "@/hooks/use-theme-switcher";
import { cn } from "@/lib/utils";

type ThemeValue = "light" | "dark" | "system";
type Option = { value: ThemeValue; label: string; icon: LucideIcon };

const OPTIONS: Option[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

/**
 * Segmented control for the /settings General tab. Reads the current
 * value via useThemeSwitcher and dispatches changes through the same
 * View-Transitions / CSS-fallback pipeline used everywhere themes
 * change in the app.
 */
export function ThemePicker() {
  const { theme, switchTheme } = useThemeSwitcher();
  // next-themes returns undefined before mount; wait so the active state
  // doesn't flicker on first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: ThemeValue = mounted
    ? ((theme ?? "system") as ThemeValue)
    : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = mounted && current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => switchTheme(opt.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-body-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]",
              active
                ? "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="size-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
