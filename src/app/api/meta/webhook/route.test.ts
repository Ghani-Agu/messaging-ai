import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// vi.hoisted gives the mock factories a stable shared reference to spy
// on getProfile across multiple invocations of getMessengerClient /
// getInstagramClient. Without this, each `getXxxClient(...)` call would
// return a fresh client whose getProfile is a different spy and call
// counts couldn't be asserted across webhooks.
const { messengerGetProfile, instagramGetProfile } = vi.hoisted(() => ({
  messengerGetProfile: vi.fn(),
  instagramGetProfile: vi.fn(),
}));

vi.mock("@/server/db/channels", () => ({
  getChannelByMessengerPageId: vi.fn(),
  getChannelByInstagramIgUserId: vi.fn(),
}));

vi.mock("@/server/db/conversations", () => ({
  findCustomerByExternalId: vi.fn(),
  findMessageByProviderId: vi.fn(),
  resolveOrCreateConversation: vi.fn(),
  recordInboundMessage: vi.fn(),
  loadHistoryTurns: vi.fn(),
  recordAiMessage: vi.fn(),
  markConversationForHandoff: vi.fn(),
  updateMessageDeliveryStatus: vi.fn(),
}));

vi.mock("@/server/ai/orchestrator", () => ({
  runBrain: vi.fn(),
}));

vi.mock("@/server/channels/messenger/client", () => ({
  getMessengerClient: vi.fn(() => ({
    sendMessage: vi.fn(),
    getProfile: messengerGetProfile,
  })),
}));

vi.mock("@/server/channels/instagram/client", () => ({
  getInstagramClient: vi.fn(() => ({
    sendMessage: vi.fn(),
    getProfile: instagramGetProfile,
  })),
}));

import type { Channel } from "@prisma/client";
import { POST } from "./route";
import { signMetaPayload } from "@/server/channels/meta/signatures";
import {
  getChannelByInstagramIgUserId,
  getChannelByMessengerPageId,
} from "@/server/db/channels";
import {
  findCustomerByExternalId,
  findMessageByProviderId,
  loadHistoryTurns,
  recordAiMessage,
  recordInboundMessage,
  resolveOrCreateConversation,
} from "@/server/db/conversations";
import { runBrain } from "@/server/ai/orchestrator";

const PAGE_ID = "PAGE_TEST_999";
const IG_USER_ID = "IG_TEST_888";
const TENANT_ID = "tnt_test";
const MSGR_CHANNEL_ID = "chn_msgr_test";
const IG_CHANNEL_ID = "chn_ig_test";
const SECRET = "test_meta_app_secret_min_16_chars";

