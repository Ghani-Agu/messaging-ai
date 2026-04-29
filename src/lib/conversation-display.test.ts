import { describe, expect, it } from "vitest";
import {
  buildConversationHeaderMetadata,
  customerDisplayLabel,
  customerInitial,
} from "./conversation-display";

// ─────────────────────────────────────────────────────────────────────────────
// customerDisplayLabel
// ─────────────────────────────────────────────────────────────────────────────

describe("customerDisplayLabel", () => {
  it("returns the stored name when present, regardless of channel", () => {
    expect(
      customerDisplayLabel({
        name: "Khalil Boualem",
        externalId: "1234567890",
        channelType: "MESSENGER",
      }),
    ).toBe("Khalil Boualem");
    expect(
      customerDisplayLabel({
        name: "Khalil Boualem",
        externalId: "9876543210",
        channelType: "INSTAGRAM",
      }),
    ).toBe("Khalil Boualem");
    expect(
      customerDisplayLabel({
        name: "Khalil Boualem",
        externalId: "widget:abc",
        channelType: "WIDGET",
      }),
    ).toBe("Khalil Boualem");
  });

  it("MESSENGER null name → 'PSID: <truncated>' (preserves PSIDs ≤12 chars)", () => {
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "1234567890",
        channelType: "MESSENGER",
      }),
    ).toBe("PSID: 1234567890");
  });

  it("MESSENGER null name with long PSID → truncates with ellipsis", () => {
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "1234567890123456789",
        channelType: "MESSENGER",
      }),
    ).toBe("PSID: 123456789012…");
  });

  it("INSTAGRAM null name → 'IGSID: <truncated>'", () => {
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "9988776655",
        channelType: "INSTAGRAM",
      }),
    ).toBe("IGSID: 9988776655");
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "9988776655443322110",
        channelType: "INSTAGRAM",
      }),
    ).toBe("IGSID: 998877665544…");
  });

  it("treats empty-string names as null", () => {
    expect(
      customerDisplayLabel({
        name: "",
        externalId: "1234567890",
        channelType: "MESSENGER",
      }),
    ).toBe("PSID: 1234567890");
  });

  it("WIDGET null name preserves the widget:<uuid> truncation rule", () => {
    // Widget UUIDs are 36 chars + the "widget:" prefix.
    const longId = "widget:abcdef01-2345-6789-abcd-ef0123456789";
    expect(
      customerDisplayLabel({
        name: null,
        externalId: longId,
        channelType: "WIDGET",
      }),
    ).toBe("widget:abcdef01-2345-6…");
    // Short widget id passes through unchanged.
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "widget:abc",
        channelType: "WIDGET",
      }),
    ).toBe("widget:abc");
  });

  it("WHATSAPP null name returns the wa_id digits as-is", () => {
    expect(
      customerDisplayLabel({
        name: null,
        externalId: "213555111222",
        channelType: "WHATSAPP",
      }),
    ).toBe("213555111222");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// customerInitial
// ─────────────────────────────────────────────────────────────────────────────

describe("customerInitial", () => {
  it("uses the first letter of the name, uppercased", () => {
    expect(customerInitial({ name: "khalil", externalId: "x" })).toBe("K");
  });

  it("falls back to the externalId past any namespace prefix", () => {
    expect(
      customerInitial({ name: null, externalId: "widget:abc123" }),
    ).toBe("A");
    expect(customerInitial({ name: null, externalId: "1234567890" })).toBe(
      "1",
    );
  });

  it("returns '?' when nothing usable is available", () => {
    expect(customerInitial({ name: null, externalId: "widget:" })).toBe("?");
    expect(customerInitial({ name: "", externalId: "" })).toBe("?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConversationHeaderMetadata
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConversationHeaderMetadata", () => {
  it("WHATSAPP shows operator displayName + customer phone (E.164)", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "WHATSAPP",
      channelDisplayName: "Acme WhatsApp",
      channelConfig: { provider: "threesixtydialog", phoneNumberId: "wa_id" },
      customerPhone: "+213555111222",
      customerExternalId: "213555111222",
    });
    expect(meta).toEqual({
      channelLabel: "Acme WhatsApp",
      contextLabel: "+213555111222",
    });
  });

  it("WHATSAPP without phone falls back to externalId", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "WHATSAPP",
      channelDisplayName: "Acme WhatsApp",
      channelConfig: {},
      customerPhone: null,
      customerExternalId: "213555111222",
    });
    expect(meta.contextLabel).toBe("213555111222");
  });

  it("MESSENGER reads pageName from Channel.config + PSID context", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "MESSENGER",
      channelDisplayName: "Operator Display",
      channelConfig: {
        provider: "meta-cloud",
        pageId: "PAGE_TEST",
        pageName: "Acme Algeria",
      },
      customerPhone: null,
      customerExternalId: "1234567890",
    });
    expect(meta).toEqual({
      channelLabel: "Acme Algeria",
      contextLabel: "PSID: 1234567890",
    });
  });

  it("MESSENGER falls back to channelDisplayName when config is malformed", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "MESSENGER",
      channelDisplayName: "Fallback Display",
      channelConfig: null,
      customerPhone: null,
      customerExternalId: "1234567890",
    });
    expect(meta.channelLabel).toBe("Fallback Display");
  });

  it("INSTAGRAM reads igUsername from Channel.config and prefixes with @", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "INSTAGRAM",
      channelDisplayName: "Operator Display",
      channelConfig: {
        provider: "meta-cloud",
        igUserId: "IG_TEST",
        igUsername: "acme_official",
        pageId: "PAGE_TEST",
      },
      customerPhone: null,
      customerExternalId: "9988776655",
    });
    expect(meta).toEqual({
      channelLabel: "@acme_official",
      contextLabel: "IGSID: 9988776655",
    });
  });

  it("INSTAGRAM without igUsername falls back to channelDisplayName", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "INSTAGRAM",
      channelDisplayName: "Acme IG",
      channelConfig: { igUserId: "IG_TEST", pageId: "PAGE_TEST" },
      customerPhone: null,
      customerExternalId: "9988776655",
    });
    expect(meta.channelLabel).toBe("Acme IG");
  });

  it("WIDGET shows displayName + raw externalId", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "WIDGET",
      channelDisplayName: "Website chat",
      channelConfig: { publicKey: "wgt_pk_…" },
      customerPhone: null,
      customerExternalId: "widget:abcdef-0123",
    });
    expect(meta).toEqual({
      channelLabel: "Website chat",
      contextLabel: "widget:abcdef-0123",
    });
  });

  it("Meta channels truncate long externalIds in the context label", () => {
    const meta = buildConversationHeaderMetadata({
      channelType: "INSTAGRAM",
      channelDisplayName: "Acme IG",
      channelConfig: { igUsername: "acme" },
      customerPhone: null,
      customerExternalId: "9988776655443322110",
    });
    expect(meta.contextLabel).toBe("IGSID: 998877665544…");
  });
});
