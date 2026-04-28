/**
 * Seeds a WIDGET Channel for a given tenant slug. Idempotent — re-running
 * preserves the existing publicKey via upsertWidgetChannel.
 *
 * TODO(post-6e): seed demo KnowledgeSource rows for `acme-test` so widget
 * playground replies don't always escalate. Path: src/server/knowledge/
 * actions.ts → createWebsiteSource (Phase 3 ingestion flow).
 *
 * Run:
 *   npx dotenv -e .env.local -- tsx scripts/seed-widget-channel.ts <tenantSlug>
 *
 * Prints the resolved publicKey to stdout so curl tests can capture it:
 *   PUBLIC_KEY=$(npx dotenv -e .env.local -- tsx scripts/seed-widget-channel.ts acme-test | tail -1)
 *
 * The seeded channel has originsAllowlist set to the dev shell + Next.js
 * dev origins so cross-origin POSTs from the widget at :5173 hit the API
 * at :3000 cleanly.
 */
import { prisma } from "@/server/db/client";
import {
  upsertWidgetChannel,
  getWidgetChannel,
} from "@/server/db/channels";
import { parseWidgetChannelConfig } from "@/lib/validators";
import type { Prisma } from "@prisma/client";

const ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:3000"];

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: seed-widget-channel.ts <tenantSlug>");
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    console.error(`tenant not found for slug=${slug}`);
    process.exit(1);
  }

  // Upsert with the dev display name + allowlist. Note: upsertWidgetChannel
  // doesn't set originsAllowlist on update for existing rows, only on the
  // first create — write the allowlist explicitly via a follow-up patch so
  // re-running this seed updates the list.
  const channel = await upsertWidgetChannel({
    tenantId: tenant.id,
    displayName: tenant.name,
    originsAllowlist: ALLOWED_ORIGINS,
  });

  // Force-patch the allowlist so re-runs converge on ALLOWED_ORIGINS even
  // for pre-existing rows.
  const cfg = parseWidgetChannelConfig(channel.config);
  cfg.originsAllowlist = ALLOWED_ORIGINS;
  await prisma.channel.update({
    where: { id: channel.id },
    data: { config: cfg as unknown as Prisma.InputJsonValue, status: "CONNECTED" },
  });

  const final = await getWidgetChannel(tenant.id);
  if (!final) throw new Error("seed: channel disappeared after upsert");
  const finalCfg = parseWidgetChannelConfig(final.config);

  console.error(`tenant: ${tenant.slug} (${tenant.id})`);
  console.error(`channel: ${final.id} status=${final.status}`);
  console.error(`originsAllowlist: ${JSON.stringify(finalCfg.originsAllowlist)}`);
  // Last line is the public key — capture with `... | tail -1`.
  console.log(finalCfg.publicKey);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
