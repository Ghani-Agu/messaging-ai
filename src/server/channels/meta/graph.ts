import "server-only";

/**
 * MetaGraphAdapter — shared concrete base for the real Meta Graph API
 * implementations (RealMessengerClient, RealInstagramClient).
 *
 * Owns the HTTP work that's identical across products:
 *   - validateAccessToken: GET /me with Bearer token
 *   - fetchPageDetails:    GET /{pageId}?fields=name,instagram_business_account{...}
 *   - subscribeWebhooks:   POST /{pageId}/subscribed_apps
 *   - sendMessage:         POST /{senderId}/messages
 *   - getProfile:          GET /{externalId}?fields=...
 *
 * Following CLAUDE.md §6: native `fetch` + explicit `AbortSignal.timeout()`,
 * no third-party HTTP-client SDK. Errors bubble as plain Error with
 * status + body context — the leaf clients' callers (outbound dispatch
 * hook, connect form) treat them as transient and stash failures into
 * aiMetadata via the same path Phase 6 uses.
 *
 * The base does NOT own:
 *   - HMAC verification (channel-agnostic free function in
 *     ./signatures.ts; the webhook handler in 7c calls it directly)
 *   - 24h window enforcement (channel-agnostic helper in
 *     ../policy.ts; the outbound-dispatch hook in 7d calls it before
 *     sendMessage)
 *
 * Leaf clients (RealMessengerClient, RealInstagramClient) compose a
 * MetaGraphAdapter rather than extending it — keeps the leaf surfaces
 * narrow and the shared HTTP code in one place.
 */

const DEFAULT_BASE_URL = "https://graph.facebook.com/v21.0";
const DEFAULT_TIMEOUT_MS = 15_000;

export type GraphPageDetails = {
  id: string;
  name: string;
  instagram_business_account?: {
    id: string;
    username?: string;
  };
};

export type GraphSendResult = {
  message_id: string;
  recipient_id?: string;
};

export class MetaGraphAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(args: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl =
      args.baseUrl ??
      process.env.META_GRAPH_BASE_URL ??
      DEFAULT_BASE_URL;
    this.timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * GET /me — proves a Page Access Token is valid and returns the
   * principal's Meta-side identity. Used by the connect-form preview
   * step (7e) to confirm the operator's pasted token works before
   * provisioning Channel rows.
   */
  async validateAccessToken(args: { token: string }): Promise<{ id: string; name?: string }> {
    return this.getJson<{ id: string; name?: string }>({
      path: "/me",
      query: { fields: "id,name" },
      token: args.token,
    });
  }

  /**
   * GET /{pageId}?fields=name,instagram_business_account{id,username}
   * Powers the connect-form preview: lets the UI surface "Detected:
   * Acme Page (Messenger) + @acme_official (Instagram)" before any
   * Channel row is created. instagram_business_account is absent if
   * the Page has no IG Business linked.
   */
  async fetchPageDetails(args: {
    pageId: string;
    token: string;
  }): Promise<GraphPageDetails> {
    return this.getJson<GraphPageDetails>({
      path: `/${encodeURIComponent(args.pageId)}`,
      query: { fields: "id,name,instagram_business_account{id,username}" },
      token: args.token,
    });
  }

  /**
   * POST /{pageId}/subscribed_apps?subscribed_fields=...
   * Subscribes the Page to the given webhook fields (messages,
   * messaging_postbacks, message_reads, etc). Idempotent — Meta returns
   * { success: true } whether the subscription is new or already
   * present.
   *
   * Stub mode skips this entirely — there's no real API to mock and no
   * security path to exercise (per Gate 1 H5).
   */
  async subscribeWebhooks(args: {
    pageId: string;
    token: string;
    subscribedFields: string[];
  }): Promise<void> {
    const path = `/${encodeURIComponent(args.pageId)}/subscribed_apps`;
    const url = this.buildUrl(path, {
      subscribed_fields: args.subscribedFields.join(","),
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable body>");
      throw new Error(
        `Meta subscribeWebhooks failed: HTTP ${res.status} ${res.statusText}: ${text}`,
      );
    }
  }

  /**
   * POST /{senderId}/messages — Send API. Used by both Messenger and
   * Instagram products at the same path with the same body shape; the
   * `senderId` differs (pageId for Messenger, igUserId for IG).
   *
   * Returns Meta's `{ message_id, recipient_id }`. The leaf client
   * surfaces only `message_id` to the outbound-dispatch hook as
   * `providerMessageId`.
   */
  async sendMessage(args: {
    senderId: string;
    recipientId: string;
    text: string;
    token: string;
  }): Promise<GraphSendResult> {
    const path = `/${encodeURIComponent(args.senderId)}/messages`;
    const url = this.buildUrl(path, {});
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        recipient: { id: args.recipientId },
        message: { text: args.text },
        messaging_type: "RESPONSE",
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable body>");
      throw new Error(
        `Meta sendMessage failed: HTTP ${res.status} ${res.statusText}: ${text}`,
      );
    }
    const json = (await res.json()) as Partial<GraphSendResult>;
    if (!json.message_id) {
      throw new Error(
        `Meta sendMessage returned 2xx without message_id: ${JSON.stringify(json)}`,
      );
    }
    return { message_id: json.message_id, recipient_id: json.recipient_id };
  }

  /**
   * GET /{externalId}?fields=... — fetch profile metadata. Best-effort:
   * returns null on any non-2xx so the webhook handler can fall through
   * with a null name + the raw external id (PSID/IGSID) as the
   * Customer.externalId.
   *
   * Synchronous in the webhook handler per Gate 1 H6 — adds ~100-300ms
   * per first message from a new customer. Phase 8/9 swap point if perf
   * bites at scale; the call site is the only place that knows the
   * tradeoff.
   */
  async getProfile<T extends Record<string, unknown>>(args: {
    externalId: string;
    token: string;
    fields: string[];
  }): Promise<T | null> {
    try {
      return await this.getJson<T>({
        path: `/${encodeURIComponent(args.externalId)}`,
        query: { fields: args.fields.join(",") },
        token: args.token,
      });
    } catch (err) {
      console.warn(
        `[meta] getProfile failed for ${args.externalId}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async getJson<T>(args: {
    path: string;
    query: Record<string, string>;
    token: string;
  }): Promise<T> {
    const url = this.buildUrl(args.path, args.query);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable body>");
      throw new Error(
        `Meta GET ${args.path} failed: HTTP ${res.status} ${res.statusText}: ${text}`,
      );
    }
    return (await res.json()) as T;
  }

  private buildUrl(path: string, query: Record<string, string>): string {
    const url = new URL(this.baseUrl.replace(/\/+$/, "") + path);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  }
}
