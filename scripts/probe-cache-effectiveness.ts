/**
 * Verifies that Anthropic's prompt caching actually fires under our
 * production-shaped prompts. The P4r-3 cache wiring puts cache_control
 * markers on tools[], end of Block A, and end of Block B. Anthropic
 * silently ignores markers below a per-segment minimum (~1024 tokens
 * for Sonnet). The schema-split probe in P4r-3/P4r-4 saw
 * cache_creation_input_tokens=0 because the probe-shaped prompt
 * (default voice profile, no facts, no citations) sat below the
 * threshold.
 *
 * This smoke seeds the acme tenant with a substantial voice profile +
 * full tier-1 operational facts, then runs two consecutive runBrain
 * calls within the 5-min cache TTL. Expected outcome:
 *   - Turn 1: cache_creation_input_tokens > 0  (cache write)
 *   - Turn 2: cache_read_input_tokens > 0      (cache hit)
 *
 * If turn 2 cache_read is 0, the breakpoint strategy needs adjustment:
 * merge breakpoints into one cumulative segment from tools through
 * end-of-Block-B (drop the standalone tools-array and Block-A markers,
 * keep only the Block-B marker so the WHOLE prefix is cached as one
 * chunk, larger than the per-segment minimum).
 *
 * Usage:  npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/probe-cache-effectiveness.ts
 *
 * Cost:   ~$0.006 per run (two Sonnet 4.6 calls).
 *
 * Exit 0 = caching firing as designed.
 * Exit 1 = caching not firing on turn 2; breakpoint adjustment needed.
 * Exit 2 = setup error.
 */

import { prisma } from "@/server/db/client";
import { setOperationalFacts } from "@/server/db/operational-facts";
import { runBrain } from "@/server/ai/orchestrator";
import type { VoiceProfile } from "@/lib/validators";

const TENANT_SLUG = "acme";

