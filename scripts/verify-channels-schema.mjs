// Verifies Phase 6 + 7 schema landed correctly on the live DB:
//   - Channel / Customer / Conversation / Message tables exist
//   - All channel enum types exist with the right variants
//   - The widget-public-key partial unique index exists with the right WHERE,
//     and the Postgres planner uses it for the public-key lookup query
//   - (Phase 6a — WhatsApp routing) Message.providerMessageId column +
//     composite index exist; the partial unique on
//     Channel.config->>'phoneNumberId' (WHERE type='WHATSAPP') exists with
//     the right WHERE; the planner picks it for the inbound webhook lookup
//   - (Phase 7a — Meta routing) the partial uniques on
//     Channel.config->>'pageId' (WHERE type='MESSENGER') and
//     Channel.config->>'igUserId' (WHERE type='INSTAGRAM') exist with the
//     right WHEREs; the planner picks each for their respective inbound
//     webhook lookups
//
// Run: npx dotenv -e .env.local -- node scripts/verify-channels-schema.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let bad = 0;
const ok = (msg) => console.log("✓ " + msg);
const fail = (msg) => {
  console.log("✗ " + msg);
  bad++;
};

const EXPECTED_TABLES = ["Channel", "Conversation", "Customer", "Message"];
const EXPECTED_ENUMS = {
  // ChannelType: MESSENGER appended in Phase 7a (after WIDGET, in creation
  // order — Postgres preserves enum addition order in pg_enum.enumsortorder).
  ChannelType: ["WHATSAPP", "INSTAGRAM", "WIDGET", "MESSENGER"],
  ChannelStatus: ["CONNECTED", "DISCONNECTED", "ERROR"],
  ConversationStatus: ["ACTIVE", "PAUSED", "CLOSED", "HUMAN_HANDLING"],
  MessageDirection: ["INBOUND", "OUTBOUND"],
  MessageSender: ["CUSTOMER", "AI", "HUMAN_AGENT"],
  MessageContentType: ["TEXT", "IMAGE", "VOICE", "FILE"],
};

