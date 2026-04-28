/**
 * Widget entry point — Phase-5 commit-3 state.
 *
 * Embed contract:
 *   <script src="…/widget.js" data-key="wgt_pk_…" async></script>
 *
 * On mount:
 *   1. Read data-key from document.currentScript (the host page's tag).
 *   2. Create the host element + Shadow DOM root.
 *   3. Inject tokens-as-CSS-vars + scoped styles.
 *   4. Render <Widget /> with the resolved key.
 *   5. Expose window.MessagingAI = { open, close, toggle, identify, destroy }
 *      backed by the api-bus (component subscribes inside useEffect).
 *
 * The widget never reads tenant identity directly; the server resolves
 * data-key → tenant via Channel.config when the widget channel is
 * enabled (UI lands at integration). The displayed business name is a
 * runtime placeholder until the server can return it on the first
 * stream response — for the demo gate it ships hard-coded.
 */
import { h, render } from "preact";
import { tokens } from "./tokens";
import styles from "./styles.css?inline";
import { Widget } from "./Widget";
import { dispatch as busDispatch } from "./api-bus";

declare global {
  interface Window {
    MessagingAI?: {
      open(): void;
      close(): void;
      toggle(): void;
      identify(user: { name?: string; email?: string; phone?: string }): void;
      destroy(): void;
    };
  }
}

let host: HTMLElement | null = null;

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

type EmbedConfig = {
  widgetKey: string | null;
  /** Display name shown in the panel header until the server confirms it. */
  tenantName: string;
};

function readEmbedConfig(): EmbedConfig {
  // document.currentScript is null when the bundle is loaded via type=module
  // dev-server transform; in that case fall back to data-* on any <script>
  // matching our src or any element with [data-messaging-ai-key].
  const fromCurrent =
    typeof document !== "undefined"
      ? (document.currentScript as HTMLScriptElement | null)
      : null;
  let scriptEl: HTMLScriptElement | null = fromCurrent;
  if (!scriptEl && typeof document !== "undefined") {
    scriptEl = document.querySelector<HTMLScriptElement>("script[data-key]");
  }
  return {
    widgetKey: scriptEl?.dataset.key ?? null,
    tenantName: scriptEl?.dataset.name ?? "Support",
  };
}

function mount(): void {
  if (host) return; // idempotent — never mount twice
  host = document.createElement("div");
  host.id = "messaging-ai-widget-host";
  host.style.cssText = "all: initial; position: relative; z-index: 2147483000;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = document.createElement("style");
  styleEl.textContent = tokensToCssVars() + "\n" + styles;
  shadow.appendChild(styleEl);

  const root = document.createElement("div");
  shadow.appendChild(root);

  const config = readEmbedConfig();
  render(
    h(Widget, { widgetKey: config.widgetKey, tenantName: config.tenantName }),
    root,
  );
}

function destroy(): void {
  if (host) {
    host.remove();
    host = null;
  }
}

const api: NonNullable<Window["MessagingAI"]> = {
  open: () => busDispatch({ type: "open" }),
  close: () => busDispatch({ type: "close" }),
  toggle: () => busDispatch({ type: "toggle" }),
  identify: (user) => busDispatch({ type: "identify", user }),
  destroy,
};

if (typeof window !== "undefined") {
  window.MessagingAI = api;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}
