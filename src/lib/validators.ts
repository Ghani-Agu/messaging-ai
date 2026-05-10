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

// ─────────────────────────────────────────────────────────────────────────────
// Passwords (Credentials provider)
//
// Lives here so signup, password-reset, and the Credentials authorize
// callback share one schema. No max length cap — bcrypt's own 72-byte
// truncation is the practical ceiling, and applying that as a Zod max
// would silently reject otherwise-valid passphrases. Block a tiny
// hardcoded list of the most common credential-stuffing targets; no
// external HIBP call (would leak prefix hashes per request).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lowercased substring blocklist. A submitted password fails if its
 * lowercased form CONTAINS any entry — so "Password1" fails on the
 * "password" substring even though it technically passes length /
 * letter / digit. Twenty entries is enough to cover the top-of-funnel
 * credential-stuffing hits without surprising legitimate users.
 */
const COMMON_PASSWORD_BLOCKLIST: readonly string[] = [
  "password",
  "passw0rd",
  "12345678",
  "123456789",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "admin123",
  "iloveyou",
  "monkey123",
  "abc12345",
  "1qaz2wsx",
  "trustno1",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "starwars",
  "azerty123",
];

export function isBlocklistedPassword(input: string): boolean {
  const lower = input.toLowerCase();
  return COMMON_PASSWORD_BLOCKLIST.some((entry) => lower.includes(entry));
}

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must include a letter")
  .regex(/[0-9]/, "Password must include a digit")
  .refine((s) => !isBlocklistedPassword(s), {
    message: "That password is too common — please pick another",
  });

// ─────────────────────────────────────────────────────────────────────────────
// AI behavior toggles
//
// Operator-facing knobs that shape what the brain shares with customers,
// independent of the voice profile (tone/formality/few-shot). Lives at
// Tenant.settings.aiBehavior alongside voiceProfile. Defaults match the
// WhatsApp-first SMB pattern most onboarding tenants want: minimal info
// sharing (no exact prices, no exact stock counts) and order escalation
// to a human. Per-tenant overrides flip individual toggles.
// ─────────────────────────────────────────────────────────────────────────────

export const aiBehaviorSchema = z.object({
  showPrices: z.boolean().default(false),
  showStockCounts: z.boolean().default(false),
  requireHumanForOrders: z.boolean().default(true),
});
export type AiBehavior = z.infer<typeof aiBehaviorSchema>;

/**
 * Platform-wide defaults. Frozen so callers can't accidentally mutate the
 * shared reference between requests.
 */
export const AI_BEHAVIOR_DEFAULTS: AiBehavior = Object.freeze({
  showPrices: false,
  showStockCounts: false,
  requireHumanForOrders: true,
}) as AiBehavior;

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
    aiBehavior: aiBehaviorSchema.optional(),
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

/**
 * Read the AI behavior toggles out of an arbitrary JSON value. Falls back
 * to AI_BEHAVIOR_DEFAULTS for missing / malformed input. Never throws —
 * the brain (and Block A renderer) must always have a fully-populated
 * toggle object to gate on. Returns a fresh object so callers can't
 * mutate the shared defaults through the return value.
 */
export function getAiBehaviorForTenant(settings: unknown): AiBehavior {
  const fallback = (): AiBehavior => ({ ...AI_BEHAVIOR_DEFAULTS });
  const parsed = tenantSettingsSchema.safeParse(settings);
  if (!parsed.success) return fallback();
  if (!parsed.data.aiBehavior) return fallback();
  // aiBehaviorSchema fills any individually-missing fields via .default()
  // when parsed via tenantSettingsSchema, so the result is guaranteed
  // fully populated.
  return { ...parsed.data.aiBehavior };
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

/**
 * Parse, validate, and canonicalize an origin string. Lowercases the host,
 * drops any trailing slash, drops any path/query/hash. Throws on anything
 * that doesn't parse as a URL with an http(s) scheme.
 */
export function canonicalizeOrigin(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`unsupported origin protocol: ${u.protocol}`);
  }
  // URL.origin already lowercases the host and drops the path; default
  // ports are stripped; trailing slash is never part of `.origin`.
  return u.origin;
}

const originStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .transform((v, ctx) => {
    try {
      return canonicalizeOrigin(v);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `not a parseable origin: ${(err as Error).message}`,
      });
      return z.NEVER;
    }
  });

const rateLimitWindowSchema = z.object({
  windowSec: z.number().int().min(1).max(86400),
  capacity: z.number().int().min(1).max(100000),
});

/**
 * Per-channel rate-limit override. Mirrors the RateLimits type in
 * src/server/channels/widget/rate-limit.ts. Phase-6 stores any override
 * here; Phase 9 billing tiers will set values via the same path.
 */
