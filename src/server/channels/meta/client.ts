import "server-only";
import type { Channel } from "@prisma/client";
import type { MetaCredentials } from "@/lib/validators";
import {
  getMessengerClient,
  type MessengerClient,
} from "../messenger/client";
import {
  getInstagramClient,
  type InstagramClient,
} from "../instagram/client";

/**
 * Meta-family channel clients — base interface + factory.
 *
 * `MetaGraphClient` is the narrow contract every Meta-side leaf
 * implementation honors: outbound `sendMessage`. Per-platform `getProfile`
 * shapes diverge (PSID first/last for Messenger, IGSID @username for
 * Instagram), so the leaves declare their own typed `getProfile`
 * extending this base.
 *
 * `getMetaClient(channel, credentials)` is the entry point used by the
 * outbound-dispatch hook (7d). Routes by Channel.type to the right leaf
 * factory; that factory in turn picks Stub vs Real based on env toggles
 * mirroring the Phase 6 WhatsApp pattern.
 */

export interface MetaGraphClient {
  /**
   * Send a free-text message to a customer. Caller is responsible for
   * having checked isWithinCustomerServiceWindow first — this method
   * does not gate on the 24h window (same contract as WhatsAppClient).
   */
  sendMessage(args: {
    to: string;
    content: string;
  }): Promise<{ providerMessageId: string }>;
}

export type MetaClientArgs = {
  channel: Channel;
  /**
   * Decrypted credentials. The route handler / outbound hook decrypts
   * Channel.credentials via decryptCredentials before constructing the
   * client — credentials never round-trip through this layer in their
   * encrypted form.
   */
  credentials: MetaCredentials;
};

/**
 * Resolve the right Meta-family client for a Channel. Channel.type
 * dispatches: MESSENGER → MessengerClient, INSTAGRAM → InstagramClient.
 *
 * The leaf factories handle stub-vs-real selection internally; this
 * factory only routes by channel type.
 */
export function getMetaClient(
  args: MetaClientArgs,
): MessengerClient | InstagramClient {
  switch (args.channel.type) {
    case "MESSENGER":
      return getMessengerClient(args);
    case "INSTAGRAM":
      return getInstagramClient(args);
    default:
      throw new Error(
        `getMetaClient: unsupported channel type ${args.channel.type}`,
      );
  }
}
