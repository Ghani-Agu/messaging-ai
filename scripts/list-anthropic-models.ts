/**
 * One-shot: fetch the live list of Claude models via Anthropic's
 * `GET /v1/models` so we can pin a specific dated snapshot of
 * Sonnet 4.6 (per Phase-4 model-pin decision: option (a),
 * env-overridable). Read-only; no DB or file mutations.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/list-anthropic-models.ts
 *
 * The `--conditions=react-server` flag matches the worker so
 * `import "server-only"` resolves to its no-op build, in case any
 * future module gets pulled in transitively. This script itself
 * imports nothing from `src/server/`.
 */

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const TIMEOUT_MS = 30_000;

type Model = {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
};

type ListResponse = {
  data: Model[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
};

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local — cannot list models.");
    process.exit(1);
  }

  const url = `${ANTHROPIC_BASE_URL}/v1/models?limit=1000`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    console.error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const json = (await res.json()) as ListResponse;

  // Sort newest-first so the latest snapshot is at the top.
  const sorted = [...json.data].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  console.log(`Total models returned: ${json.data.length}\n`);

  // Highlight the Sonnet 4.6 family — that's the snapshot we need to pin.
  const sonnet46 = sorted.filter((m) => /sonnet-4-6/.test(m.id));
  console.log("── Sonnet 4.6 family (newest first) ──");
  if (sonnet46.length === 0) {
    console.log("  (no matches — surface the full list below and decide manually)");
  } else {
    for (const m of sonnet46) {
      console.log(
        `  ${m.id.padEnd(40)}  display='${m.display_name}'  created=${m.created_at}`,
      );
    }
  }

  console.log("\n── Full model list (newest first) ──");
  for (const m of sorted) {
    console.log(
      `  ${m.id.padEnd(40)}  display='${m.display_name}'  created=${m.created_at}`,
    );
  }
}

main().catch((err) => {
  console.error("list-anthropic-models failed:", err);
  process.exit(1);
});
