/**
 * Smart-import quality probe (P4r-5). Pastes realistic messy catalog
 * text at RealClaudeClient.structureItemsFromText and verifies the
 * shape + spot-checks the structuring quality.
 *
 * Usage:  npm run probe:smart-import
 *
 * Cost:   ~$0.005–0.010 per run (one Sonnet 4.6 call, max_tokens=4000).
 *
 * The probe DOES NOT auto-grade Claude's structuring quality — that's
 * inherently subjective. It prints the input text, the extracted
 * items, and the notes, so the operator (you) can eyeball whether
 * Claude is doing reasonable extraction. The PASS/FAIL gate is purely
 * shape: did we get items[], do they have names, did the call succeed.
 *
 * Use this whenever:
 *   - SMART_IMPORT_SYSTEM_PROMPT in real-claude-client.ts changes.
 *   - SEND_STRUCTURED_ITEMS_TOOL schema changes.
 *   - A new model snapshot lands and we want to verify quality holds.
 */

import { RealClaudeClient } from "@/server/ai/real-claude-client";

const MESSY_CATALOG = `
Inventaire mise à jour - Mars 2026

== Laptops ==
Macbook Pro 14" M3 - Apple silicon, 16GB RAM, 512GB SSD - 230,000 DZD - 3 en stock
Dell XPS 13 (2024) - i7, 16GB, 1TB - 195,000 DZD - rupture de stock, recommande commande
HP Spectre x360 14 - 14" tactile - 175,000 DZD - 5 disponibles

Téléphones
- iPhone 15 Pro 256GB Titane Naturel — 220,000 dzd, 8 unités en stock
- Samsung Galaxy S24 Ultra 512GB Onyx — 210000 DZD (5 dispo)
- Pixel 8 Pro 128GB - 145,000 DZD - 0 en stock, livraison sur commande 2-3 sem

Accessoires divers
* Anker PowerCore 20000mAh - 8500 DZD
* AirPods Pro 2 (USB-C) - 35,000 DZD - en stock
* Logitech MX Master 3S - 15,500 DZD - 2 disponibles

Notes internes:
- vérifier prix iPhone avec fournisseur lundi
- les pixels arrivent semaine prochaine en provenance de France
- promo en cours sur les Macbook (-5%)
`;

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[probe-smart-import] ANTHROPIC_API_KEY not set");
    return 2;
  }

  const client = new RealClaudeClient({ apiKey });
  console.log("[probe-smart-import] sending messy catalog to Claude…");
  console.log("[probe-smart-import] input text (truncated):");
  console.log(MESSY_CATALOG.slice(0, 200) + "…\n");

  let result;
  try {
    result = await client.structureItemsFromText!({
      text: MESSY_CATALOG,
      maxItems: 20,
    });
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "Unknown";
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[probe-smart-import] FAIL: ${name}: ${msg}`);
    return 1;
  }

  console.log(
    `[probe-smart-import] modelId=${result.modelId} retriesUsed=${result.retriesUsed}`,
  );
  console.log(`[probe-smart-import] usage:`, JSON.stringify(result.usage));
  console.log(
    `[probe-smart-import] extracted ${result.toolArgs.items.length} items:\n`,
  );

  for (let i = 0; i < result.toolArgs.items.length; i++) {
    const it = result.toolArgs.items[i]!;
    const bits: string[] = [`name=${JSON.stringify(it.name)}`];
    if (it.brand) bits.push(`brand=${JSON.stringify(it.brand)}`);
    if (it.sku) bits.push(`sku=${JSON.stringify(it.sku)}`);
    if (it.price) bits.push(`price=${JSON.stringify(it.price)}`);
    if (it.currency) bits.push(`currency=${JSON.stringify(it.currency)}`);
    if (it.availability) bits.push(`avail=${it.availability}`);
    if (it.category) bits.push(`category=${JSON.stringify(it.category)}`);
    if (it.specs && Object.keys(it.specs).length > 0) {
      bits.push(`specs=${JSON.stringify(it.specs)}`);
    }
    console.log(`  [${i + 1}] ${bits.join("  ")}`);
    if (it.description) {
      console.log(
        `      desc: ${JSON.stringify(it.description.slice(0, 100))}`,
      );
    }
  }
  if (result.toolArgs.notes) {
    console.log(`\n[probe-smart-import] notes: ${result.toolArgs.notes}`);
  }

  // Shape checks (PASS = these all hold). Quality is for human review.
  const checks: Record<string, boolean> = {
    nonEmpty: result.toolArgs.items.length > 0,
    everyItemHasName: result.toolArgs.items.every(
      (it) => typeof it.name === "string" && it.name.length > 0,
    ),
    noEmptyArrays: result.toolArgs.items.length > 0,
    usagePresent: result.usage !== null,
  };
  console.log("\n[probe-smart-import] shape checks:");
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "✓" : "✗"} ${k}`);
  }

  const allPass = Object.values(checks).every((v) => v);
  if (allPass) {
    console.log(
      "\n[probe-smart-import] PASS (shape). Eyeball items above for quality —",
    );
    console.log(
      "[probe-smart-import] currency picks, availability mapping, spec extraction.",
    );
    return 0;
  }
  console.error("\n[probe-smart-import] FAIL — at least one shape check failed.");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[probe-smart-import] uncaught error:", err);
    process.exit(2);
  });

export {};