export const widgetRateLimitsSchema = z.object({
  burst: rateLimitWindowSchema.optional(),
  sustain: rateLimitWindowSchema.optional(),
});

export const widgetChannelConfigSchema = z.object({
  publicKey: z.string().regex(WIDGET_PUBLIC_KEY_REGEX, "expected wgt_pk_ + 32 hex chars"),
  // Server-confirmed business name. When set, overrides the embed's data-name
  // attribute on the first stream response — see channels.ts doc comment.
  displayName: z.string().trim().min(1).max(80).optional(),
  // CSS color string (hex / hsl / oklch). Tenant-side override of the
  // widget's accent. Validated more strictly when the channels-page UI lands.
  themeAccent: z.string().trim().min(1).max(64).optional(),
  // Origins permitted to embed the widget. Each entry is canonicalized
  // (lowercased host, no trailing slash, no path) on save. Empty array means
  // "no restriction" in v1 (Phase 9 billing tiers will add enforcement).
  originsAllowlist: z.array(originStringSchema).max(20).default([]),
  // Optional per-channel override of the widget rate-limit windows. Falls
  // back to WIDGET_RATE_LIMIT_DEFAULTS when omitted.
  rateLimits: widgetRateLimitsSchema.optional(),
});
export type WidgetChannelConfig = z.infer<typeof widgetChannelConfigSchema>;

/**
 * Parse a Channel.config JSON value into the widget shape. Throws on shape
 * mismatch — callers that need a tolerant read use `safeParse` directly.
 */
