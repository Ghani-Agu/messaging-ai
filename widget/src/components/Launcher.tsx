import { h } from "preact";

export function Launcher({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      class="launcher"
      aria-label="Open chat"
      onClick={onClick}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span class="label">Chat with us</span>
    </button>
  );
}
