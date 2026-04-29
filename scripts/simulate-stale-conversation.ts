// Build a WhatsApp conversation whose only inbound message is older
// than 24 hours, then run an AI reply through it. The 6d outbound
// dispatch hook hits the closed-window branch, persists the AI reply
// with `aiMetadata.deliveryStatus = "skipped_outside_window"`, and
// makes no provider call.
//
// Useful for screenshot #5 of Phase 6 verification ("outside-window
// AI bubble showing the 'not delivered' indicator") and for any
// future test of the 24h policy.
//
// Usage:
//   npm run simulate:stale -- <tenantSlug> <e164PhoneNumber> [inboundOffsetHours]
//
// Or directly (the --conditions=react-server flag is required because
// the script pulls in server-only modules through recordAiMessage):
//   npx dotenv -e .env.local -- tsx --conditions=react-server \
//     scripts/simulate-stale-conversation.ts <tenantSlug> <e164PhoneNumber> [hours]
//
// Defaults: inboundOffsetHours = 25 (firmly past the 24h boundary).
//
// Side effects:
//   - Upserts Customer (tenantId, channelType=WHATSAPP, externalId=<digits>).
//   - Creates a Conversation if no ACTIVE one is in resume range
//     (resolveOrCreateConversation handles the resume rule).
//   - Inserts an INBOUND CUSTOMER message with createdAt =
//     now - inboundOffsetHours, then bumps conversation.lastMessageAt
//     to that same time so the resume window logic stays consistent.
//   - Calls recordAiMessage with stub aiMetadata, which fires
//     dispatchOutboundReply → policy check → "skipped_outside_window".

import { prisma } from "@/server/db/client";
import {
  recordAiMessage,
  resolveOrCreateConversation,
  type MessageAiMetadata,
} from "@/server/db/conversations";
import { getWhatsAppChannel } from "@/server/db/channels";

function usage(): never {
  console.error(
    "usage: simulate-stale-conversation.ts <tenantSlug> <e164PhoneNumber> [inboundOffsetHours=25]",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();
const tenantSlug = args[0]!;
const phoneE164 = args[1]!;
const inboundOffsetHours = args[2] ? Number(args[2]) : 25;

if (!Number.isFinite(inboundOffsetHours) || inboundOffsetHours <= 0) {
  console.error(`invalid inboundOffsetHours: ${args[2]}`);
  usage();
}
if (!phoneE164.startsWith("+")) {
  console.error(
    `phone number must be E.164 (start with "+"); got: ${phoneE164}`,
  );
  usage();
}

async function main() {
  // 1. Tenant + WhatsApp channel.
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    console.error(`tenant not found for slug=${tenantSlug}`);
    process.exit(1);
  }
  const channel = await getWhatsAppChannel(tenant.id);
  if (!channel) {
    console.error(
      `tenant ${tenant.slug} has no WhatsApp channel — connect one at /${tenant.slug}/channels/whatsapp first`,
    );
    process.exit(1);
  }

  // 2. Resolve customer + conversation. externalId is the wa_id (E.164
  //    without the leading "+"), matching the parser projection.
  const externalId = phoneE164.slice(1);
  const { conversation, customer } = await resolveOrCreateConversation({
    tenantId: tenant.id,
    channelId: channel.id,
    channelType: "WHATSAPP",
    externalId,
    customerHints: { phone: phoneE164, name: "Stale Test Customer" },
  });

  // 3. Insert backdated INBOUND. Direct prisma insert — recordInboundMessage
  //    timestamps with `new Date()` and we need an older value. Conversation's
  //    lastMessageAt is moved back to match so the resume-window logic doesn't
  //    accidentally treat this conversation as fresh-but-not-yet-replied.
  const inboundAt = new Date(
    Date.now() - inboundOffsetHours * 60 * 60 * 1000,
  );
  const inbound = await prisma.message.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      sender: "CUSTOMER",
      content: `Hello — this message was sent ${inboundOffsetHours}h ago (simulated).`,
      contentType: "TEXT",
      providerMessageId: `wamid.STALE_${Date.now()}`,
      createdAt: inboundAt,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: inboundAt },
  });

  // 4. Run an AI reply through recordAiMessage. The post-commit
  //    dispatchOutboundReply checks the 24h window via
  //    isWithinCustomerServiceWindow(getLastInboundAt()) — it returns
  //    false for our backdated message, so the dispatch stashes
  //    deliveryStatus = "skipped_outside_window" via mergeMessageAiMetadata
  //    rather than calling the provider.
  const aiMetadata: MessageAiMetadata = {
    modelId: "stub:simulate-stale-conversation",
    language: "en",
    groundedness: 0.95,
    confidence: 0.95,
    escalation: null,
    claudeRecommendedEscalation: false,
    claudeReason: null,
    topChunkSimilarity: 0.8,
    usage: null,
    citations: [],
    citationsUsed: [],
  };
  const ai = await recordAiMessage({
    tenantId: tenant.id,
    conversationId: conversation.id,
    content:
      "Thanks for reaching out — happy to help. (This reply demonstrates the 24h-window-closed indicator.)",
    aiMetadata,
  });

  // 5. Read back the AI row to confirm deliveryStatus stuck.
  const finalAi = await prisma.message.findUnique({
    where: { id: ai.id },
    select: { id: true, aiMetadata: true, providerMessageId: true },
  });
  const meta = (finalAi?.aiMetadata ?? {}) as Record<string, unknown>;

  console.error(`tenant:        ${tenant.slug} (${tenant.id})`);
  console.error(`channel:       ${channel.id} (${channel.status})`);
  console.error(
    `customer:      ${customer.id} externalId=${customer.externalId} phone=${customer.phone}`,
  );
  console.error(`conversation:  ${conversation.id}`);
  console.error(
    `inbound:       ${inbound.id} createdAt=${inbound.createdAt.toISOString()} (${inboundOffsetHours}h ago)`,
  );
  console.error(`ai:            ${ai.id}`);
  console.error(`ai.deliveryStatus:    ${String(meta.deliveryStatus ?? "(unset)")}`);
  console.error(`ai.deliveryStatusAt:  ${String(meta.deliveryStatusAt ?? "(unset)")}`);
  console.error(
    `ai.providerMessageId: ${finalAi?.providerMessageId ?? "(unset — no provider call, expected)"}`,
  );

  // Last line on stdout: the conversation URL path so you can pipe it
  // straight into a browser.
  console.log(`/${tenant.slug}/conversations/${conversation.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
