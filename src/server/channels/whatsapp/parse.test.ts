import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhook } from "./parse";

const PHONE_ID = "phn_TEST_123";

function inboundEnvelope(messages: unknown[], contacts: unknown[] = []) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: PHONE_ID },
              contacts,
              messages,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function statusEnvelope(statuses: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: PHONE_ID },
              statuses,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

describe("parseWhatsAppWebhook — inbound text", () => {
  it("projects a text message into ParsedInboundMessage", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope(
        [
          {
            id: "wamid.HBgM_test",
            from: "213555111222",
            timestamp: "1745849600",
            type: "text",
            text: { body: "Hello there" },
          },
        ],
        [{ wa_id: "213555111222", profile: { name: "Yacine" } }],
      ),
    );
    expect(r.inbound).toHaveLength(1);
    expect(r.statuses).toHaveLength(0);
    expect(r.inbound[0]).toEqual({
      phoneNumberId: PHONE_ID,
      customerWaId: "213555111222",
      customerPhoneNumber: "+213555111222",
      profileName: "Yacine",
      providerMessageId: "wamid.HBgM_test",
      content: "Hello there",
      contentType: "TEXT",
      mediaUrl: null,
      timestamp: 1745849600,
    });
  });

  it("falls back to null profileName when contacts is missing", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.x",
          from: "213555000000",
          timestamp: "1745849600",
          type: "text",
          text: { body: "Hi" },
        },
      ]),
    );
    expect(r.inbound[0]?.profileName).toBeNull();
  });

  it("preserves a leading + on the from value when present", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.x",
          from: "+213555000000",
          timestamp: "1745849600",
          type: "text",
          text: { body: "Hi" },
        },
      ]),
    );
    expect(r.inbound[0]?.customerWaId).toBe("+213555000000");
    expect(r.inbound[0]?.customerPhoneNumber).toBe("+213555000000");
  });
});

describe("parseWhatsAppWebhook — inbound media", () => {
  it("projects an image with a caption", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.img",
          from: "213555000000",
          timestamp: "1745849600",
          type: "image",
          image: { id: "media_abc", caption: "look at this", mime_type: "image/jpeg" },
        },
      ]),
    );
    expect(r.inbound[0]).toMatchObject({
      content: "look at this",
      contentType: "IMAGE",
      mediaUrl: "media_abc",
    });
  });

  it("projects an image without a caption to '[image]'", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.img2",
          from: "213555000000",
          timestamp: "1745849600",
          type: "image",
          image: { id: "media_xyz", mime_type: "image/jpeg" },
        },
      ]),
    );
    expect(r.inbound[0]).toMatchObject({
      content: "[image]",
      contentType: "IMAGE",
      mediaUrl: "media_xyz",
    });
  });

  it("projects voice / audio to VOICE contentType", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.voice",
          from: "213555000000",
          timestamp: "1745849600",
          type: "voice",
          voice: { id: "media_voice" },
        },
        {
          id: "wamid.audio",
          from: "213555000000",
          timestamp: "1745849601",
          type: "audio",
          audio: { id: "media_audio" },
        },
      ]),
    );
    expect(r.inbound).toHaveLength(2);
    expect(r.inbound[0]?.contentType).toBe("VOICE");
    expect(r.inbound[0]?.mediaUrl).toBe("media_voice");
    expect(r.inbound[1]?.contentType).toBe("VOICE");
  });

  it("projects a document with a filename", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.doc",
          from: "213555000000",
          timestamp: "1745849600",
          type: "document",
          document: {
            id: "media_doc",
            filename: "invoice.pdf",
            mime_type: "application/pdf",
          },
        },
      ]),
    );
    expect(r.inbound[0]).toMatchObject({
      content: "[document: invoice.pdf]",
      contentType: "FILE",
      mediaUrl: "media_doc",
    });
  });

  it("falls back to a placeholder for unknown types", () => {
    const r = parseWhatsAppWebhook(
      inboundEnvelope([
        {
          id: "wamid.sticker",
          from: "213555000000",
          timestamp: "1745849600",
          type: "sticker",
          sticker: { id: "media_st" },
        },
      ]),
    );
    expect(r.inbound[0]?.content).toBe("[sticker]");
    expect(r.inbound[0]?.contentType).toBe("TEXT");
  });
});

describe("parseWhatsAppWebhook — statuses", () => {
  it("projects a delivered status", () => {
    const r = parseWhatsAppWebhook(
      statusEnvelope([
        {
          id: "wamid.outgoing",
          status: "delivered",
          timestamp: "1745849700",
          recipient_id: "213555000000",
        },
      ]),
    );
    expect(r.statuses).toHaveLength(1);
    expect(r.inbound).toHaveLength(0);
    expect(r.statuses[0]).toEqual({
      phoneNumberId: PHONE_ID,
      providerMessageId: "wamid.outgoing",
      status: "delivered",
      timestamp: 1745849700,
    });
  });

  it("rejects an unknown status enum value", () => {
    expect(() =>
      parseWhatsAppWebhook(
        statusEnvelope([
          {
            id: "wamid.outgoing",
            status: "exploded", // not a valid status
            timestamp: "1745849700",
          },
        ]),
      ),
    ).toThrow();
  });
});

describe("parseWhatsAppWebhook — top-level shape", () => {
  it("throws on malformed envelope (missing entry)", () => {
    expect(() => parseWhatsAppWebhook({ object: "x" })).toThrow();
  });

  it("returns empty arrays when entry has no messages or statuses", () => {
    const r = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_ID },
              },
              field: "messages",
            },
          ],
        },
      ],
    });
    expect(r.inbound).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it("ignores additional unknown fields (passthrough)", () => {
    const r = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      __extra__: "future-field",
      entry: [
        {
          __more__: 1,
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_ID, display_phone_number: "+213" },
                messages: [
                  {
                    id: "wamid.x",
                    from: "213",
                    timestamp: "1745849600",
                    type: "text",
                    text: { body: "ok" },
                    __unknown__: true,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(r.inbound).toHaveLength(1);
  });
});
