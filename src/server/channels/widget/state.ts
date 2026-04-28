// Initial state + types for widget-channel server actions. Lives outside
// actions.ts because Next.js requires "use server" files to export only async
// functions — no constants, no plain objects. Importing from here is safe
// from both client and server modules; types are erased and the constants
// are inert.

export type EnableWidgetChannelState =
  | { status: "idle" }
  | { status: "ok"; channelId: string }
  | { status: "error"; message: string };

export const enableWidgetChannelInitialState: EnableWidgetChannelState = {
  status: "idle",
};

/**
 * Per-line errors are keyed by the original input index (the position in the
 * raw textarea after splitting on commas/newlines, before filtering empties).
 * The UI renders these as a list under the textarea: "Line N: …".
 */
export type UpdateWidgetConfigState =
  | { status: "idle" }
  | { status: "saved" }
  | {
      status: "error";
      formMessage?: string;
      fieldErrors?: {
        displayName?: string;
        themeAccent?: string;
        originsByIndex?: Record<number, string>;
      };
    };

export const updateWidgetConfigInitialState: UpdateWidgetConfigState = {
  status: "idle",
};

export type RotateWidgetKeyState =
  | { status: "idle" }
  | { status: "rotated"; publicKey: string }
  | { status: "error"; message: string };

export const rotateWidgetKeyInitialState: RotateWidgetKeyState = {
  status: "idle",
};
