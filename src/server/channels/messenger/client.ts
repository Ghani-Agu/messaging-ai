import "server-only";
import type { MetaClientArgs, MetaGraphClient } from "../meta/client";
import { RealMessengerClient } from "./meta-cloud";
import { StubMessengerClient } from "./stub";

/**
 * Messenger client interface + factory.
 *
 * Extends `MetaGraphClient` with a Messenger-shape `getProfile` —
 * Page-scoped IDs (PSIDs) resolve to first/last name when the customer
 * has granted that permission to the Page.
 */
export interface MessengerClient extends MetaGraphClient {
  /**
   * Fetch a Messenger customer's profile. Best-effort; returns null on
   * miss (private profile, deleted account, etc). Used by the webhook
   * handler in 7c to populate `Customer.name` on first inbound message
   * from a new PSID.
   */
  getProfile(args: { psid: string }): Promise<{
    firstName?: string;
    lastName?: string;
  } | null>;
}

/**
 * Resolve the right MessengerClient implementation. Stub fallback
 * mirrors the Phase 6 WhatsApp pattern:
 *
 *   1. META_USE_STUB === "true"  → Stub (explicit dev override).
 *   2. META_APP_ID unset         → Stub (auto-fallback so the system
 *                                  still runs end-to-end before real
 *                                  Meta credentials land).
 *   3. otherwise                  → RealMessengerClient.
 *
 * Stub stays runnable post-credentials so CI / E2E tests don't burn
 * real Messenger sends. CLAUDE.md §6 documents the toggle.
 */
export function getMessengerClient(args: MetaClientArgs): MessengerClient {
  const explicitStub = process.env.META_USE_STUB === "true";
  const noAppId = !process.env.META_APP_ID;
  if (explicitStub || noAppId) {
    return new StubMessengerClient(args);
  }
  return new RealMessengerClient(args);
}
