import { describe, expect, it } from "vitest";
import { EXAMPLE_PROMPTS } from "./playground-example-prompts";

/**
 * Pins the Darija starter prompts shown on the playground welcome screen
 * to authentic Algerian phrasings. The previous set ("rakum 7allin daba",
 * "katwasslo l Oran", "wach 3andkom des produits jdad") was Moroccan and
 * misrepresented the AI's target dialect for WBP. Lock both directions:
 * the new strings must be present, and the old Moroccan strings must
 * NEVER come back.
 */
describe("EXAMPLE_PROMPTS.darija", () => {
  it("contains the three authentic Algerian starter prompts", () => {
    expect(EXAMPLE_PROMPTS.darija).toEqual([
      "wsh 3andkom les produits?",
      "Camera Dahua rahom disponibles?",
      "wsh homa swaye3 li takhedmo fihom",
    ]);
  });

  it("never reintroduces the Moroccan-dialect strings that were removed", () => {
    const joined = EXAMPLE_PROMPTS.darija.join(" | ");
    expect(joined).not.toMatch(/rakum 7allin/);
    expect(joined).not.toMatch(/katwasslo/);
    expect(joined).not.toMatch(/produits jdad/);
  });
});

describe("EXAMPLE_PROMPTS — other languages untouched", () => {
  it("preserves the EN / FR / AR starter sets", () => {
    expect(EXAMPLE_PROMPTS.en).toEqual([
      "What products do you sell?",
      "Are you open today?",
      "Do you ship to Oran?",
    ]);
    expect(EXAMPLE_PROMPTS.fr).toEqual([
      "Quels produits vendez-vous ?",
      "Êtes-vous ouverts aujourd'hui ?",
      "Livrez-vous à Oran ?",
    ]);
    expect(EXAMPLE_PROMPTS.ar).toEqual([
      "ما المنتجات التي تبيعونها؟",
      "هل أنتم مفتوحون اليوم؟",
      "هل توصلون إلى وهران؟",
    ]);
  });
});
