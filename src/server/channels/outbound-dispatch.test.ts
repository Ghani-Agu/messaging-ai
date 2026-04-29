import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Shared spies kept stable across multiple invocations of the leaf
// factories — vi.hoisted runs before vi.mock so the factory functions
// can close over these references.
const { messengerSendMessage, instagramSendMessage } = vi.hoisted(() => ({
  messengerSendMessage: vi.fn<
    (args: { to: string; content: string }) => Promise<{
      providerMessageId: string;
    }>
  >(),
  instagramSendMessage: vi.fn<
    (args: { to: string; content: string }) => Promise<{
      providerMessageId: string;
    }>
  >(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/conversations", () => ({
  getLastInboundAt: vi.fn(),
  mergeMessageAiMetadata: vi.fn(),
  setMessageProviderId: vi.fn(),
}));

// readMetaCredentials reads encrypted blobs and would call into
// decryptCredentials → process.env.ENCRYPTION_KEY. Mock it to return a
// placeholder so the factory path runs without env setup.
vi.mock("./meta/credentials", () => ({
  readMetaCredentials: vi.fn(() => ({
    pageAccessToken: "stub-placeholder-token",
  })),
}));

vi.mock("./messenger/client", () => ({
  getMessengerClient: vi.fn(() => ({
    sendMessage: messengerSendMessage,
    getProfile: vi.fn(),
  })),
}));

vi.mock("./instagram/client", () => ({
  getInstagramClient: vi.fn(() => ({
    sendMessage: instagramSendMessage,
    getProfile: vi.fn(),
  })),
}));

// WhatsApp client factory imported by outbound-dispatch but not used in
// these tests — mocking prevents the real module's side effects from
// loading server-only deps we don't need here.
vi.mock("./whatsapp/client", () => ({
  getWhatsAppClient: vi.fn(),
}));

import type { Channel, ChannelType } from "@prisma/client";
import { dispatchOutboundReply } from "./outbound-dispatch";
import { prisma } from "@/server/db/client";
import {
  getLastInboundAt,
  mergeMessageAiMetadata,
  setMessageProviderId,
} from "@/server/db/conversations";

const TENANT_ID = "tnt_test";
const CONV_ID = "conv_test";
const MSG_ID = "msg_ai_test";
const CONTENT = "Hello from the AI";
const CUSTOMER_EXTERNAL_ID_PSID = "PSID_TEST_111";
const CUSTOMER_EXTERNAL_ID_IGSID = "IGSID_TEST_222";

const NOW = Date.now();
const INSIDE_WINDOW = new Date(NOW - 60 * 60 * 1000); // 1h ago
const OUTSIDE_WINDOW = new Date(NOW - 25 * 60 * 60 * 1000); // 25h ago

function buildConvo(opts: {
  channelType: ChannelType;
  customerExternalId: string;
}) {
  const channel: Channel = {
    id: `chn_${opts.channelType.toLowerCase()}_test`,
    tenantId: TENANT_ID,
    type: opts.channelType,
    displayName: `Test ${opts.channelType}`,
    status: "CONNECTED",
    config:
      opts.channelType === "MESSENGER"
        ? { provider: "meta-cloud", pageId: "PAGE_TEST", pageName: "Test Page" }
        : opts.channelType === "INSTAGRAM"
          ? {
              provider: "meta-cloud",
              igUserId: "IG_TEST",
              pageId: "PAGE_TEST",
            }
          : {},
    credentials: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    id: CONV_ID,
    tenantId: TENANT_ID,
    channelId: channel.id,
    customerId: "cust_test",
    channel,
    customer: {
      id: "cust_test",
      tenantId: TENANT_ID,
      channelType: opts.channelType,
      externalId: opts.customerExternalId,
      phone: null,
      name: "Stub Customer",
      email: null,
      metadata: {},
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setMessageProviderId).mockResolvedValue();
  vi.mocked(mergeMessageAiMetadata).mockResolvedValue(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Parameterized tests across MESSENGER and INSTAGRAM
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    name: "MESSENGER",
    channelType: "MESSENGER" as const,
    customerExternalId: CUSTOMER_EXTERNAL_ID_PSID,
    spy: messengerSendMessage,
  },
  {
    name: "INSTAGRAM",
    channelType: "INSTAGRAM" as const,
    customerExternalId: CUSTOMER_EXTERNAL_ID_IGSID,
    spy: instagramSendMessage,
  },
] as const;

describe.each(PLATFORMS)(
  "dispatchOutboundReply — $name",
  ({ channelType, customerExternalId, spy }) => {
    it("outside the 24h window → persists skipped_outside_window without calling the provider", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(
        buildConvo({ channelType, customerExternalId }) as never,
      );
      vi.mocked(getLastInboundAt).mockResolvedValue(OUTSIDE_WINDOW);

      await dispatchOutboundReply({
        tenantId: TENANT_ID,
        messageId: MSG_ID,
        conversationId: CONV_ID,
        content: CONTENT,
      });

      expect(spy).not.toHaveBeenCalled();
      expect(setMessageProviderId).not.toHaveBeenCalled();

      expect(mergeMessageAiMetadata).toHaveBeenCalledTimes(1);
      const merge = vi.mocked(mergeMessageAiMetadata).mock.calls[0]![0];
      expect(merge.fields.deliveryStatus).toBe("skipped_outside_window");
      expect(merge.byMessageId).toBe(MSG_ID);
    });

    it("inside the window with a successful send → setMessageProviderId + deliveryStatus=sent", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(
        buildConvo({ channelType, customerExternalId }) as never,
      );
      vi.mocked(getLastInboundAt).mockResolvedValue(INSIDE_WINDOW);
      spy.mockResolvedValue({ providerMessageId: "mid.SENT_TEST" });

      await dispatchOutboundReply({
        tenantId: TENANT_ID,
        messageId: MSG_ID,
        conversationId: CONV_ID,
        content: CONTENT,
      });

      // sendMessage called with externalId as `to` (PSID for Messenger,
      // IGSID for Instagram — no phone-number projection like WhatsApp).
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        to: customerExternalId,
        content: CONTENT,
      });

      // providerMessageId stamped before the status merge so any fast
      // delivery webhook can find the row.
      expect(setMessageProviderId).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        messageId: MSG_ID,
        providerMessageId: "mid.SENT_TEST",
      });
      const merge = vi.mocked(mergeMessageAiMetadata).mock.calls[0]![0];
      expect(merge.fields.deliveryStatus).toBe("sent");
      expect(merge.fields.outboundSendError).toBeUndefined();
    });

    it("provider sendMessage throws → deliveryStatus=failed + outboundSendError captured", async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(
        buildConvo({ channelType, customerExternalId }) as never,
      );
      vi.mocked(getLastInboundAt).mockResolvedValue(INSIDE_WINDOW);
      spy.mockRejectedValueOnce(
        new Error(`${channelType} Graph API: HTTP 500 internal_error`),
      );

      await dispatchOutboundReply({
        tenantId: TENANT_ID,
        messageId: MSG_ID,
        conversationId: CONV_ID,
        content: CONTENT,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      // No providerMessageId stamp on failure — there's nothing to stamp.
      expect(setMessageProviderId).not.toHaveBeenCalled();
      const merge = vi.mocked(mergeMessageAiMetadata).mock.calls[0]![0];
      expect(merge.fields.deliveryStatus).toBe("failed");
      expect(merge.fields.outboundSendError).toContain(
        "HTTP 500 internal_error",
      );
    });
  },
);
