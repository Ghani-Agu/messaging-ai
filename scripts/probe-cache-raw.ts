/**
 * Cache isolation probe — bypasses our SDK + RealClaudeClient layers
 * and makes a raw fetch directly to Anthropic with cache_control. Tells
 * us whether caching not firing is a code-side issue or an API/account
 * issue.
 *
 * Two consecutive calls with the same prefix; expects turn 2 to show
 * cache_read > 0.
 */

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

// Reasonably large system prompt (~2000+ tokens) to clearly exceed
// the 1024 minimum.
const LARGE_SYSTEM = "You are an AI customer-service assistant. " + "x ".repeat(2000);

async function call(apiKey: string, label: string): Promise<void> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 50,
      system: [
        {
          type: "text",
          text: LARGE_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: "Hi" }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json() as {
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    error?: unknown;
  };
  console.log(`[cache-raw ${label}]`, JSON.stringify(json.usage ?? json.error ?? json));
}

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 2;
  console.log("[cache-raw] turn 1 (should write cache):");
  await call(apiKey, "turn1");
  await new Promise((r) => setTimeout(r, 1500));
  console.log("[cache-raw] turn 2 (should read cache):");
  await call(apiKey, "turn2");
  return 0;
}

main().then((c) => process.exit(c));

export {};
