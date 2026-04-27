#!/usr/bin/env tsx
/**
 * Compares .env.local against .env.example and reports missing keys, grouped
 * by phase. Usage: npm run check:env
 *
 * Phase 1 needs only: DATABASE_URL, DIRECT_DATABASE_URL, REDIS_URL,
 *                     NEXTAUTH_SECRET (recommended).
 * Later phases warn instead of failing.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd());
const examplePath = join(root, ".env.example");
const localPath = join(root, ".env.local");

const REQUIRED_BY_PHASE: Record<string, string[]> = {
  "Phase 1 (foundation)": [
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "REDIS_URL",
  ],
  "Phase 2 (auth)": [
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "RESEND_API_KEY",
  ],
  "Phase 3 (knowledge ingestion)": [
    "FIRECRAWL_API_KEY",
    "LLAMAPARSE_API_KEY",
    "VOYAGE_API_KEY",
  ],
  "Phase 4 (AI brain)": ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  "Phase 6 (WhatsApp)": ["WHATSAPP_360DIALOG_API_KEY"],
  "Phase 7 (Instagram)": ["META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"],
  "Phase 9 (billing)": [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_STARTER",
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_BUSINESS",
  ],
  "Phase 10 (observability)": ["SENTRY_DSN", "POSTHOG_KEY"],
  "Always (encryption)": ["ENCRYPTION_KEY"],
};

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

const example = parseEnvFile(examplePath);
const local = parseEnvFile(localPath);

if (!existsSync(localPath)) {
  console.warn("⚠  .env.local does not exist yet. Copy .env.example to get started.");
}

let phase1Failures = 0;

for (const [phase, keys] of Object.entries(REQUIRED_BY_PHASE)) {
  const missing = keys.filter((k) => !local[k] || local[k] === "");
  if (missing.length === 0) {
    console.log(`✔ ${phase}`);
    continue;
  }
  const symbol = phase.startsWith("Phase 1") ? "✗" : "·";
  console.log(`${symbol} ${phase}: ${missing.join(", ")}`);
  if (phase.startsWith("Phase 1")) phase1Failures += missing.length;
}

const unknown = Object.keys(local).filter((k) => !(k in example));
if (unknown.length) {
  console.warn(`\n⚠  Unknown keys in .env.local (not in .env.example): ${unknown.join(", ")}`);
}

if (phase1Failures > 0) {
  console.error(`\n✗ ${phase1Failures} required Phase 1 variable(s) missing.`);
  process.exit(1);
}

console.log("\nPhase 1 environment OK.");
