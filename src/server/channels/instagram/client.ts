import "server-only";
import type { MetaClientArgs, MetaGraphClient } from "../meta/client";
import { RealInstagramClient } from "./meta-cloud";
import { StubInstagramClient } from "./stub";

/**
 * Instagram client interface + factory.
 *
 * Extends `MetaGraphClient` with an Instagram-shape `getProfile` —
 * Instagram-Scoped IDs (IGSIDs) resolve to the customer's @username
 * (the primary IG identifier) and full name when available.
 */
export interface InstagramClient extends MetaGraphClient {
  /**
   * Fetch an Instagram customer's profile. Best-effort; returns null on
   * miss (private profile, deleted account, etc). Used by the webhook
   * handler in 7c to populate `Customer.name` on first inbound message
   * from a new IGSID.
   */
  getProfile(args: { igsid: string }): Promise<{
    username?: string;
    name?: string;
  } | null>;
}

/**
 * Same stub-fallback logic as Messenger:
 *
 *   1. META_USE_STUB === "true"  → Stub.
 *   2. META_APP_ID unset         → Stub (auto-fallback).
 *   3. otherwise                  → RealInstagramClient.
 */
export function getInstagramClient(args: MetaClientArgs): InstagramClient {
  const explicitStub = process.env.META_USE_STUB === "true";
  const noAppId = !process.env.META_APP_ID;
  if (explicitStub || noAppId) {
    return new StubInstagramClient(args);
  }
  return new RealInstagramClient(args);
}
