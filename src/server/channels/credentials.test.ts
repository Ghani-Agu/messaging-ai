import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetEncryptionKeyCacheForTests,
  decryptCredentials,
  encryptCredentials,
  isEncryptedCredentials,
  type EncryptedCredentials,
} from "./credentials";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("credentials AES-256-GCM", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    _resetEncryptionKeyCacheForTests();
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    _resetEncryptionKeyCacheForTests();
  });

  it("round-trips a credential object", () => {
    const plain = { apiToken: "tok_abc123", webhookSecret: "wh_xyz789" };
    const enc = encryptCredentials(plain);
    expect(enc.v).toBe(1);
    expect(enc.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(enc.tag).toMatch(/^[0-9a-f]{32}$/);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(decryptCredentials(enc)).toEqual(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const plain = { apiToken: "same", webhookSecret: "same" };
    const a = encryptCredentials(plain);
    const b = encryptCredentials(plain);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    // But both round-trip to the same plaintext.
    expect(decryptCredentials(a)).toEqual(plain);
    expect(decryptCredentials(b)).toEqual(plain);
  });

  it("rejects a tampered ciphertext", () => {
    const enc = encryptCredentials({ apiToken: "x" });
    // Flip one byte in the ciphertext (base64-decode, mutate, re-encode).
    const ct = Buffer.from(enc.ciphertext, "base64");
    ct[0] = (ct[0]! ^ 0xff) & 0xff;
    const tampered: EncryptedCredentials = {
      ...enc,
      ciphertext: ct.toString("base64"),
    };
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const enc = encryptCredentials({ apiToken: "x" });
    const tag = Buffer.from(enc.tag, "hex");
    tag[0] = (tag[0]! ^ 0xff) & 0xff;
    const tampered: EncryptedCredentials = {
      ...enc,
      tag: tag.toString("hex"),
    };
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it("rejects unknown envelope version", () => {
    const enc = encryptCredentials({ apiToken: "x" });
    const bad = { ...enc, v: 99 } as unknown as EncryptedCredentials;
    expect(() => decryptCredentials(bad)).toThrow(/version/i);
  });

  it("rejects malformed envelope fields", () => {
    expect(() =>
      decryptCredentials({
        v: 1,
        iv: "short",
        tag: "f".repeat(32),
        ciphertext: "AAAA",
      }),
    ).toThrow(/iv/);
    expect(() =>
      decryptCredentials({
        v: 1,
        iv: "0".repeat(24),
        tag: "short",
        ciphertext: "AAAA",
      }),
    ).toThrow(/tag/);
    expect(() =>
      decryptCredentials({
        v: 1,
        iv: "0".repeat(24),
        tag: "0".repeat(32),
        ciphertext: "",
      }),
    ).toThrow(/ciphertext/);
  });

  it("throws when ENCRYPTION_KEY is missing", () => {
    delete process.env.ENCRYPTION_KEY;
    _resetEncryptionKeyCacheForTests();
    expect(() => encryptCredentials({ x: 1 })).toThrow(/not set/);
  });

  it("throws when ENCRYPTION_KEY is wrong length", () => {
    process.env.ENCRYPTION_KEY = "abcd";
    _resetEncryptionKeyCacheForTests();
    expect(() => encryptCredentials({ x: 1 })).toThrow(/64 hex chars/);
  });

  it("throws when ENCRYPTION_KEY is non-hex", () => {
    process.env.ENCRYPTION_KEY = "z".repeat(64);
    _resetEncryptionKeyCacheForTests();
    expect(() => encryptCredentials({ x: 1 })).toThrow(/64 hex chars/);
  });

  describe("isEncryptedCredentials type guard", () => {
    it("recognizes a valid envelope", () => {
      const enc = encryptCredentials({ x: 1 });
      expect(isEncryptedCredentials(enc)).toBe(true);
    });
    it("rejects empty object (widget channel shape)", () => {
      expect(isEncryptedCredentials({})).toBe(false);
    });
    it("rejects null / undefined / strings", () => {
      expect(isEncryptedCredentials(null)).toBe(false);
      expect(isEncryptedCredentials(undefined)).toBe(false);
      expect(isEncryptedCredentials("string")).toBe(false);
    });
    it("rejects partial envelope", () => {
      expect(isEncryptedCredentials({ v: 1, iv: "x" })).toBe(false);
    });
  });
});
