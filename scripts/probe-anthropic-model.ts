/**
 * Probe whether a specific Anthropic model_id resolves at /v1/messages.
 *
 * Background (P4r-1 review): Anthropic's /v1/models endpoint returns only
 * the alias `claude-sonnet-4-6` — no dated snapshot like
 * `claude-sonnet-4-6-20260217` is listed. The /v1/messages endpoint
 * sometimes accepts a constructed dated handle that isn't in the public
 * list. This script makes a single minimal call (max_tokens=1, one-char
 * user message) to find out.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/probe-anthropic-model.ts <model_id>
 *
 * Exit codes:
 *   0 — 200 OK, model accepted by /v1/messages
 *   1 — 4xx error (model rejected); stays on alias
 *   2 — other error (network, 5xx, missing key); inconclusive
 *
 * Cost: ~$0.0001 per call (1 input token + 1 output token at Sonnet rates).
 *
 * Output is structured: a single line "[model-pin] ..." for easy grep.
 */

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

async function main(): Promise<number> {
  const modelId = process.argv[2];
  if (!modelId) {
    console.error("usage: probe-anthropic-model.ts <model_id>");
    return 2;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[model-pin] ANTHROPIC_API_KEY not set, cannot probe");
    return 2;
  }

  const url = `${ANTHROPIC_BASE_URL}/v1/messages`;
  const body = JSON.stringify({
    model: modelId,
    max_tokens: 1,
    messages: [{ role: "user", content: "x" }],
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[model-pin] network error probing "${modelId}": ${msg}`);
    return 2;
  }

  if (res.ok) {
    console.log(`[model-pin] OK: dated snapshot "${modelId}" accepted by /v1/messages`);
    return 0;
  }

  const errBody = await res.text().catch(() => "<no body>");
  if (res.status >= 400 && res.status < 500) {
    console.log(
      `[model-pin] dated snapshot rejected by API (status ${res.status}), staying on alias`,
    );
    console.log(`            response body: ${errBody.slice(0, 300)}`);
    return 1;
  }

  console.error(`[model-pin] inconclusive: status ${res.status} body=${errBody.slice(0, 300)}`);
  return 2;
}

main().then((code) => process.exit(code));

export {};