try {
  // Tables
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    EXPECTED_TABLES,
  );
  if (tables.length === EXPECTED_TABLES.length) {
    ok(`tables exist: ${EXPECTED_TABLES.join(", ")}`);
  } else {
    fail(
      `expected ${EXPECTED_TABLES.length} tables, got ${tables.length}: ${JSON.stringify(tables)}`,
    );
  }

  // Enums
  for (const [enumName, expectedVariants] of Object.entries(EXPECTED_ENUMS)) {
    const variants = await prisma.$queryRawUnsafe(
      `SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1
        ORDER BY e.enumsortorder`,
      enumName,
    );
    const got = variants.map((v) => v.enumlabel);
    const same =
      got.length === expectedVariants.length &&
      got.every((v, i) => v === expectedVariants[i]);
    if (same) ok(`enum ${enumName} = [${got.join(", ")}]`);
    else
      fail(
        `enum ${enumName} mismatch: expected [${expectedVariants.join(", ")}], got [${got.join(", ")}]`,
      );
  }

  // Partial unique index on Channel public key
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='Channel'
        AND indexname='Channel_widget_publicKey_unique'`,
  );
  const def = idx[0]?.indexdef ?? "";
  const looksRight =
    /UNIQUE INDEX/i.test(def) &&
    /\(\(config ->> 'publicKey'::text\)\)/i.test(def) &&
    /WHERE/i.test(def) &&
    /type = 'WIDGET'::"ChannelType"/i.test(def) &&
    /\(config ->> 'publicKey'::text\) IS NOT NULL/i.test(def);
  if (looksRight) ok(`partial unique index Channel_widget_publicKey_unique present`);
  else fail(`Channel_widget_publicKey_unique missing or wrong: ${JSON.stringify(idx)}`);

  // EXPLAIN check — confirm the planner uses the partial unique index for
  // the widget public-key lookup (the hot path on every widget request).
  // We use enable_seqscan=off inside a transaction so the check works on
  // an empty table. The check fails iff Postgres can't pick the index
  // (wrong expression, wrong WHERE, etc.) even with seqscan disabled.
  const planJson = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    const rows = await tx.$queryRawUnsafe(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM "Channel"
        WHERE ("config" ->> 'publicKey') = 'pk_test_lookup_sentinel'
          AND "type" = 'WIDGET'`,
    );
    return rows[0]["QUERY PLAN"];
  });
  const planStr = JSON.stringify(planJson, null, 2);
  if (planStr.includes("Channel_widget_publicKey_unique")) {
    ok(`planner uses Channel_widget_publicKey_unique for the lookup`);
    console.log("  EXPLAIN (FORMAT JSON):");
    console.log(
      planStr
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  } else {
    fail(`planner did not pick the partial unique index. Plan: ${planStr}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 6a additions — Message.providerMessageId + WhatsApp routing index
  // ───────────────────────────────────────────────────────────────────────

  // Message.providerMessageId column + nullability.
  const providerCol = await prisma.$queryRawUnsafe(
    `SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='Message'
        AND column_name='providerMessageId'`,
  );
  if (providerCol.length === 1 && providerCol[0].is_nullable === "YES") {
    ok(`Message.providerMessageId column present (nullable)`);
  } else {
    fail(`Message.providerMessageId missing or wrong: ${JSON.stringify(providerCol)}`);
  }

  // Composite index on (tenantId, providerMessageId) for webhook idempotency
  // + delivery-status routing.
  const provIdx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='Message'
        AND indexname='Message_tenantId_providerMessageId_idx'`,
  );
  const provIdxDef = provIdx[0]?.indexdef ?? "";
  if (
    provIdx.length === 1 &&
    /\("tenantId", "providerMessageId"\)/i.test(provIdxDef)
  ) {
    ok(`composite index Message_tenantId_providerMessageId_idx present`);
  } else {
    fail(
      `Message_tenantId_providerMessageId_idx missing or wrong: ${JSON.stringify(provIdx)}`,
    );
  }

  // Partial unique index on Channel.config->>'phoneNumberId' WHERE type='WHATSAPP'.
  const waIdx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='Channel'
        AND indexname='Channel_whatsapp_phoneNumberId_unique'`,
  );
  const waIdxDef = waIdx[0]?.indexdef ?? "";
  const waLooksRight =
    /UNIQUE INDEX/i.test(waIdxDef) &&
    /\(\(config ->> 'phoneNumberId'::text\)\)/i.test(waIdxDef) &&
    /WHERE/i.test(waIdxDef) &&
    /type = 'WHATSAPP'::"ChannelType"/i.test(waIdxDef) &&
    /\(config ->> 'phoneNumberId'::text\) IS NOT NULL/i.test(waIdxDef);
  if (waLooksRight) {
    ok(`partial unique index Channel_whatsapp_phoneNumberId_unique present`);
  } else {
    fail(
      `Channel_whatsapp_phoneNumberId_unique missing or wrong: ${JSON.stringify(waIdx)}`,
    );
  }

  // EXPLAIN check — confirm the planner picks the WhatsApp partial unique
  // for the webhook routing query. Same enable_seqscan=off pattern as the
  // widget check so this works on an empty table.
  const waPlanJson = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    const rows = await tx.$queryRawUnsafe(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM "Channel"
        WHERE ("config" ->> 'phoneNumberId') = 'phn_test_lookup_sentinel'
          AND "type" = 'WHATSAPP'`,
    );
    return rows[0]["QUERY PLAN"];
  });
  const waPlanStr = JSON.stringify(waPlanJson, null, 2);
  if (waPlanStr.includes("Channel_whatsapp_phoneNumberId_unique")) {
    ok(`planner uses Channel_whatsapp_phoneNumberId_unique for the lookup`);
    console.log("  EXPLAIN (FORMAT JSON):");
    console.log(
      waPlanStr
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  } else {
    fail(`planner did not pick the WhatsApp partial unique index. Plan: ${waPlanStr}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Phase 7a additions — Messenger + Instagram routing partial uniques
  // ───────────────────────────────────────────────────────────────────────

  // Partial unique on Channel.config->>'pageId' WHERE type='MESSENGER'.
  const msgrIdx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='Channel'
        AND indexname='Channel_messenger_pageId_unique'`,
  );
  const msgrIdxDef = msgrIdx[0]?.indexdef ?? "";
  const msgrLooksRight =
    /UNIQUE INDEX/i.test(msgrIdxDef) &&
    /\(\(config ->> 'pageId'::text\)\)/i.test(msgrIdxDef) &&
    /WHERE/i.test(msgrIdxDef) &&
    /type = 'MESSENGER'::"ChannelType"/i.test(msgrIdxDef) &&
    /\(config ->> 'pageId'::text\) IS NOT NULL/i.test(msgrIdxDef);
  if (msgrLooksRight) {
    ok(`partial unique index Channel_messenger_pageId_unique present`);
  } else {
    fail(
      `Channel_messenger_pageId_unique missing or wrong: ${JSON.stringify(msgrIdx)}`,
    );
  }

  const msgrPlanJson = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    const rows = await tx.$queryRawUnsafe(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM "Channel"
        WHERE ("config" ->> 'pageId') = 'page_test_lookup_sentinel'
          AND "type" = 'MESSENGER'`,
    );
    return rows[0]["QUERY PLAN"];
  });
  const msgrPlanStr = JSON.stringify(msgrPlanJson, null, 2);
  if (msgrPlanStr.includes("Channel_messenger_pageId_unique")) {
    ok(`planner uses Channel_messenger_pageId_unique for the lookup`);
    console.log("  EXPLAIN (FORMAT JSON):");
    console.log(
      msgrPlanStr
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  } else {
    fail(`planner did not pick the Messenger partial unique index. Plan: ${msgrPlanStr}`);
  }

  // Partial unique on Channel.config->>'igUserId' WHERE type='INSTAGRAM'.
  const igIdx = await prisma.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='Channel'
        AND indexname='Channel_instagram_igUserId_unique'`,
  );
  const igIdxDef = igIdx[0]?.indexdef ?? "";
  const igLooksRight =
    /UNIQUE INDEX/i.test(igIdxDef) &&
    /\(\(config ->> 'igUserId'::text\)\)/i.test(igIdxDef) &&
    /WHERE/i.test(igIdxDef) &&
    /type = 'INSTAGRAM'::"ChannelType"/i.test(igIdxDef) &&
    /\(config ->> 'igUserId'::text\) IS NOT NULL/i.test(igIdxDef);
  if (igLooksRight) {
    ok(`partial unique index Channel_instagram_igUserId_unique present`);
  } else {
    fail(
      `Channel_instagram_igUserId_unique missing or wrong: ${JSON.stringify(igIdx)}`,
    );
  }

  const igPlanJson = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off`);
    const rows = await tx.$queryRawUnsafe(
      `EXPLAIN (FORMAT JSON)
       SELECT id FROM "Channel"
        WHERE ("config" ->> 'igUserId') = 'ig_test_lookup_sentinel'
          AND "type" = 'INSTAGRAM'`,
    );
    return rows[0]["QUERY PLAN"];
  });
  const igPlanStr = JSON.stringify(igPlanJson, null, 2);
  if (igPlanStr.includes("Channel_instagram_igUserId_unique")) {
    ok(`planner uses Channel_instagram_igUserId_unique for the lookup`);
    console.log("  EXPLAIN (FORMAT JSON):");
    console.log(
      igPlanStr
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
  } else {
    fail(`planner did not pick the Instagram partial unique index. Plan: ${igPlanStr}`);
  }
} catch (err) {
  console.error("verify failed:", err);
  bad++;
} finally {
  await prisma.$disconnect();
}

if (bad > 0) {
  console.error(`\n${bad} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nPhase 7 channels schema verified.");
}
