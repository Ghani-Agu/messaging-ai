import "server-only";
import { mkdir, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import {
  parseMessengerChannelConfig,
  type MessengerChannelConfig,
  type MetaCredentials,
} from "@/lib/validators";
import type { MetaClientArgs } from "../meta/client";
import {
  getMetaAppSecret,
  signMetaPayload,
} from "../meta/signatures";
import type { MessengerClient } from "./client";

/**
 * Stub Messenger client. Mirrors StubWhatsAppClient: logs each outbound
 * to .stub-deliveries/messenger.jsonl and fires a 500ms-delayed POST to
 * /api/meta/webhook synthesizing a Meta-shape `delivery` event signed
 * with `getMetaAppSecret()` (same value the webhook handler will
 * validate with — no bypass).
 *
 * `getProfile` returns deterministic stub data so the dashboard
 * customer name is recognizable in dev.
 *
 * Used in dev (forced via META_USE_STUB=true) and as the auto-fallback
 * when META_APP_ID is unset. Kept runnable post-credentials for CI / E2E
 * tests that shouldn't burn real Messenger sends.
 */

const DELIVERY_CALLBACK_DELAY_MS = 500;
const DELIVERY_LOG_DIR = ".stub-deliveries";
const DELIVERY_LOG_FILE = "messenger.jsonl";
const DELIVERY_CALLBACK_TIMEOUT_MS = 5_000;

export class StubMessengerClient implements MessengerClient {
  private readonly channel: Channel;
  // Stub doesn't actually use the access token but stash it so the
  // shape mirrors the real client and a future test can assert it.
  private readonly _credentials: MetaCredentials;

  constructor(args: MetaClientArgs) {
    this.channel = args.channel;
    this._credentials = args.credentials;
  }

  async sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }> {
    void this._credentials;
    const providerMessageId = `mid.STUB_${randomUUID()}`;
    const ts = Date.now();
    const cfg = parseMessengerChannelConfig(this.channel.config);

    await this.appendDeliveryLog({
      ts: new Date(ts).toISOString(),
      channelId: this.channel.id,
      pageId: cfg.pageId,
      to: args.to,
      content: args.content,
      providerMessageId,
    });

    setTimeout(() => {
      void this.fireDeliveryCallback({
        providerMessageId,
        psid: args.to,
        cfg,
        ts,
      });
    }, DELIVERY_CALLBACK_DELAY_MS);

    return { providerMessageId };
  }

  async getProfile(_args: { psid: string }): Promise<{
    firstName?: string;
    lastName?: string;
  } | null> {
    void _args;
    return { firstName: "Stub", lastName: "Customer" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals — JSONL log + simulated delivery webhook callback
  // ─────────────────────────────────────────────────────────────────────────

  private async appendDeliveryLog(record: {
    ts: string;
    channelId: string;
    pageId: string;
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
      console.warn("[stub-messenger] log append failed:", err);
    }
  }

  private async fireDeliveryCallback(args: {
    providerMessageId: string;
    psid: string;
    cfg: MessengerChannelConfig;
    ts: number;
  }): Promise<void> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      console.warn(
        "[stub-messenger] NEXT_PUBLIC_APP_URL not set; skipping delivery callback",
      );
      return;
    }

    // Meta-shape delivery event for object="page".
    const payload = {
      object: "page",
      entry: [
        {
          id: args.cfg.pageId,
          time: args.ts,
          messaging: [
            {
              sender: { id: args.cfg.pageId },
              recipient: { id: args.psid },
              timestamp: args.ts,
              delivery: {
                mids: [args.providerMessageId],
                watermark: args.ts,
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const signature = signMetaPayload({
      rawBody,
      secret: getMetaAppSecret(),
    });

    try {
      const res = await fetch(
        `${baseUrl.replace(/\/+$/, "")}/api/meta/webhook`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": signature,
          },
          body: rawBody,
          signal: AbortSignal.timeout(DELIVERY_CALLBACK_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        console.warn(
          `[stub-messenger] delivery callback non-2xx: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn("[stub-messenger] delivery callback failed:", err);
    }
  }
}
