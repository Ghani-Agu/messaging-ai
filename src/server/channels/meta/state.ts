// Initial state + types for Meta channel server actions (Messenger +
// Instagram, Phase 7e). Lives outside actions.ts because Next.js requires
// "use server" files to export only async functions.
//
// The shape mirrors src/server/channels/whatsapp/state.ts with one
// structural addition: the connect flow is two-step (preview → confirm),
// per Gate 1 H1. Preview validates the operator's token + resolves Page
// metadata without writing rows; confirm re-validates and creates the
// rows. Two state types model that flow.

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Preview (validate token, fetch Page details, no DB write)
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewMetaConnectState =
  | { status: "idle" }
  | {
      status: "preview";
      pageId: string;
      pageName: string;
      igAvailable: boolean;
      igUserId?: string;
      igUsername?: string;
    }
  | {
      status: "error";
      formMessage?: string;
      fieldErrors?: { token?: string };
    };

export const previewMetaConnectInitialState: PreviewMetaConnectState = {
  status: "idle",
};

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Confirm (re-validate, subscribe webhooks, create Channel rows)
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmMetaConnectState =
  | { status: "idle" }
  | {
      status: "connected";
      messengerChannelId?: string;
      instagramChannelId?: string;
    }
  | {
      status: "error";
      formMessage?: string;
      // Per-channel errors from Gate 1 H3 — disconnect granularity is
      // independent, and so is collision messaging. P2002 on Messenger
      // surfaces in `messenger`; P2002 on Instagram in `instagram`.
      fieldErrors?: { messenger?: string; instagram?: string; token?: string };
    };

export const confirmMetaConnectInitialState: ConfirmMetaConnectState = {
  status: "idle",
};

// ─────────────────────────────────────────────────────────────────────────────
// Display-name updates (Messenger + Instagram share the shape)
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigUpdateState =
  | { status: "idle" }
  | { status: "saved" }
  | {
      status: "error";
      formMessage?: string;
      fieldErrors?: { displayName?: string };
    };

export const configUpdateInitialState: ConfigUpdateState = { status: "idle" };

// ─────────────────────────────────────────────────────────────────────────────
// Test connection — calls validateAccessToken against the live Graph API
// (or stub fallback). Different from the WhatsApp config-validity check;
// here we hit the network so an expired Page Access Token surfaces.
// ─────────────────────────────────────────────────────────────────────────────

export type TestConnectionState =
  | { status: "idle" }
  | { status: "ok"; pageId: string; pageName?: string }
  | { status: "error"; message: string };

export const testConnectionInitialState: TestConnectionState = {
  status: "idle",
};

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect / reconnect — flips Channel.status without deleting the row.
// ─────────────────────────────────────────────────────────────────────────────

export type DisconnectState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

export const disconnectInitialState: DisconnectState = { status: "idle" };
