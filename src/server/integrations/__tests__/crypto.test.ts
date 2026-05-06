import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// Each test re-imports crypto.ts after mutating env so the module's
// getEncryptionKey() picks up the current value at call time. (The key
// is read inside encryptConfig/decryptConfig, not at module load, so a
// single import per test is fine — but keeping the dynamic-import shape
// makes any future "init at load" change loudly fail rather than
// silently cache the first env value.)
async function loadCrypto() {
  return import("../crypto");
}

const VALID_KEY = randomBytes(32).toString("base64");

describe("integrations/crypto", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.LIVE_DATA_ENCRYPTION_KEY;
    process.env.LIVE_DATA_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.LIVE_DATA_ENCRYPTION_KEY;
    } else {
      process.env.LIVE_DATA_ENCRYPTION_KEY = originalKey;
    }
  });

  it("round-trips plaintext through encrypt/decrypt", async () => {
    const { encryptConfig, decryptConfig } = await loadCrypto();
    const plaintext = JSON.stringify({
      url: "https://example.test",
      database: "demo",
      username: "user@example.test",
      password: "do-not-log-this",
    });
    const blob = encryptConfig(plaintext);
    expect(decryptConfig(blob)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (IV randomness)", async () => {
    const { encryptConfig } = await loadCrypto();
    const blob1 = encryptConfig("payload");
    const blob2 = encryptConfig("payload");
    expect(blob1).not.toBe(blob2);
  });

  it("throws on tampered ciphertext (auth tag validation)", async () => {
    const { encryptConfig, decryptConfig } = await loadCrypto();
    const blob = encryptConfig("payload");
    const buffer = Buffer.from(blob, "base64");
    // Flip the last ciphertext byte. The auth-tag check must fail.
    const lastIdx = buffer.length - 1;
    buffer[lastIdx] = (buffer[lastIdx]! ^ 0xff) & 0xff;
    const tampered = buffer.toString("base64");
    expect(() => decryptConfig(tampered)).toThrow();
  });

  it("throws when LIVE_DATA_ENCRYPTION_KEY is missing", async () => {
    delete process.env.LIVE_DATA_ENCRYPTION_KEY;
    const { encryptConfig } = await loadCrypto();
    expect(() => encryptConfig("payload")).toThrow(
      /LIVE_DATA_ENCRYPTION_KEY missing/,
    );
  });

  it("throws when LIVE_DATA_ENCRYPTION_KEY has wrong length", async () => {
    process.env.LIVE_DATA_ENCRYPTION_KEY = Buffer.from("too-short").toString(
      "base64",
    );
    const { encryptConfig } = await loadCrypto();
    expect(() => encryptConfig("payload")).toThrow(/must be 32 bytes/);
  });

  it("throws on truncated blob (shorter than iv+authTag)", async () => {
    const { decryptConfig } = await loadCrypto();
    expect(() => decryptConfig(Buffer.from("nope").toString("base64"))).toThrow(
      /too short/,
    );
  });
});
