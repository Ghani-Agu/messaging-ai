/**
 * Shared Zod schemas. Keep tenant-shaped validators here; per-feature schemas
 * live with their feature in src/server/<area>/.
 */
import { z } from "zod";

export const tenantSlugSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, digits, hyphens");

export type TenantSlug = z.infer<typeof tenantSlugSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Voice profile (Phase 4)
//
// Lives inside `Tenant.settings.voiceProfile`. Consumed by the AI brain's
// system-prompt builder — every reply prompt injects the active profile so the
// model has explicit tone/formality/avoid guardrails alongside the few-shot
// examples. The settings UI for editing it ships in Phase 9 (onboarding wizard);
// for Phase 4 every tenant gets the default profile via the seed.
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = ["ar", "fr", "en", "darija"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const voiceToneSchema = z.enum(["formal", "friendly", "casual", "expert"]);
export type VoiceTone = z.infer<typeof voiceToneSchema>;

export const emojiPolicySchema = z.enum(["none", "minimal", "expressive"]);
export type EmojiPolicy = z.infer<typeof emojiPolicySchema>;

export const fewShotExampleSchema = z.object({
  customer: z.string().trim().min(1).max(500),
  reply: z.string().trim().min(1).max(2000),
});
export type FewShotExample = z.infer<typeof fewShotExampleSchema>;

export const voiceProfileSchema = z.object({
  tone: voiceToneSchema.default("friendly"),
  // 1 = very casual, 5 = very formal. Distinct axis from `tone`.
  formality: z.number().int().min(1).max(5).default(3),
  signaturePhrases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  avoid: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  emojiPolicy: emojiPolicySchema.default("minimal"),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default("fr"),
  fallbackLanguage: z.enum(SUPPORTED_LANGUAGES).default("en"),
  fewShot: z.array(fewShotExampleSchema).max(20).default([]),
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

/**
 * The full Tenant.settings JSON shape. `passthrough` so legacy fields
 * (defaultLanguage / brandVoice / businessHours from Phase 1 seed) and any
 * future additions don't get stripped on parse → write roundtrips.
 */
export const tenantSettingsSchema = z
  .object({
    defaultLanguage: z.string().optional(),
    brandVoice: z.string().optional(),
    businessHours: z.object({ tz: z.string() }).optional(),
    voiceProfile: voiceProfileSchema.optional(),
  })
  .passthrough();
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/**
 * Default voice profile for any tenant that doesn't have one yet. Returns a
 * fresh object each call — callers may mutate freely.
 */
export function defaultVoiceProfile(): VoiceProfile {
  return voiceProfileSchema.parse({});
}

/**
 * Read the voice profile out of an arbitrary JSON value (the Prisma
 * `settings` column). Falls back to the default if the field is missing,
 * malformed, or unparseable. Never throws — the brain must always have a
 * profile to inject into the prompt.
 */
export function getVoiceProfile(settings: unknown): VoiceProfile {
  const parsed = tenantSettingsSchema.safeParse(settings);
  if (!parsed.success) return defaultVoiceProfile();
  if (!parsed.data.voiceProfile) return defaultVoiceProfile();
  return parsed.data.voiceProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Widget channel config (Phase 6)
//
// Lives inside `Channel.config` for rows where Channel.type = 'WIDGET'.
// `publicKey` is the value indexed by Channel_widget_publicKey_unique (the
// partial unique B-tree on config->>'publicKey'); the embed snippet on the
// host page passes it via `data-key`. Format: "wgt_pk_" + 32 lowercase hex
// chars (16 random bytes), matching the regex consumed in widget/.
// ─────────────────────────────────────────────────────────────────────────────

export const WIDGET_PUBLIC_KEY_REGEX = /^wgt_pk_[a-z0-9]{32}$/;

export const widgetChannelConfigSchema = z.object({
  publicKey: z.string().regex(WIDGET_PUBLIC_KEY_REGEX, "expected wgt_pk_ + 32 hex chars"),
  // Server-confirmed business name. When set, overrides the embed's data-name
  // attribute on the first stream response — see channels.ts doc comment.
  displayName: z.string().trim().min(1).max(80).optional(),
  // CSS color string (hex / hsl / oklch). Tenant-side override of the
  // widget's accent. Validated more strictly when the channels-page UI lands.
  themeAccent: z.string().trim().min(1).max(64).optional(),
  // Origins permitted to embed the widget. Each entry is a serialized origin
  // ("https://example.com"); empty array means "no restriction" in v1 (Phase 9
  // billing tiers will add enforcement).
  originsAllowlist: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
});
export type WidgetChannelConfig = z.infer<typeof widgetChannelConfigSchema>;

/**
 * Parse a Channel.config JSON value into the widget shape. Throws on shape
 * mismatch — callers that need a tolerant read use `safeParse` directly.
 */
export function parseWidgetChannelConfig(raw: unknown): WidgetChannelConfig {
  return widgetChannelConfigSchema.parse(raw);
}
