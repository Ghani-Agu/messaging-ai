import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUB_META_APP_SECRET,
  _resetMetaAppSecretWarnFlagForTests,
  getMetaAppSecret,
  signMetaPayload,
  verifyMetaSignature,
} from "./signatures";

const SECRET = "test_meta_app_secret_min_16_chars";
const PAYLOAD = JSON.stringify({
  object: "page",
  entry: [{ id: "PAGE_TEST", messaging: [] }],
});

describe("signMetaPayload", () => {
  it("produces the sha256= prefixed hex MAC", () => {
    const sig = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for a given (body, secret)", () => {
    const a = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    const b = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(a).toBe(b);
  });

  it("changes when the body or secret changes", () => {
    const base = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(
      signMetaPayload({ rawBody: PAYLOAD + " ", secret: SECRET }),
    ).not.toBe(base);
    expect(
      signMetaPayload({ rawBody: PAYLOAD, secret: SECRET + "_alt" }),
    ).not.toBe(base);
  });
});

describe("verifyMetaSignature", () => {
  it("accepts a signature produced by signMetaPayload", () => {
    const sig = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(
      verifyMetaSignature({
        rawBody: PAYLOAD,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a signature signed with a different secret", () => {
    const sig = signMetaPayload({ rawBody: PAYLOAD, secret: "other" });
    expect(
      verifyMetaSignature({
        rawBody: PAYLOAD,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a tampered body even with a previously-valid signature", () => {
    const sig = signMetaPayload({ rawBody: PAYLOAD, secret: SECRET });
    expect(
      verifyMetaSignature({
        rawBody: PAYLOAD + " tampered",
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects missing / null / empty / no-prefix headers", () => {
    for (const bad of [null, undefined, "", "abc123", "abc123def"] as const) {
      expect(
        verifyMetaSignature({
          rawBody: PAYLOAD,
          signatureHeader: bad,
          secret: SECRET,
        }),
      ).toBe(false);
    }
  });

  it("rejects garbage hex of correct length without throwing", () => {
    expect(
      verifyMetaSignature({
        rawBody: PAYLOAD,
        signatureHeader: "sha256=" + "f".repeat(64),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects header of wrong length without throwing on timingSafeEqual", () => {
    expect(
      verifyMetaSignature({
        rawBody: PAYLOAD,
        signatureHeader: "sha256=abc",
        secret: SECRET,
      }),
    ).toBe(false);
  });
});

describe("getMetaAppSecret", () => {
  // process.env entries (incl. NODE_ENV) are typed readonly by
  // @types/node. Use Reflect.deleteProperty for actual deletion (setting
  // = undefined coerces to the literal string "undefined" which the
  // accessor would treat as set), and a Record cast for assignments.
  const env = process.env as unknown as Record<string, string>;
  const deleteEnv = (k: string) => Reflect.deleteProperty(process.env, k);

  beforeEach(() => {
    _resetMetaAppSecretWarnFlagForTests();
    deleteEnv("META_APP_SECRET");
    deleteEnv("NODE_ENV");
  });
  afterEach(() => {
    _resetMetaAppSecretWarnFlagForTests();
    deleteEnv("META_APP_SECRET");
    deleteEnv("NODE_ENV");
    vi.restoreAllMocks();
  });

  it("returns env value when set", () => {
    env.META_APP_SECRET = "real_meta_secret_xyz";
    expect(getMetaAppSecret()).toBe("real_meta_secret_xyz");
  });

  it("falls back to STUB_META_APP_SECRET in dev with a one-time warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getMetaAppSecret()).toBe(STUB_META_APP_SECRET);
    expect(getMetaAppSecret()).toBe(STUB_META_APP_SECRET);
    expect(warn).toHaveBeenCalledTimes(1); // one-time warn flag
  });

  it("throws when unset in production", () => {
    env.NODE_ENV = "production";
    expect(() => getMetaAppSecret()).toThrow(/required in production/);
  });

  it("rejects empty-string env value as if unset", () => {
    env.META_APP_SECRET = "";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getMetaAppSecret()).toBe(STUB_META_APP_SECRET);
  });
});
