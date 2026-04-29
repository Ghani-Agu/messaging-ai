import "server-only";
import type { Channel } from "@prisma/client";
import {
  parseInstagramChannelConfig,
  type MetaCredentials,
} from "@/lib/validators";
import type { MetaClientArgs } from "../meta/client";
import { MetaGraphAdapter } from "../meta/graph";
import type { InstagramClient } from "./client";

/**
 * Real Instagram client — composes a MetaGraphAdapter for shared HTTP
 * work and adds the Instagram-specific `getProfile` projection.
 *
 * Sends via POST /{igUserId}/messages. The igUserId comes from
 * Channel.config (parsed via instagramChannelConfigSchema). The page
 * access token comes from decrypted credentials — same token used by
 * the linked MESSENGER channel (Meta issues one Page access token that
 * authorizes both products).
 */
export class RealInstagramClient implements InstagramClient {
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
    const cfg = parseInstagramChannelConfig(this.channel.config);
    const result = await this.graph.sendMessage({
      senderId: cfg.igUserId,
      recipientId: args.to,
      text: args.content,
      token: this.credentials.pageAccessToken,
    });
    return { providerMessageId: result.message_id };
  }

  async getProfile(args: { igsid: string }): Promise<{
    username?: string;
    name?: string;
  } | null> {
    const profile = await this.graph.getProfile<{
      username?: string;
      name?: string;
    }>({
      externalId: args.igsid,
      token: this.credentials.pageAccessToken,
      // IG's user-profile API returns username + name. profile_pic also
      // available; not surfaced in v1.
      fields: ["username", "name"],
    });
    if (!profile) return null;
    return {
      username: profile.username,
      name: profile.name,
    };
  }
}
