import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

/**
 * bcrypt cost factor 12 lands a hash in ~150-300 ms on dev hardware.
 * We run a handful of hashes in this suite; total runtime stays under
 * a second. Vitest's default 5 s per-test timeout is plenty.
 */

describe("hashPassword + verifyPassword", () => {
  it("produces a bcrypt hash that round-trips against the plaintext", async () => {
    const hash = await hashPassword("S3cretP@ss!");
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
    expect(await verifyPassword("S3cretP@ss!", hash)).toBe(true);
  });

  it("rejects a wrong password against a real hash", async () => {
    const hash = await hashPassword("S3cretP@ss!");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces different hashes for the same input on each call (salted)", async () => {
    const a = await hashPassword("same-password-1");
    const b = await hashPassword("same-password-1");
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword("same-password-1", a)).toBe(true);
    expect(await verifyPassword("same-password-1", b)).toBe(true);
  });
});
