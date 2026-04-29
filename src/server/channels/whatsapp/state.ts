// Initial state + types for WhatsApp channel server actions.
// Lives outside actions.ts because Next.js requires "use server" files
// to export only async functions.

export type ConnectWhatsAppState =
  | { status: "idle" }
  | { status: "connected"; channelId: string; webhookSecret: string }
  | {
      status: "error";
      formMessage?: string;
      fieldErrors?: {
        phoneNumberId?: string;
        phoneNumber?: string;
        displayName?: string;
        apiToken?: string;
      };
    };

export const connectWhatsAppInitialState: ConnectWhatsAppState = {
  status: "idle",
};

export type UpdateWhatsAppConfigState =
  | { status: "idle" }
  | { status: "saved" }
  | {
      status: "error";
      formMessage?: string;
      fieldErrors?: {
        phoneNumber?: string;
        displayName?: string;
      };
    };

export const updateWhatsAppConfigInitialState: UpdateWhatsAppConfigState = {
  status: "idle",
};

export type RotateWhatsAppSecretState =
  | { status: "idle" }
  | { status: "rotated"; webhookSecret: string }
  | { status: "error"; message: string };

export const rotateWhatsAppSecretInitialState: RotateWhatsAppSecretState = {
  status: "idle",
};

export type DisconnectWhatsAppState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

export const disconnectWhatsAppInitialState: DisconnectWhatsAppState = {
  status: "idle",
};

export type TestWhatsAppConnectionState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

export const testWhatsAppConnectionInitialState: TestWhatsAppConnectionState = {
  status: "idle",
};
