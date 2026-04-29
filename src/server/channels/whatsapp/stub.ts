import "server-only";
import { mkdir, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import {
  parseWhatsAppChannelConfig,
  type WhatsAppChannelConfig,
  type WhatsAppCredentials,
} from "@/lib/validators";
import type { WhatsAppClient, WhatsAppClientArgs } from "./client";
import { signWhatsAppPayload } from "./signatures";

/**
 * Stub implementation of the WhatsApp client. Used in dev (forced via
 * WHATSAPP_USE_STUB=true) and as the auto-fallback when no
 * WHATSAPP_360DIALOG_API_KEY is set, so the system runs end-to-end
 * before real keys land. Kept runnable post-credentials for CI / E2E
 * tests that shouldn't burn real WhatsApp messages.
 *
 * Two side effects per sendMessage:
 *
 *   1. JSONL append to .stub-deliveries/whatsapp.jsonl — local-only
 *      log so dev can inspect simulated outbound traffic. Best-effort
 *      (warns and continues on FS failure). Path is gitignored.
 *
 *   2. 500ms-delayed POST to /api/whatsapp/webhook synthesizing a
 *      Meta-shape status update with `status: "delivered"`, signed
 *      with the channel's stored webhookSecret using the real HMAC
 *      path. The signature verification flow is exercised the same
 *      way real webhooks will exercise it — no bypass.
 *
 * Why no bypass on signature: "skip verification when stub" is the bug
 * pattern that hides regressions in the verification path until a
 * production webhook starts failing. Same secret + same code path in
 * dev = the path is exercised every time, and the only thing that
 * changes when keys arrive is the secret value.
 */

const DELIVERY_CALLBACK_DELAY_MS = 500;
const DELIVERY_LOG_DIR = ".stub-deliveries";
const DELIVERY_LOG_FILE = "whatsapp.jsonl";
const DELIVERY_CALLBACK_TIMEOUT_MS = 5_000;

export class StubWhatsAppClient implements WhatsAppClient {
  private readonly channel: Channel;
  private readonly credentials: WhatsAppCredentials;

  constructor(args: WhatsAppClientArgs) {
    this.channel = args.channel;
    this.credentials = args.credentials;
  }

  async sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }> {
    const providerMessageId = `stub_msg_${randomUUID()}`;
    const ts = new Date().toISOString();
    const cfg = parseWhatsAppChannelConfig(this.channel.config);

    await this.appendDeliveryLog({
      ts,
      channelId: this.channel.id,
      phoneNumberId: cfg.phoneNumberId,
      to: args.to,
      content: args.content,
      providerMessageId,
    });

    // Fire-and-forget delivery callback. The dev-server process keeps
    // the timer alive long enough for it to land; failures get logged
    // to console (not the JSONL — that's outbound only).
    setTimeout(() => {
      void this.fireDeliveryCallback({
        providerMessageId,
        to: args.to,
        cfg,
      });
    }, DELIVERY_CALLBACK_DELAY_MS);

    return { providerMessageId };
  }

  async getProfile(_args: {
    phoneNumber: string;
  }): Promise<{ name?: string } | null> {
    void this;
    return { name: "Stub Customer" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async appendDeliveryLog(record: {
    ts: string;
    channelId: string;
    phoneNumberId: string;
    to: string;
    content: string;
    providerMessageId: string;
  }): Promise<void> {
    try {
      await mkdir(DELIVERY_LOG_DIR, { recursive: true });
      await appendFile(
        join(DELIVERY_LOG_DIR, DELIVERY_LOG_FILE),
        JSON.stringify(record) + "\n",
        "utf8",
      );
    } catch (err) {
      // Don't fail the send on a log write — the conversation still
      // proceeds, the operator just won't see a JSONL entry.
      console.warn("[stub-whatsapp] log append failed:", err);
    }
  }

  private async fireDeliveryCallback(args: {
    providerMessageId: string;
    to: string;
    cfg: WhatsAppChannelConfig;
  }): Promise<void> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      console.warn(
        "[stub-whatsapp] NEXT_PUBLIC_APP_URL not set; skipping delivery callback",
      );
      return;
    }

    // Meta-shape status update — same shape 360dialog forwards in prod.
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: args.cfg.phoneNumberId },
                statuses: [
                  {
                    id: args.providerMessageId,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: args.to,
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = signWhatsAppPayload({
      rawBody,
      secret: this.credentials.webhookSecret,
    });

    try {
      const res = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/api/whatsapp/webhook`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-360DIALOG-Signature": signature,
          },
          body: rawBody,
          signal: AbortSignal.timeout(DELIVERY_CALLBACK_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        console.warn(
          `[stub-whatsapp] delivery callback non-2xx: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn("[stub-whatsapp] delivery callback failed:", err);
    }
  }
}
