/**
 * Cheap-path language detection (Phase 8c).
 *
 * Extracted from StubClaudeClient.detectLanguageStub so the orchestrator
 * can call it pre-Claude — needed for QnaPair.languageLock filtering and
 * for tier-2 operational-facts intent gates that depend on the language
 * of the customer message.
 *
 * Pure regex-based, no I/O. Same regex set the stub used so behavior is
 * stable across tests. When the real Claude wrapper lands, this stays as
 * a fallback for when an LLM-based language guess isn't available (e.g.
 * before the model has been called).
 *
 * Coverage matches MASTER_PLAN §3 supported languages: ar / fr / en / darija.
 * Imperfect by design — the brain still surfaces a self-reported `language`
 * field on every reply; this is the orchestrator's pre-call signal, not the
 * authoritative one.
 */

import type { SupportedLanguage } from "./validators";

// Arabizi: Latin alphabet + numerals (3, 7, 9) standing in for ع, ح, ق —
// the Algerian Darija romanization in WhatsApp / Messenger. Matching common
// dialect-marker words anchored on word boundaries.
const ARABIZI_RE = /\b(?:wach|kayan|kifash|rana|3andkom|bezzaf|khouya|khdma|blasa)\b/i;

// Arabic / Hebrew script range — covers MSA Arabic and Arabic-script Darija.
const ARABIC_SCRIPT_RE = /[؀-ۿ]/;

// Darija dialect markers in Arabic script. Distinguishes Darija-in-Arabic-
// script from MSA. Imperfect (MSA messages occasionally use these tokens
// too) but the misclassification cost is low — both replies stay in Arabic
// script, only the register changes.
const ARABIC_DARIJA_MARKERS_RE = /(?:واش|كيفاش|راني|راح|بزاف)/;

// French function words common enough that their presence is a strong signal.
// Kept minimal — false positives on a French word in an English message are
// rare and tolerable.
const FRENCH_RE = /\b(?:bonjour|merci|s'il vous plaît|quel|votre|vos|comment)\b/i;

/**
 * Best-effort language guess from raw customer text.
 *
 * Order matters — Arabizi is checked before Arabic script (since Arabizi
 * messages contain numerals + Latin and never trigger the Arabic-script
 * range) and before French (Latin overlap). MSA falls out of "Arabic
 * script with no Darija markers."
 *
 * Default: English. Picked because English is the safest fallback when no
 * signal fires — it produces a reply the customer can at least machine-
 * translate if they don't speak it. This matches StubClaudeClient's behavior.
 */
export function detectLanguage(text: string): SupportedLanguage {
  if (ARABIZI_RE.test(text)) return "darija";
  if (ARABIC_SCRIPT_RE.test(text)) {
    if (ARABIC_DARIJA_MARKERS_RE.test(text)) return "darija";
    return "ar";
  }
  if (FRENCH_RE.test(text)) return "fr";
  return "en";
}
