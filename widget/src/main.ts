/**
 * Widget entry point. This file's only Phase-5 commit-1 job is to prove the
 * Vite library build, IIFE output, and Shadow DOM mount work end-to-end so
 * the bundle-size check has something to measure. Real component tree
 * lands in commit 3.
 */
import { h, render } from "preact";

function Scaffold() {
  return h(
    "div",
    {
      style: {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        padding: "10px 14px",
        background: "#7C3AED",
        color: "white",
        borderRadius: "9999px",
        font:
          "500 13px/1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
      },
    },
    "messaging-ai · scaffold",
  );
}

function mount(): void {
  const host = document.createElement("div");
  host.id = "messaging-ai-widget-host";
  host.style.cssText = "all: initial; position: relative; z-index: 2147483000;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const root = document.createElement("div");
  shadow.appendChild(root);

  render(h(Scaffold, null), root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
