import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption helper for `Channel.credentials`.
 *
 * Channel-family-agnostic: WhatsApp / IG / FB / future channels with
 * provider secrets all use the same envelope. The widget channel keeps
 * `Channel.credentials = {}` (no secrets to store) and skips this helper.
 *
 * Envelope shape stored in the JSON column:
 *   { v: 1, iv: <hex-24>, tag: <hex-32>, ciphertext: <base64> }
 *
 * Why GCM and not just CBC: GCM gives authenticated encryption — the
 * decryption step verifies the auth tag and rejects tampering with the
 * ciphertext or IV. CBC would let an attacker mutate ciphertext bits
 * undetected.
 *
 * Key source: process.env.ENCRYPTION_KEY, 64 hex chars (32 bytes).
 * Generate with: `openssl rand -hex 32`. Required in dev and prod;
 * MASTER_PLAN §11 already lists it as a required env var.
 *
 * Versioning: the `v: 1` field reserves the upgrade path. Future
 * versions (key rotation, alternate algorithms) can be added without
 * breaking reads of v1 blobs — decryptCredentials switches on `v`.
 *
 * Threat model:
 *   - Protects credentials at rest (DB backups, replicas, snapshots).
 *   - Does NOT protect against an attacker who can read process.env
 *     (since the key lives there). Phase 10 deployment moves this into
 *     a secrets manager.
 *   - Does NOT protect against an attacker with write access to
 *     Channel.credentials (they can replace blobs, though decryption
 *     of their forged blob will fail unless they also have the key).
 */

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — recommended for GCM
const HEX_KEY_LEN = KEY_BYTES * 2;
const HEX_IV_LEN = IV_BYTES * 2;
const HEX_TAG_LEN = 32; // 16 bytes / 128 bits — GCM default

export type EncryptedCredentials = {
  v: 1;
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // base64
};

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set — required for Channel.credentials encryption",
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length !== HEX_KEY_LEN) {
    throw new Error(
      `ENCRYPTION_KEY must be ${HEX_KEY_LEN} hex chars (${KEY_BYTES} bytes); got length ${raw.length}`,
    );
  }
  cachedKey = Buffer.from(raw, "hex");
  return cachedKey;
}

/**
 * Reset the cached key. Test-only — production never rotates the in-process
 * key. Exported as a named export to avoid bundler tree-shaking surprises.
 */
export function _resetEncryptionKeyCacheForTests(): void {
  cachedKey = null;
}

export function encryptCredentials<T extends object>(
  plaintext: T,
): EncryptedCredentials {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(plaintext);
  const encrypted = Buffer.concat([
    cipher.update(json, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("base64"),
  };
}

export function decryptCredentials<T extends object>(
  blob: EncryptedCredentials,
): T {
  if (blob.v !== 1) {
    throw new Error(`unsupported credentials envelope version: ${String(blob.v)}`);
  }
  if (typeof blob.iv !== "string" || blob.iv.length !== HEX_IV_LEN) {
    throw new Error("malformed credentials envelope: iv");
  }
  if (typeof blob.tag !== "string" || blob.tag.length !== HEX_TAG_LEN) {
    throw new Error("malformed credentials envelope: tag");
  }
  if (typeof blob.ciphertext !== "string" || blob.ciphertext.length === 0) {
    throw new Error("malformed credentials envelope: ciphertext");
  }
  const key = getKey();
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // .final() throws on auth-tag mismatch — that's the tamper detection.
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/**
 * Type-guard: is the value the EncryptedCredentials envelope shape?
 * Used by Channel reads to distinguish encrypted blobs from the empty
 * `{}` widget shape and from any legacy/unmigrated rows.
 */
export function isEncryptedCredentials(
  value: unknown,
): value is EncryptedCredentials {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.ciphertext === "string"
  );
}
