import "server-only";
import bcrypt from "bcryptjs";

/**
 * Password hashing helpers. Wraps bcryptjs so the cost factor lives in
 * one place and call sites stay one-liners.
 *
 * Cost factor 12 — Auth0 / OWASP guidance for 2024+. Targets ~250 ms
 * hash time on a modern CPU; high enough to slow brute force, low
 * enough not to DoS the auth route under normal traffic. Bump to 13
 * if hardware speeds up substantially before the next rev.
 *
 * bcryptjs (pure JS, no native bindings) over node-bcrypt: Windows dev
 * doesn't need node-gyp, and migrations between providers stay clean.
 * The performance gap is real (~3-5× slower) but immaterial at our
 * login volume.
 */

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
