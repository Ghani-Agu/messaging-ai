import { describe, expect, it } from "vitest";
import {
  signWhatsAppPayload,
  verifyWhatsAppSignature,
} from "./signatures";

const SECRET = "test_webhook_secret_min_16_chars";
const PAYLOAD = JSON.stringify({
  entry: [{ changes: [{ value: { messaging_product: "whatsapp" } }] }],
});

describe("signWhatsAppPayload", () => {
  it("produces the sha256= prefixed hex MAC", () => {
    const sig = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for a given (body, secret)", () => {
    const a = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    const b = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(a).toBe(b);
  });

  it("changes when the body changes", () => {
    const a = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    const b = signWhatsAppPayload({
      rawBody: PAYLOAD + " ",
      secret: SECRET,
    });
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", () => {
    const a = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    const b = signWhatsAppPayload({
      rawBody: PAYLOAD,
      secret: SECRET + "_alt",
    });
    expect(a).not.toBe(b);
  });
});

describe("verifyWhatsAppSignature", () => {
  it("accepts a signature produced by signWhatsAppPayload", () => {
    const sig = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a signature signed with a different secret", () => {
    const sig = signWhatsAppPayload({ rawBody: PAYLOAD, secret: "other" });
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a tampered body even with a valid (for the original) signature", () => {
    const sig = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD + " tampered",
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature header (null / undefined / empty)", () => {
    for (const missing of [null, undefined, ""] as const) {
      expect(
        verifyWhatsAppSignature({
          rawBody: PAYLOAD,
          signatureHeader: missing,
          secret: SECRET,
        }),
      ).toBe(false);
    }
  });

  it("rejects a header without the sha256= prefix", () => {
    const sig = signWhatsAppPayload({ rawBody: PAYLOAD, secret: SECRET });
    const noPrefix = sig.replace(/^sha256=/, "");
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD,
        signatureHeader: noPrefix,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a header of wrong length (without throwing on timingSafeEqual)", () => {
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD,
        signatureHeader: "sha256=abc",
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects garbage hex of the right length", () => {
    expect(
      verifyWhatsAppSignature({
        rawBody: PAYLOAD,
        signatureHeader: "sha256=" + "f".repeat(64),
        secret: SECRET,
      }),
    ).toBe(false);
  });
});