const messengerChannel: Channel = {
  id: MSGR_CHANNEL_ID,
  tenantId: TENANT_ID,
  type: "MESSENGER",
  displayName: "Test Page",
  status: "CONNECTED",
  config: {
    provider: "meta-cloud",
    pageId: PAGE_ID,
    pageName: "Test Page",
  },
  credentials: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const instagramChannel: Channel = {
  id: IG_CHANNEL_ID,
  tenantId: TENANT_ID,
  type: "INSTAGRAM",
  displayName: "Test IG",
  status: "CONNECTED",
  config: {
    provider: "meta-cloud",
    igUserId: IG_USER_ID,
    igUsername: "test_ig",
    pageId: PAGE_ID,
  },
  credentials: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeAll(() => {
  process.env.META_APP_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.META_APP_SECRET;
});

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(getChannelByMessengerPageId).mockResolvedValue(messengerChannel);
  vi.mocked(getChannelByInstagramIgUserId).mockResolvedValue(instagramChannel);
  vi.mocked(findMessageByProviderId).mockResolvedValue(null);
  vi.mocked(resolveOrCreateConversation).mockResolvedValue({
    conversation: {
      id: "conv_1",
      tenantId: TENANT_ID,
    } as never,
    customer: { id: "cust_1" } as never,
    resumed: false,
  });
  vi.mocked(recordInboundMessage).mockResolvedValue({
    id: "msg_inbound_1",
  } as never);
  vi.mocked(loadHistoryTurns).mockResolvedValue([]);
  vi.mocked(runBrain).mockResolvedValue({
    reply: "Stub reply",
    language: "en",
    groundedness: 0.8,
    confidence: 0.9,
    escalation: null,
    citations: [],
    citationsUsed: [],
    aiMetadata: {
      modelId: "stub",
      claudeRecommendedEscalation: false,
      claudeReason: null,
      topChunkSimilarity: 0,
      usage: null,
    },
  } as never);
  vi.mocked(recordAiMessage).mockResolvedValue({ id: "msg_ai_1" } as never);

  // Default profile shape — Messenger first/last, Instagram username/name.
  messengerGetProfile.mockResolvedValue({
    firstName: "Stub",
    lastName: "Customer",
  });
  instagramGetProfile.mockResolvedValue({
    username: "stub_user",
    name: "Stub Customer",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildMessengerEnvelope(opts: {
  mid: string;
  from: string;
  text: string;
}) {
  const ts = Date.now();
  return {
    object: "page",
    entry: [
      {
        id: PAGE_ID,
        time: ts,
        messaging: [
          {
            sender: { id: opts.from },
            recipient: { id: PAGE_ID },
            timestamp: ts,
            message: { mid: opts.mid, text: opts.text },
          },
        ],
      },
    ],
  };
}

function buildInstagramEnvelope(opts: {
  mid: string;
  from: string;
  text: string;
}) {
  const ts = Date.now();
  return {
    object: "instagram",
    entry: [
      {
        id: IG_USER_ID,
        time: ts,
        messaging: [
          {
            sender: { id: opts.from },
            recipient: { id: IG_USER_ID },
            timestamp: ts,
            message: { mid: opts.mid, text: opts.text },
          },
        ],
      },
    ],
  };
}

async function postWebhook(envelope: unknown): Promise<Response> {
  const rawBody = JSON.stringify(envelope);
  const signature = signMetaPayload({ rawBody, secret: SECRET });
  const req = new Request("http://localhost/api/meta/webhook", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": signature,
      "Content-Type": "application/json",
    },
    body: rawBody,
  });
  // POST signature is NextRequest but at runtime accesses only Request
  // surface (req.text(), req.headers.get) — safe to cast.
  return POST(req as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Meta webhook — getProfile call-once semantics (Gate 1 H6)", () => {
  it("first inbound from a never-seen PSID fires getProfile and seeds Customer.name", async () => {
    // No cached customer → getProfile must fire.
    vi.mocked(findCustomerByExternalId).mockResolvedValue(null);

    const PSID = "PSID_NEW_111";
    const res = await postWebhook(
      buildMessengerEnvelope({
        mid: "mid.test_first",
        from: PSID,
        text: "hi",
      }),
    );
    expect(res.status).toBe(200);

    expect(messengerGetProfile).toHaveBeenCalledTimes(1);
    expect(messengerGetProfile).toHaveBeenCalledWith({ psid: PSID });

    // resolveOrCreateConversation must receive the joined "First Last"
    // name as customerHints so the upsert seeds Customer.name immediately.
    expect(resolveOrCreateConversation).toHaveBeenCalledTimes(1);
    const args = vi.mocked(resolveOrCreateConversation).mock.calls[0]![0];
    expect(args.customerHints).toEqual({ name: "Stub Customer" });
    expect(args.externalId).toBe(PSID);
    expect(args.channelType).toBe("MESSENGER");
  });

  it("subsequent inbound from the same PSID does NOT call getProfile (call count = 1 across two webhooks)", async () => {
    const PSID = "PSID_REPEAT_222";
    // First webhook: no cached customer.
    // Second webhook: cached customer with non-null name.
    vi.mocked(findCustomerByExternalId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "cust_repeat",
        name: "Stub Customer",
      } as never);

    await postWebhook(
      buildMessengerEnvelope({
        mid: "mid.test_a",
        from: PSID,
        text: "first",
      }),
    );
    await postWebhook(
      buildMessengerEnvelope({
        mid: "mid.test_b",
        from: PSID,
        text: "second",
      }),
    );

    // The load-bearing assertion: getProfile fires exactly once across
    // both webhooks. Subsequent messages from the same identity reuse
    // the cached Customer.name without burning a Graph API call.
    expect(messengerGetProfile).toHaveBeenCalledTimes(1);

    // Second resolveOrCreateConversation call should pass no
    // customerHints (the cached row already has a name; nothing to
    // overwrite).
    const calls = vi.mocked(resolveOrCreateConversation).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].customerHints).toEqual({ name: "Stub Customer" });
    expect(calls[1]![0].customerHints).toBeUndefined();
  });

  it("first inbound from a never-seen IGSID fires Instagram getProfile with @username", async () => {
    vi.mocked(findCustomerByExternalId).mockResolvedValue(null);

    const IGSID = "IGSID_NEW_333";
    const res = await postWebhook(
      buildInstagramEnvelope({
        mid: "mid.ig_first",
        from: IGSID,
        text: "DM hello",
      }),
    );
    expect(res.status).toBe(200);

    expect(instagramGetProfile).toHaveBeenCalledTimes(1);
    expect(instagramGetProfile).toHaveBeenCalledWith({ igsid: IGSID });

    // Instagram fetcher prefers @username over display name.
    const args = vi.mocked(resolveOrCreateConversation).mock.calls[0]![0];
    expect(args.customerHints).toEqual({ name: "stub_user" });
    expect(args.channelType).toBe("INSTAGRAM");
  });

  it("getProfile failure does not break the webhook — message still persists with no customerHints", async () => {
    vi.mocked(findCustomerByExternalId).mockResolvedValue(null);
    messengerGetProfile.mockRejectedValueOnce(new Error("Graph API down"));

    const res = await postWebhook(
      buildMessengerEnvelope({
        mid: "mid.test_fail",
        from: "PSID_FAIL_444",
        text: "hi",
      }),
    );
    expect(res.status).toBe(200);

    // resolveOrCreateConversation was still called — the webhook didn't
    // bail out — and customerHints is undefined so the upsert creates
    // Customer with null name.
    expect(resolveOrCreateConversation).toHaveBeenCalledTimes(1);
    expect(recordInboundMessage).toHaveBeenCalledTimes(1);
    const args = vi.mocked(resolveOrCreateConversation).mock.calls[0]![0];
    expect(args.customerHints).toBeUndefined();
  });

  it("cached customer with null name re-fires getProfile (recovers from earlier fetch failure)", async () => {
    // Customer exists but has no name yet — earlier inbound's getProfile
    // failed. The next inbound retries the fetch.
    vi.mocked(findCustomerByExternalId).mockResolvedValue({
      id: "cust_unnamed",
      name: null,
    } as never);

    await postWebhook(
      buildMessengerEnvelope({
        mid: "mid.retry",
        from: "PSID_RETRY_555",
        text: "second try",
      }),
    );

    expect(messengerGetProfile).toHaveBeenCalledTimes(1);
    const args = vi.mocked(resolveOrCreateConversation).mock.calls[0]![0];
    expect(args.customerHints).toEqual({ name: "Stub Customer" });
  });
});
