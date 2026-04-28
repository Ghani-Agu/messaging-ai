// Verifies Phase 6a schema landed correctly on the live DB:
//   - Channel / Customer / Conversation / Message tables exist
//   - All Phase 6a enum types exist with the right variants
//   - The widget-public-key partial unique index exists with the right WHERE
//   - The Postgres planner uses that index for the public-key lookup query
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
  ChannelType: ["WHATSAPP", "INSTAGRAM", "WIDGET"],
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
  console.log("\nPhase 6a schema verified.");
}
