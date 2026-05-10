import type { SupportedLanguage } from "@/lib/validators";

/**
 * Per-language example prompts shown in the playground's empty state.
 * Clicking one seeds the input. Wording is chosen to exercise different
 * brain paths: product-catalog query, operational-fact (hours), and a
 * delivery intent — all of which should ground in real knowledge if
 * any exists.
 *
 * Algerian Darija specifically — never Moroccan. The platform serves
 * Algerian businesses, and Moroccan-flavored examples mislead operators
 * about what the AI is tuned for (mirrors the Block A language-handling
 * coaching; see prompts/system.ts).
 *
 * Lives in its own .ts so we can assert these strings in a vitest run
 * without dragging the "use client" component (and its framer-motion
 * import graph) into a node-environment test.
 */
export const EXAMPLE_PROMPTS: Record<SupportedLanguage, string[]> = {
  en: [
    "What products do you sell?",
    "Are you open today?",
    "Do you ship to Oran?",
  ],
  fr: [
    "Quels produits vendez-vous ?",
    "Êtes-vous ouverts aujourd'hui ?",
    "Livrez-vous à Oran ?",
  ],
  ar: [
    "ما المنتجات التي تبيعونها؟",
    "هل أنتم مفتوحون اليوم؟",
    "هل توصلون إلى وهران؟",
  ],
  darija: [
    "wsh 3andkom les produits?",
    "Camera Dahua rahom disponibles?",
    "wsh homa swaye3 li takhedmo fihom",
  ],
};
