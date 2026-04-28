/**
 * Widget entry point — commit-2 state.
 *
 * Wires the generated tokens (widget/src/tokens.ts) as Shadow-DOM-scoped
 * CSS custom properties and injects the scoped stylesheet (styles.css)
 * inline. The full embed contract — reading data-key from the host
 * <script>, exposing window.MessagingAI, subscribing to the bus — lands
 * in commit 3 alongside the component tree.
 */
import { h, render } from "preact";
import { tokens } from "./tokens";
import styles from "./styles.css?inline";

function tokensToCssVars(): string {
  const map: Record<string, string> = {
    "--ma-bg-base": tokens.bg.base,
    "--ma-bg-surface": tokens.bg.surface,
    "--ma-bg-surface-elevated": tokens.bg.surfaceElevated,
    "--ma-bg-surface-overlay": tokens.bg.surfaceOverlay,
    "--ma-border-subtle": tokens.border.subtle,
    "--ma-border-default": tokens.border.default,
    "--ma-text-primary": tokens.text.primary,
    "--ma-text-secondary": tokens.text.secondary,
    "--ma-text-tertiary": tokens.text.tertiary,
    "--ma-text-disabled": tokens.text.disabled,
    "--ma-accent-base": tokens.accent.base,
    "--ma-accent-hover": tokens.accent.hover,
    "--ma-danger": tokens.status.danger,
    "--ma-radius-sm": tokens.radius.sm,
    "--ma-radius-md": tokens.radius.md,
    "--ma-radius-lg": tokens.radius.lg,
    "--ma-radius-xl": tokens.radius.xl,
    "--ma-radius-full": tokens.radius.full,
    "--ma-shadow-md": tokens.shadow.md,
    "--ma-shadow-lg": tokens.shadow.lg,
    "--ma-shadow-glow": tokens.shadow.glow,
    "--ma-ease-standard": tokens.motion.easeStandard,
    "--ma-ease-out-expo": tokens.motion.easeOutExpo,
    "--ma-duration-fast": tokens.motion.durationFast,
    "--ma-duration-medium": tokens.motion.durationMedium,
    "--ma-duration-slow": tokens.motion.durationSlow,
  };
  return ":host {\n" + Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n") + "\n}";
}

// Scaffold pill — replaced by the full Widget tree in commit 3. Now uses
// the .launcher class so the styles + tokens path is exercised end-to-end.
function Scaffold() {
  return h(
    "button",
    { class: "launcher", type: "button" },
    h("span", { class: "label" }, "messaging-ai · scaffold"),
  );
}

function mount(): void {
  const host = document.createElement("div");
  host.id = "messaging-ai-widget-host";
  host.style.cssText = "all: initial; position: relative; z-index: 2147483000;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = document.createElement("style");
  styleEl.textContent = tokensToCssVars() + "\n" + styles;
  shadow.appendChild(styleEl);

  const root = document.createElement("div");
  shadow.appendChild(root);

  render(h(Scaffold, null), root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
