import "server-only";
import { mkdir, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Channel } from "@prisma/client";
import {
  parseInstagramChannelConfig,
  type InstagramChannelConfig,
  type MetaCredentials,
} from "@/lib/validators";
import type { MetaClientArgs } from "../meta/client";
import {
  getMetaAppSecret,
  signMetaPayload,
} from "../meta/signatures";
import type { InstagramClient } from "./client";

/**
 * Stub Instagram client. Mirrors StubMessengerClient: logs each outbound
 * to .stub-deliveries/instagram.jsonl and fires a 500ms-delayed POST to
 * /api/meta/webhook synthesizing a Meta-shape `delivery` event with
 * `object: "instagram"`, signed with `getMetaAppSecret()` (no bypass).
 *
 * `getProfile` returns deterministic stub data ({ username: "stub_user" })
 * so the dashboard customer label is recognizable in dev.
 */

const DELIVERY_CALLBACK_DELAY_MS = 500;
const DELIVERY_LOG_DIR = ".stub-deliveries";
const DELIVERY_LOG_FILE = "instagram.jsonl";
const DELIVERY_CALLBACK_TIMEOUT_MS = 5_000;

export class StubInstagramClient implements InstagramClient {
  private readonly channel: Channel;
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
    const cfg = parseInstagramChannelConfig(this.channel.config);

    await this.appendDeliveryLog({
      ts: new Date(ts).toISOString(),
      channelId: this.channel.id,
      igUserId: cfg.igUserId,
      to: args.to,
      content: args.content,
      providerMessageId,
    });

    setTimeout(() => {
      void this.fireDeliveryCallback({
        providerMessageId,
        igsid: args.to,
        cfg,
        ts,
      });
    }, DELIVERY_CALLBACK_DELAY_MS);

    return { providerMessageId };
  }

  async getProfile(_args: { igsid: string }): Promise<{
    username?: string;
    name?: string;
  } | null> {
    void _args;
    return { username: "stub_user", name: "Stub Customer" };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async appendDeliveryLog(record: {
    ts: string;
    channelId: string;
    igUserId: string;
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
      console.warn("[stub-instagram] log append failed:", err);
    }
  }

  private async fireDeliveryCallback(args: {
    providerMessageId: string;
    igsid: string;
    cfg: InstagramChannelConfig;
    ts: number;
  }): Promise<void> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      console.warn(
        "[stub-instagram] NEXT_PUBLIC_APP_URL not set; skipping delivery callback",
      );
      return;
    }

    const payload = {
      object: "instagram",
      entry: [
        {
          id: args.cfg.igUserId,
          time: args.ts,
          messaging: [
            {
              sender: { id: args.cfg.igUserId },
              recipient: { id: args.igsid },
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
          `[stub-instagram] delivery callback non-2xx: ${res.status} ${res.statusText}`,
        );
      }
    } catch (err) {
      console.warn("[stub-instagram] delivery callback failed:", err);
    }
  }
}
