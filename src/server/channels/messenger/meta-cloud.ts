import "server-only";
import type { Channel } from "@prisma/client";
import {
  parseMessengerChannelConfig,
  type MetaCredentials,
} from "@/lib/validators";
import type { MetaClientArgs } from "../meta/client";
import { MetaGraphAdapter } from "../meta/graph";
import type { MessengerClient } from "./client";

/**
 * Real Messenger client — composes a MetaGraphAdapter for the shared
 * HTTP work and adds the Messenger-specific projection of `getProfile`.
 *
 * Sends via POST /{pageId}/messages. The pageId comes from
 * Channel.config (parsed via messengerChannelConfigSchema). The page
 * access token comes from decrypted credentials.
 *
 * Keys land at credential time; until then `getMessengerClient` falls
 * back to StubMessengerClient automatically when META_APP_ID is unset.
 * Flipping a single env var swaps this in (mirrors the Phase 6 pattern
 * for ThreesixtydialogClient).
 */
export class RealMessengerClient implements MessengerClient {
  private readonly graph: MetaGraphAdapter;
  private readonly channel: Channel;
  private readonly credentials: MetaCredentials;

  constructor(args: MetaClientArgs) {
    this.graph = new MetaGraphAdapter();
    this.channel = args.channel;
    this.credentials = args.credentials;
  }

  async sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }> {
    const cfg = parseMessengerChannelConfig(this.channel.config);
    const result = await this.graph.sendMessage({
      senderId: cfg.pageId,
      recipientId: args.to,
      text: args.content,
      token: this.credentials.pageAccessToken,
    });
    return { providerMessageId: result.message_id };
  }

  async getProfile(args: {
    psid: string;
  }): Promise<{ firstName?: string; lastName?: string } | null> {
    const profile = await this.graph.getProfile<{
      first_name?: string;
      last_name?: string;
    }>({
      externalId: args.psid,
      token: this.credentials.pageAccessToken,
      // Messenger Platform's user-profile API returns first_name /
      // last_name when the user has granted the Page access. profile_pic
      // is also available; we don't surface it in v1 (the dashboard
      // avatar uses the customer's first letter).
      fields: ["first_name", "last_name"],
    });
    if (!profile) return null;
    return {
      firstName: profile.first_name,
      lastName: profile.last_name,
    };
  }
}