const SUBSTANTIAL_VOICE_PROFILE: VoiceProfile = {
  tone: "friendly",
  formality: 3,
  signaturePhrases: [
    "Heureux de vous aider",
    "On est là pour vous",
    "Avec plaisir",
  ],
  avoid: [
    "promesses vagues",
    "termes techniques inutiles",
    "ton condescendant",
  ],
  emojiPolicy: "minimal",
  defaultLanguage: "fr",
  fallbackLanguage: "en",
  fewShot: [
    {
      customer: "Bonjour, j'ai une question sur votre service.",
      reply:
        "Bonjour ! Bien sûr, dites-m'en plus — quel aspect du service vous intéresse, et je vois ce que je peux faire pour vous éclairer rapidement.",
    },
    {
      customer: "C'est cher chez vous.",
      reply:
        "Je comprends que le prix soit un point important. Pour vous donner une vue claire : que cherchez-vous exactement, et je peux comparer ce qu'on propose à vos besoins concrets ?",
    },
    {
      customer: "Vous livrez à Constantine ?",
      reply:
        "Oui, on livre dans toute l'Algérie y compris Constantine. Le délai habituel est de 2 à 3 jours ouvrables. Vous voulez que je vous prépare un devis ?",
    },
  ],
};

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[cache-smoke] ANTHROPIC_API_KEY not set");
    return 2;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, name: true, settings: true },
  });
  if (!tenant) {
    console.error(`[cache-smoke] tenant '${TENANT_SLUG}' not found — run npm run db:seed first`);
    return 2;
  }

  // Stamp a substantial voice profile + tier-1 operational facts so
  // Block B exceeds Anthropic's minimum cacheable size.
  console.log(`[cache-smoke] seeding tenant ${tenant.id} with substantial voice profile + tier-1 facts`);
  const settings =
    typeof tenant.settings === "object" && tenant.settings !== null && !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      settings: { ...settings, voiceProfile: SUBSTANTIAL_VOICE_PROFILE },
    },
  });

  await setOperationalFacts({
    tenantId: tenant.id,
    data: {
      displayName: "Acme Distribution Algérie",
      primaryLanguage: "fr",
      languagesServed: ["fr", "ar", "darija", "en"],
      primaryContact: {
        name: "Service Client Acme",
        email: "support@acme.test",
        phone: "+213 21 55 67 89",
      },
      hours: {
        tz: "Africa/Algiers",
        weekly: [
          { day: "sun", open: "09:00", close: "17:00" },
          { day: "mon", open: "09:00", close: "17:00" },
          { day: "tue", open: "09:00", close: "17:00" },
          { day: "wed", open: "09:00", close: "17:00" },
          { day: "thu", open: "09:00", close: "13:00" },
        ],
      },
      currency: "DZD",
      locations: [
        { label: "Siège — Alger", address: "16 rue Didouche Mourad, Alger Centre" },
        { label: "Annexe — Oran", address: "Place du 1er Novembre, Oran" },
      ],
      serviceArea: "Algérie (livraison nationale)",
    },
  });

  console.log("\n[cache-smoke] turn 1 — first call seeds the cache");
  const r1 = await runBrain({
    tenantId: tenant.id,
    conversationId: "cache-smoke-conv",
    message: "Bonjour, à quelle heure ouvrez-vous le matin ?",
  });
  console.log(`[cache-smoke] turn 1 usage:`, JSON.stringify(r1.aiMetadata.usage));

  // Brief pause so the first call's response definitely lands before
  // the second goes out (Anthropic caches on completion, not request).
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log("\n[cache-smoke] turn 2 — should hit cache_read");
  const r2 = await runBrain({
    tenantId: tenant.id,
    conversationId: "cache-smoke-conv",
    message: "Et vos numéros de téléphone, c'est lequel ?",
    history: [
      { role: "customer", text: "Bonjour, à quelle heure ouvrez-vous le matin ?" },
      { role: "you", text: r1.reply },
    ],
  });
  console.log(`[cache-smoke] turn 2 usage:`, JSON.stringify(r2.aiMetadata.usage));

  const u1 = r1.aiMetadata.usage;
  const u2 = r2.aiMetadata.usage;
  if (!u1 || !u2) {
    console.error("[cache-smoke] FAIL: usage missing from one or both turns");
    return 1;
  }

  const turn1Wrote = (u1.cacheCreationInputTokens ?? 0) > 0;
  const turn2Read = (u2.cacheReadInputTokens ?? 0) > 0;

  console.log("\n[cache-smoke] verdict:");
  console.log(
    `  turn 1 cache_create=${u1.cacheCreationInputTokens ?? 0} (expected > 0): ${turn1Wrote ? "✓" : "✗"}`,
  );
  console.log(
    `  turn 2 cache_read=${u2.cacheReadInputTokens ?? 0} (expected > 0): ${turn2Read ? "✓" : "✗"}`,
  );

  if (turn1Wrote && turn2Read) {
    console.log("\n[cache-smoke] PASS — prompt caching firing as designed.");
    return 0;
  }

  console.error(
    "\n[cache-smoke] FAIL — at least one cache check missed.",
  );
  if (!turn1Wrote) {
    console.error(
      "[cache-smoke] Turn 1 did not write to cache. Cumulative prefix at the",
    );
    console.error(
      "[cache-smoke] LAST cache_control marker is below Anthropic's minimum",
    );
    console.error(
      "[cache-smoke] (~1024 tokens for Sonnet). Block B may need to be larger,",
    );
    console.error(
      "[cache-smoke] or the breakpoint strategy adjusted.",
    );
  }
  if (!turn2Read) {
    console.error(
      "[cache-smoke] Turn 2 did not hit cache_read. Either: (a) the cached",
    );
    console.error(
      "[cache-smoke] prefix differs between calls (something in tools/Block A/",
    );
    console.error(
      "[cache-smoke] Block B is non-deterministic), or (b) only some breakpoints",
    );
    console.error(
      "[cache-smoke] are above the per-segment minimum. Suggested fix: drop the",
    );
    console.error(
      "[cache-smoke] tools-array and Block-A standalone markers; keep only the",
    );
    console.error(
      "[cache-smoke] Block-B marker so the cumulative prefix is one large segment.",
    );
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[cache-smoke] uncaught error:", err);
    process.exit(2);
  });

export {};
