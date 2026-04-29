import "server-only";
import type { Channel } from "@prisma/client";
import type { WhatsAppCredentials } from "@/lib/validators";
import type { WhatsAppClient, WhatsAppClientArgs } from "./client";

/**
 * 360dialog implementation of the WhatsApp client.
 *
 * 360dialog is a BSP that exposes Meta's WhatsApp Cloud API at a
 * 360dialog-hosted base URL, authenticated with a per-channel API key
 * sent as the `D360-API-KEY` header. Payload shapes are Meta-shape
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages).
 *
 * Following CLAUDE.md §6: native `fetch` + explicit `AbortSignal.timeout()`,
 * no third-party HTTP-client SDK. Errors are categorized:
 *   - 4xx (except 429) → throw a non-retryable error; the brain has done
 *     its work and the operator needs to fix the channel config.
 *   - 5xx / 429 / network / AbortError → throw a plain Error that the
 *     outbound hook in 6d treats as transient and surfaces in
 *     aiMetadata.outboundSendError without retry-spamming the customer.
 *     (The retry/outbox pattern lands in Phase 6.5.)
 *
 * Keys land ~T+8h. Until then `getWhatsAppClient` falls back to
 * `StubWhatsAppClient` automatically when WHATSAPP_360DIALOG_API_KEY
 * is unset (or when WHATSAPP_USE_STUB === "true"). This file ships
 * as the real implementation; flipping a single env var swaps it in.
 */

const DEFAULT_BASE_URL = "https://waba-v2.360dialog.io";
const SEND_TIMEOUT_MS = 15_000;

export class ThreesixtydialogClient implements WhatsAppClient {
  private readonly channel: Channel;
  private readonly credentials: WhatsAppCredentials;
  private readonly baseUrl: string;

  constructor(args: WhatsAppClientArgs) {
    this.channel = args.channel;
    this.credentials = args.credentials;
    this.baseUrl = process.env.WHATSAPP_360DIALOG_BASE_URL ?? DEFAULT_BASE_URL;
  }

  async sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }> {
    const { to, content } = args;

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: content, preview_url: false },
    };

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "D360-API-KEY": this.credentials.apiToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable body>");
      // 4xx (except 429) is the non-retryable bucket per CLAUDE.md §6.
      // We don't have a retry path in 6d (Phase 6 is at-least-zero
      // delivery), so all upstream failures bubble the same way for
      // now — the outbound hook stashes the error in aiMetadata.
      throw new Error(
        `360dialog send failed: HTTP ${res.status} ${res.statusText}: ${text}`,
      );
    }

    const json = (await res.json()) as {
      messages?: Array<{ id?: string }>;
    };
    const providerMessageId = json.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new Error(
        `360dialog send returned 2xx without a messages[0].id: ${JSON.stringify(json)}`,
      );
    }
    return { providerMessageId };
  }

  async getProfile(_args: {
    phoneNumber: string;
  }): Promise<{ name?: string } | null> {
    // 360dialog delivers customer profile data in the inbound webhook
    // payload (entry[].changes[].value.contacts[].profile.name). The
    // webhook handler in 6c populates Customer.name from there. There's
    // no fetch-on-demand path that's reliable across all WABA tiers, so
    // this returns null and we rely on the webhook-side population.
    void this;
    return null;
  }
}
