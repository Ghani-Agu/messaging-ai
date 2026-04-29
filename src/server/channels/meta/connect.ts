import "server-only";
import {
  MetaGraphAdapter,
  type GraphPageDetails,
} from "./graph";

/**
 * Pre-channel Meta Graph client for the connect flow.
 *
 * Difference from MessengerClient / InstagramClient (the leaf clients used
 * by inbound + outbound dispatch): the connect form runs BEFORE any
 * Channel row exists — there's no `channel.config` to read pageId from,
 * no `channel.credentials` envelope to decrypt. The operator has just
 * pasted a raw Page Access Token. So this client takes the token directly
 * as a parameter on each method call instead of constructing against a
 * Channel row.
 *
 * Three operations powering the connect flow + post-connect test button:
 *
 *   - validateAccessToken — confirms the token is live and returns the
 *     Page principal's identity (the pageId we then pivot off).
 *   - fetchPageDetails    — projects /<pageId>?fields=name,instagram_
 *                           business_account → page name + linked IG
 *                           business account (if any).
 *   - subscribeWebhooks   — registers the Page for the webhook fields we
 *                           consume on /api/meta/webhook. Idempotent on
 *                           Meta's side (returns success whether the
 *                           subscription is new or already present).
 *
 * Stub fallback follows the leaf-factory pattern — META_USE_STUB=true OR
 * unset META_APP_ID returns a StubMetaConnectClient that returns canned
 * preview data and no-ops on subscribeWebhooks (no real API to mock; per
 * Gate 1 H5). Lets the connect form work end-to-end in dev with no real
 * Meta credentials.
 */

export interface MetaConnectClient {
  validateAccessToken(args: {
    token: string;
  }): Promise<{ id: string; name?: string }>;

  fetchPageDetails(args: {
    pageId: string;
    token: string;
  }): Promise<GraphPageDetails>;

  subscribeWebhooks(args: {
    pageId: string;
    token: string;
    subscribedFields: string[];
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real implementation — wraps MetaGraphAdapter
// ─────────────────────────────────────────────────────────────────────────────

class RealMetaConnectClient implements MetaConnectClient {
  private readonly graph: MetaGraphAdapter;
  constructor() {
    this.graph = new MetaGraphAdapter();
  }
  validateAccessToken(args: { token: string }) {
    return this.graph.validateAccessToken(args);
  }
  fetchPageDetails(args: { pageId: string; token: string }) {
    return this.graph.fetchPageDetails(args);
  }
  subscribeWebhooks(args: {
    pageId: string;
    token: string;
    subscribedFields: string[];
  }) {
    return this.graph.subscribeWebhooks(args);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub implementation — canned preview data, no-op subscribe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic canned data the stub returns. Matches the values from
 * Gate 1's stub-handling section so the dev preview always shows the
 * same Page name + IG handle regardless of which token the operator
 * pasted. Page id is stable so re-running the preview resolves to the
 * same Channel row on confirm.
 */
const STUB_PAGE_ID = "STUB_PAGE_100000";
const STUB_PAGE_NAME = "Stub FB Page";
const STUB_IG_USER_ID = "STUB_IG_17841";
const STUB_IG_USERNAME = "stub_ig";

class StubMetaConnectClient implements MetaConnectClient {
  async validateAccessToken(_args: {
    token: string;
  }): Promise<{ id: string; name?: string }> {
    void _args;
    return { id: STUB_PAGE_ID, name: STUB_PAGE_NAME };
  }
  async fetchPageDetails(_args: {
    pageId: string;
    token: string;
  }): Promise<GraphPageDetails> {
    void _args;
    return {
      id: STUB_PAGE_ID,
      name: STUB_PAGE_NAME,
      instagram_business_account: {
        id: STUB_IG_USER_ID,
        username: STUB_IG_USERNAME,
      },
    };
  }
  async subscribeWebhooks(_args: {
    pageId: string;
    token: string;
    subscribedFields: string[];
  }): Promise<void> {
    // No-op per Gate 1 H5 — there's no real API to mock and no security
    // path to exercise. The real client's subscribeWebhooks is the only
    // place the webhook-field registration happens; in stub mode the
    // /api/meta/webhook route receives stub-fired events directly from
    // the StubMessengerClient / StubInstagramClient delivery callbacks.
    void _args;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the right MetaConnectClient implementation. Same routing as
 * the leaf factories (getMessengerClient / getInstagramClient):
 *
 *   1. META_USE_STUB === "true"  → Stub (explicit dev override).
 *   2. META_APP_ID unset         → Stub (auto-fallback).
 *   3. otherwise                 → RealMetaConnectClient.
 *
 * Operator-pasted token is passed per-call, not at construction — the
 * connect form has nothing else to construct against, and using the same
 * client for multiple validateAccessToken calls would conflate token
 * scopes anyway.
 */
export function getMetaConnectClient(): MetaConnectClient {
  const explicitStub = process.env.META_USE_STUB === "true";
  const noAppId = !process.env.META_APP_ID;
  if (explicitStub || noAppId) {
    return new StubMetaConnectClient();
  }
  return new RealMetaConnectClient();
}

// Exported for tests.
export const STUB_CONNECT_PREVIEW = {
  pageId: STUB_PAGE_ID,
  pageName: STUB_PAGE_NAME,
  igUserId: STUB_IG_USER_ID,
  igUsername: STUB_IG_USERNAME,
} as const;