export function parseWidgetChannelConfig(raw: unknown): WidgetChannelConfig {
  return widgetChannelConfigSchema.parse(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp channel config (Phase 6a)
//
// Lives inside `Channel.config` for rows where Channel.type = 'WHATSAPP'.
// `phoneNumberId` is the value indexed by Channel_whatsapp_phoneNumberId_unique
// (the partial unique B-tree on config->>'phoneNumberId') and is the WABA
// phone-number-id forwarded by 360dialog/Meta on every webhook payload — the
// webhook handler resolves the receiving Channel via this lookup.
//
// `Channel.credentials` is encrypted at rest (src/server/channels/credentials)
// with the plaintext shape defined by whatsappCredentialsSchema below.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider implementation switch. 360dialog ships in Phase 6; Meta Cloud
 * Direct ("meta-cloud") is intentionally not in the enum yet — adding it
 * later is a one-line schema change plus a new client implementation.
 */
export const whatsappProviderSchema = z.enum(["threesixtydialog"]);
export type WhatsAppProvider = z.infer<typeof whatsappProviderSchema>;

/**
 * E.164 phone number — leading "+", country code, 1–14 more digits. Used for
 * the human-readable phoneNumber field surfaced in the dashboard. The
 * provider-side lookup key is `phoneNumberId`, not this.
 */
const e164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be E.164 (e.g. +213555123456)");

export const whatsappChannelConfigSchema = z.object({
  provider: whatsappProviderSchema.default("threesixtydialog"),
  // The WABA phone-number-id that identifies this channel on inbound
  // webhooks. 360dialog forwards Meta-shape payloads; the value lands in
  // entry[].changes[].value.metadata.phone_number_id. Indexed via the
  // partial unique in 20260428234123_add_whatsapp_routing.
  phoneNumberId: z.string().trim().min(1).max(64),
  // Operator-confirmed display name shown in the dashboard. Falls back to
  // Channel.displayName if absent.
  displayName: z.string().trim().min(1).max(80).optional(),
  // The actual E.164 phone number, surfaced in the conversation-detail
  // header for WhatsApp threads.
  phoneNumber: e164Schema.optional(),
});
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>;

export function parseWhatsAppChannelConfig(raw: unknown): WhatsAppChannelConfig {
  return whatsappChannelConfigSchema.parse(raw);
}

/**
 * Plaintext shape of WhatsApp credentials. Never written to the DB in this
 * shape — always encrypted via encryptCredentials before persisting and
 * decrypted via decryptCredentials on read.
 *
 *   apiToken      — 360dialog API key (sent as `D360-API-KEY` header on
 *                   every outbound /messages call).
 *   webhookSecret — HMAC-SHA256 secret for verifying incoming webhook
 *                   signatures (X-360DIALOG-Signature: sha256=<hex>).
 *                   In stub mode this is a generated value; the dev-only
 *                   simulator route signs payloads with the same secret
 *                   so the validation path is exercised in dev.
 */
export const whatsappCredentialsSchema = z.object({
  apiToken: z.string().trim().min(1).max(512),
  webhookSecret: z.string().trim().min(16).max(256),
});
export type WhatsAppCredentials = z.infer<typeof whatsappCredentialsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Meta channels — Messenger + Instagram (Phase 7a)
//
// Both ride the Meta Graph API. Provider abstraction matches the Phase 6
// WhatsApp pattern (one provider in the enum for now; extension later is
// a one-line schema change). Connect flow paste-token gives access to a
// Facebook Page; if the Page has an Instagram Business Account linked,
// both Channel rows are created from the same paste.
//
// Webhook routing differs from WhatsApp's per-channel webhookSecret model:
// HMAC validation uses META_APP_SECRET (env var, global across all Pages
// and IG accounts on the Meta app). Per-channel `Channel.credentials`
// holds only the page-access-token; the app secret never lives in DB.
// CLAUDE.md §6 will document this deviation in 7g.
//
// Lookup-key indexes (raw SQL, partial unique on JSON path) live in
// 20260429020000_phase7a_corrective_restore_hnsw_add_meta_indexes:
//   - Channel_messenger_pageId_unique on config->>'pageId' WHERE type='MESSENGER'
//   - Channel_instagram_igUserId_unique on config->>'igUserId' WHERE type='INSTAGRAM'
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider switch for both Messenger and Instagram. Only `meta-cloud` ships
 * in Phase 7. Adding alternatives later (e.g. a BSP) is a one-line enum
 * change plus a new client implementation.
 */
export const metaProviderSchema = z.enum(["meta-cloud"]);
export type MetaProvider = z.infer<typeof metaProviderSchema>;

export const messengerChannelConfigSchema = z.object({
  provider: metaProviderSchema.default("meta-cloud"),
  // The Facebook Page ID. Forwarded by Meta in
  // entry[].messaging[].recipient.id on every webhook. Indexed by the
  // partial unique Channel_messenger_pageId_unique.
  pageId: z.string().trim().min(1).max(64),
  // Operator-confirmed Page name from /PAGE_ID?fields=name. Surfaced in
  // the dashboard channels list + conversation detail header.
  pageName: z.string().trim().min(1).max(120),
  // Optional dashboard override; falls back to Channel.displayName.
  displayName: z.string().trim().min(1).max(80).optional(),
});
export type MessengerChannelConfig = z.infer<typeof messengerChannelConfigSchema>;

export function parseMessengerChannelConfig(raw: unknown): MessengerChannelConfig {
  return messengerChannelConfigSchema.parse(raw);
}

export const instagramChannelConfigSchema = z.object({
  provider: metaProviderSchema.default("meta-cloud"),
  // Instagram User ID — Meta's identifier for the IG Business Account.
  // Forwarded as entry[].id on Instagram-shape webhook payloads. Indexed
  // by the partial unique Channel_instagram_igUserId_unique.
  igUserId: z.string().trim().min(1).max(64),
  // The IG @username at the time of connect (we cache it for display;
  // tenant can refresh by reconnecting).
  igUsername: z.string().trim().min(1).max(120).optional(),
  // The Facebook Page ID this IG account is linked to. IG Business
  // accounts always ride a Page; we record the linkage so the connect
  // flow knows which MESSENGER channel (if any) shares the page-access-
  // token. Stored as a string; not indexed (the messenger lookup uses
  // its own pageId; this field is informational).
  pageId: z.string().trim().min(1).max(64),
  // Optional dashboard override; falls back to Channel.displayName.
  displayName: z.string().trim().min(1).max(80).optional(),
});
export type InstagramChannelConfig = z.infer<typeof instagramChannelConfigSchema>;

export function parseInstagramChannelConfig(raw: unknown): InstagramChannelConfig {
  return instagramChannelConfigSchema.parse(raw);
}

/**
 * Plaintext shape of Meta channel credentials. Encrypted via
 * encryptCredentials before write; never persisted in this shape.
 *
 *   pageAccessToken — long-lived (60d) Page Access Token. Used as the
 *                     bearer for outbound /messages calls and the
 *                     /<psid>?fields=… profile lookups. Same value used
 *                     by both the MESSENGER and INSTAGRAM channels of a
 *                     given Page (they share the token).
 *
 * App-level secrets (META_APP_SECRET for HMAC verification,
 * META_VERIFY_TOKEN for the webhook handshake) live in env vars, not in
 * Channel.credentials — they're global across the Meta app, not per
 * Page. CLAUDE.md §6 documents this Phase 7 deviation from the Phase 6
 * per-channel-secret pattern.
 */
export const metaCredentialsSchema = z.object({
  pageAccessToken: z.string().trim().min(1).max(2048),
});
export type MetaCredentials = z.infer<typeof metaCredentialsSchema>;
