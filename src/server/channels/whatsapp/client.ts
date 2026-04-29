import "server-only";
import type { Channel } from "@prisma/client";
import {
  parseWhatsAppChannelConfig,
  type WhatsAppCredentials,
} from "@/lib/validators";
import { ThreesixtydialogClient } from "./threesixtydialog";
import { StubWhatsAppClient } from "./stub";

/**
 * Provider-agnostic WhatsApp client interface.
 *
 * One implementation ships in Phase 6 — ThreesixtydialogClient for
 * 360dialog. A second implementation (Meta Cloud Direct) can be added
 * later as a one-line factory branch + new class; the interface stays
 * the same. Channel.config.provider switches at runtime.
 *
 * Webhook signature verification is NOT on this interface — it's a
 * stateless free function in src/server/channels/whatsapp/signatures.ts
 * that the inbound-webhook route calls directly. Both providers use
 * HMAC-SHA256 over the raw body, no per-provider variation, so putting
 * it on the interface would just duplicate the same body across
 * implementations.
 *
 * 24h-window enforcement is also NOT on this interface — it lives in
 * src/server/channels/policy.ts (channel-agnostic since 7a — same 24h
 * window applies to Meta channels too) and is checked by the
 * outbound-send hook (in src/server/db/conversations.ts as of 6d) BEFORE
 * sendMessage is called. sendMessage assumes the window is open. This
 * keeps the policy decision in one place rather than scattering it
 * across every client implementation.
 */
export interface WhatsAppClient {
  /**
   * Send a free-text message to a customer. Caller is responsible for
   * having checked isWithinCustomerServiceWindow first — sendMessage
   * does not gate on the 24h window.
   */
  sendMessage(args: {
    to: string; // E.164, e.g. "+213555123456"
    content: string;
  }): Promise<{ providerMessageId: string }>;

  /**
   * Fetch customer profile metadata. Best-effort; returns null on miss
   * or when the provider doesn't expose profile data. Used by the
   * inbound webhook handler to populate Customer.name when the channel
   * payload doesn't carry one.
   */
  getProfile(args: { phoneNumber: string }): Promise<{ name?: string } | null>;
}

export type WhatsAppClientArgs = {
  channel: Channel;
  /**
   * Decrypted credentials. The route handler / outbound hook decrypts
   * Channel.credentials via decryptCredentials before constructing the
   * client — credentials never round-trip through this layer in their
   * encrypted form.
   */
  credentials: WhatsAppCredentials;
};

/**
 * Resolve the right client implementation for a Channel.
 *
 * Stub fallback rules (per 6a Gate 1, K4/K5):
 *   1. WHATSAPP_USE_STUB === "true"   → Stub (explicit dev override).
 *   2. WHATSAPP_360DIALOG_API_KEY unset → Stub (auto-fallback so the
 *      system still runs end-to-end before real keys land).
 *   3. otherwise                       → ThreesixtydialogClient.
 *
 * The stub path is intentionally kept runnable POST-credentials too,
 * so CI / E2E test harnesses don't burn real WhatsApp messages
 * (CLAUDE.md §6 documents the toggle).
 */
export function getWhatsAppClient(args: WhatsAppClientArgs): WhatsAppClient {
  const { channel } = args;
  const cfg = parseWhatsAppChannelConfig(channel.config);

  switch (cfg.provider) {
    case "threesixtydialog": {
      const explicitStub = process.env.WHATSAPP_USE_STUB === "true";
      const noApiKey = !process.env.WHATSAPP_360DIALOG_API_KEY;
      if (explicitStub || noApiKey) {
        return new StubWhatsAppClient(args);
      }
      return new ThreesixtydialogClient(args);
    }
    default: {
      // Exhaustiveness — z.enum keeps `cfg.provider` to known values, so
      // this branch is unreachable. Kept for defense-in-depth in case
      // the schema is widened without a matching factory branch.
      throw new Error(
        `Unknown WhatsApp provider: ${String(cfg.provider satisfies never)}`,
      );
    }
  }
}
