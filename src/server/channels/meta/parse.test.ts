import { describe, expect, it } from "vitest";
import { parseMetaWebhook } from "./parse";

const PAGE_ID = "100000_PAGE";
const IG_USER_ID = "17841_IG";
const PSID = "1234567890";
const IGSID = "9988776655";

function pageEnvelope(messaging: unknown[]) {
  return {
    object: "page",
    entry: [{ id: PAGE_ID, time: 1745849600000, messaging }],
  };
}

function igEnvelope(messaging: unknown[]) {
  return {
    object: "instagram",
    entry: [{ id: IG_USER_ID, time: 1745849600000, messaging }],
  };
}

describe("parseMetaWebhook — Messenger inbound", () => {
  it("projects a text message into a ParsedMetaInbound (channelKind=messenger)", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        {
          sender: { id: PSID },
          recipient: { id: PAGE_ID },
          timestamp: 1745849600000,
          message: { mid: "mid.HBg_msgr_test", text: "Hi from Messenger" },
        },
      ]),
    );
    expect(r.inbound).toHaveLength(1);
    expect(r.statuses).toHaveLength(0);
    expect(r.inbound[0]).toEqual({
      channelKind: "messenger",
      externalAccountId: PAGE_ID,
      customerExternalId: PSID,
      providerMessageId: "mid.HBg_msgr_test",
      content: "Hi from Messenger",
      contentType: "TEXT",
      mediaUrl: null,
      timestamp: 1745849600000,
    });
  });

  it("projects an image attachment with payload.url", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        {
          sender: { id: PSID },
          message: {
            mid: "mid.img",
            attachments: [
              {
                type: "image",
                payload: { url: "https://scontent.fb/photo.jpg" },
              },
            ],
          },
        },
      ]),
    );
    expect(r.inbound[0]).toMatchObject({
      content: "[image]",
      contentType: "IMAGE",
      mediaUrl: "https://scontent.fb/photo.jpg",
    });
  });

  it("projects audio attachments to VOICE", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        {
          sender: { id: PSID },
          message: {
            mid: "mid.audio",
            attachments: [
              { type: "audio", payload: { url: "https://scontent.fb/a.mp4" } },
            ],
          },
        },
      ]),
    );
    expect(r.inbound[0]?.contentType).toBe("VOICE");
    expect(r.inbound[0]?.content).toBe("[voice message]");
  });

  it("projects file / video attachments to FILE", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        {
          sender: { id: PSID },
          message: {
            mid: "mid.file",
            attachments: [{ type: "file", payload: { url: "https://x.fb/f.pdf" } }],
          },
        },
        {
          sender: { id: PSID },
          message: {
            mid: "mid.video",
            attachments: [{ type: "video", payload: { url: "https://x.fb/v.mp4" } }],
          },
        },
      ]),
    );
    expect(r.inbound).toHaveLength(2);
    expect(r.inbound[0]?.contentType).toBe("FILE");
    expect(r.inbound[1]?.contentType).toBe("FILE");
  });

  it("skips messaging items without sender or message body", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        // No sender → skipped.
        { recipient: { id: PAGE_ID }, message: { mid: "mid.x", text: "hi" } },
        // No message + no delivery → skipped.
        { sender: { id: PSID } },
      ]),
    );
    expect(r.inbound).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
  });

  it("skips messages with no text + no attachments (postbacks, story mentions, etc)", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        { sender: { id: PSID }, message: { mid: "mid.empty" } },
      ]),
    );
    expect(r.inbound).toHaveLength(0);
  });
});

describe("parseMetaWebhook — Instagram inbound", () => {
  it("projects a text message with channelKind=instagram", () => {
    const r = parseMetaWebhook(
      igEnvelope([
        {
          sender: { id: IGSID },
          recipient: { id: IG_USER_ID },
          timestamp: 1745849700000,
          message: { mid: "mid.ig_test", text: "Hello from IG" },
        },
      ]),
    );
    expect(r.inbound).toHaveLength(1);
    expect(r.inbound[0]).toMatchObject({
      channelKind: "instagram",
      externalAccountId: IG_USER_ID,
      customerExternalId: IGSID,
      content: "Hello from IG",
      contentType: "TEXT",
    });
  });
});

describe("parseMetaWebhook — delivery status", () => {
  it("emits one ParsedMetaDeliveryStatus per mid in delivery.mids", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        {
          sender: { id: PAGE_ID },
          recipient: { id: PSID },
          timestamp: 1745849700000,
          delivery: {
            mids: ["mid.A", "mid.B", "mid.C"],
            watermark: 1745849700000,
          },
        },
      ]),
    );
    expect(r.inbound).toHaveLength(0);
    expect(r.statuses).toHaveLength(3);
    expect(r.statuses.map((s) => s.providerMessageId)).toEqual([
      "mid.A",
      "mid.B",
      "mid.C",
    ]);
    for (const s of r.statuses) {
      expect(s.status).toBe("delivered");
      expect(s.channelKind).toBe("messenger");
      expect(s.externalAccountId).toBe(PAGE_ID);
    }
  });

  it("ignores delivery events with empty mids", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        { sender: { id: PAGE_ID }, delivery: { mids: [], watermark: 1 } },
      ]),
    );
    expect(r.statuses).toHaveLength(0);
  });

  it("ignores read events (deferred to Phase 7.5)", () => {
    const r = parseMetaWebhook(
      pageEnvelope([
        { sender: { id: PSID }, read: { watermark: 1745849700000 } },
      ]),
    );
    expect(r.inbound).toHaveLength(0);
    expect(r.statuses).toHaveLength(0);
  });
});

describe("parseMetaWebhook — top-level shape", () => {
  it("throws on malformed envelope (missing entry)", () => {
    expect(() => parseMetaWebhook({ object: "page" })).toThrow();
  });

  it("throws on unknown object value (only page / instagram supported)", () => {
    expect(() =>
      parseMetaWebhook({ object: "unknown_product", entry: [] }),
    ).toThrow();
  });

  it("returns empty arrays when entry has no messaging items", () => {
    const r = parseMetaWebhook({
      object: "page",
      entry: [{ id: PAGE_ID }],
    });
    expect(r.inbound).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it("ignores additional unknown fields on each level (passthrough)", () => {
    const r = parseMetaWebhook({
      object: "page",
      __extra__: "future",
      entry: [
        {
          id: PAGE_ID,
          __more__: 1,
          messaging: [
            {
              sender: { id: PSID, __unknown__: true },
              message: { mid: "mid.x", text: "ok", __also__: 2 },
            },
          ],
        },
      ],
    });
    expect(r.inbound).toHaveLength(1);
  });
});
