import { h } from "preact";
import type { ConversationState, Message } from "../types";
import { CANNED_REPLIES, SEEDED_HISTORY, type CannedShape } from "../mock-data";

/**
 * Dev-only controls that seed the message list with one of the four
 * canned shapes (or the pre-built Darija RTL history) and toggle the
 * error state. Mounted only when import.meta.env.DEV. Intentionally
 * minimal styling — these are not user-facing chrome.
 */

export type DemoCommand =
  | { kind: "seed"; messages: Message[]; status?: ConversationState }
  | { kind: "status"; status: ConversationState };

export function DemoControls({ onCommand }: { onCommand: (cmd: DemoCommand) => void }) {
  const seedShape = (shape: CannedShape) => {
    const canned = CANNED_REPLIES[shape];
    const customerPrompt: Record<CannedShape, string> = {
      happy: "What are your shipping costs to Algiers?",
      "outside-scope": "Comment va le temps aujourd'hui?",
      "explicit-request": "kayan wach nhder m3a wa7ed agent?",
      "payment-dispute": "Je veux un remboursement, c'est inacceptable!",
    };
    onCommand({
      kind: "seed",
      status: "idle",
      messages: [
        { id: "demo-c", role: "customer", text: customerPrompt[shape] },
        {
          id: "demo-a",
          role: "ai",
          text: canned.reply,
          lang: canned.language,
          citations: canned.citations.length > 0 ? canned.citations : undefined,
        },
      ],
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: 8,
        background: "rgba(0,0,0,0.85)",
        color: "white",
        font: "11px/1.3 ui-monospace, monospace",
        borderRadius: 6,
        zIndex: 2147482999,
      }}
    >
      <span style={{ alignSelf: "center", opacity: 0.6, marginRight: 4 }}>demo:</span>
      <DemoButton label="happy" onClick={() => seedShape("happy")} />
      <DemoButton label="off-topic" onClick={() => seedShape("outside-scope")} />
      <DemoButton label="human-req" onClick={() => seedShape("explicit-request")} />
      <DemoButton label="refund" onClick={() => seedShape("payment-dispute")} />
      <DemoButton
        label="darija RTL"
        onClick={() =>
          onCommand({
            kind: "seed",
            status: "idle",
            messages: SEEDED_HISTORY,
          })
        }
      />
      <DemoButton
        label="error"
        onClick={() => onCommand({ kind: "status", status: "error" })}
      />
      <DemoButton
        label="clear"
        onClick={() => onCommand({ kind: "seed", status: "idle", messages: [] })}
      />
    </div>
  );
}

function DemoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 8px",
        background: "rgba(255,255,255,0.1)",
        color: "white",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {label}
    </button>
  );
}
