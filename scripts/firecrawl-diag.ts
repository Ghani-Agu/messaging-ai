/**
 * One-shot Firecrawl connectivity diagnostic. Runs the four checks
 * requested when the crawl-website worker started failing with
 * `connect ETIMEDOUT 35.245.250.27:443`, while plain `curl.exe -I
 * https://api.firecrawl.dev/v1/scrape` returns 404 in <1 s from the
 * same machine.
 *
 * Usage (mirrors the worker invocation so module resolution / env
 * loading match exactly):
 *
 *   npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/firecrawl-diag.ts
 *
 * No production code changes; this script is read-only.
 */

import dns from "node:dns";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

// Note: as of the fix on 2026-04-28 we no longer depend on
// @mendable/firecrawl-js; crawler.ts uses native fetch. This script keeps
// running so we can re-verify connectivity if Firecrawl ever flakes again.

const lookup = promisify(dns.lookup);
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

const FIRECRAWL_HOST = "api.firecrawl.dev";
const REQUEST_TIMEOUT_MS = 30_000;

function hr(label: string): void {
  console.log(`\n──────── ${label} ────────`);
}

async function check1_resolvedBaseUrl(): Promise<string> {
  hr("1. Configured Firecrawl base URL");
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.log("FIRECRAWL_API_KEY: <not set>");
  } else {
    console.log(`FIRECRAWL_API_KEY: <set, ${apiKey.length} chars, prefix=${apiKey.slice(0, 6)}…>`);
  }
  console.log(`FIRECRAWL_API_URL env: ${process.env.FIRECRAWL_API_URL ?? "<not set>"}`);

  // crawler.ts now uses native fetch with a hard-coded base URL. The SDK
  // is gone, so there is no client config to resolve at runtime — just the
  // constant declared in src/server/knowledge/crawler.ts.
  const baseUrl = "https://api.firecrawl.dev";
  console.log(`crawler.ts FIRECRAWL_BASE_URL: ${baseUrl}`);
  console.log(`startCrawl POSTs to:           ${baseUrl}/v1/crawl`);
  console.log(`getCrawlStatus GETs:           ${baseUrl}/v1/crawl/<id>`);
  return baseUrl;
}

async function check2_dnsResolution(): Promise<void> {
  hr(`2. DNS resolution of ${FIRECRAWL_HOST} from this process`);

  // dns.lookup uses the OS resolver (getaddrinfo) — same path Node fetch /
  // axios use by default.
  try {
    const all = await lookup(FIRECRAWL_HOST, { all: true });
    console.log(`dns.lookup (OS resolver, all=true):`);
    for (const a of all) {
      console.log(`  - ${a.address}  (family=IPv${a.family})`);
    }
  } catch (err) {
    console.log(`dns.lookup failed: ${(err as Error).message}`);
  }

  // dns.resolve4/6 bypass the OS resolver and query DNS directly. If these
  // disagree with dns.lookup we have a hosts-file or NRPT override locally.
  try {
    const v4 = await resolve4(FIRECRAWL_HOST);
    console.log(`dns.resolve4 (direct DNS): ${v4.join(", ")}`);
  } catch (err) {
    console.log(`dns.resolve4 failed: ${(err as Error).message}`);
  }
  try {
    const v6 = await resolve6(FIRECRAWL_HOST);
    console.log(`dns.resolve6 (direct DNS): ${v6.join(", ")}`);
  } catch (err) {
    console.log(`dns.resolve6 failed: ${(err as Error).message}`);
  }

  console.log(
    "\nCompare to curl: `curl.exe --resolve api.firecrawl.dev:443:<ip> ...` " +
      "or `nslookup api.firecrawl.dev`. The reported 35.245.250.27 is the IP " +
      "we are trying to reach — check whether the OS list contains it.",
  );
}

async function check3_sdkVersion(): Promise<void> {
  hr("3. SDK status (post-fix)");
  console.log("@mendable/firecrawl-js: removed from package.json on 2026-04-28.");
  console.log(
    "crawler.ts now calls Firecrawl REST directly via native fetch, with explicit",
  );
  console.log("AbortSignal.timeout() on every request. CLAUDE.md §6 has the full write-up.");
  console.log("\nReference issues that match this fingerprint, kept for posterity:");
  console.log("  - firecrawl/firecrawl#2185  status API timeouts after first call");
  console.log("  - firecrawl/firecrawl#2280  batch scrape timeouts");
  console.log("  - firecrawl/firecrawl#1912  intermittent 'No response received…'");
  console.log("  - firecrawl/firecrawl#885   incompatibility in restricted envs");
}

async function check4_directFetch(apiUrl: string): Promise<void> {
  hr(`4. Direct fetch() POST to ${apiUrl}/v1/crawl with 30 s timeout`);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.log("Skipping: FIRECRAWL_API_KEY not set.");
    return;
  }

  const url = `${apiUrl}/v1/crawl`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: "https://example.com",
        limit: 1,
        scrapeOptions: { formats: ["markdown"] },
      }),
      signal: controller.signal,
    });
    const ms = (performance.now() - start).toFixed(0);
    const text = await res.text();
    console.log(`HTTP ${res.status} in ${ms} ms`);
    console.log(`body (first 300 chars): ${text.slice(0, 300)}`);
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    const e = err as NodeJS.ErrnoException;
    console.log(`fetch FAILED in ${ms} ms`);
    console.log(`  name:    ${e.name}`);
    console.log(`  code:    ${e.code ?? "<none>"}`);
    console.log(`  message: ${e.message}`);
    if (e.cause) console.log(`  cause:   ${JSON.stringify(e.cause)}`);
  } finally {
    clearTimeout(timer);
  }

  // Also try a HEAD to /v1/scrape — the curl baseline reported 404 there.
  // Useful for separating "TCP path is broken" from "POST /v1/crawl is the
  // path that hangs."
  hr(`4b. Direct fetch() HEAD ${apiUrl}/v1/scrape (curl-equivalent baseline)`);
  const ctrl2 = new AbortController();
  const timer2 = setTimeout(() => ctrl2.abort(), REQUEST_TIMEOUT_MS);
  const start2 = performance.now();
  try {
    const res = await fetch(`${apiUrl}/v1/scrape`, {
      method: "HEAD",
      signal: ctrl2.signal,
    });
    const ms = (performance.now() - start2).toFixed(0);
    console.log(`HTTP ${res.status} in ${ms} ms`);
  } catch (err) {
    const ms = (performance.now() - start2).toFixed(0);
    const e = err as NodeJS.ErrnoException;
    console.log(`fetch FAILED in ${ms} ms`);
    console.log(`  name:    ${e.name}`);
    console.log(`  code:    ${e.code ?? "<none>"}`);
    console.log(`  message: ${e.message}`);
    if (e.cause) console.log(`  cause:   ${JSON.stringify(e.cause)}`);
  } finally {
    clearTimeout(timer2);
  }
}

async function main(): Promise<void> {
  console.log(`firecrawl-diag — node ${process.version}, platform=${process.platform}`);
  const apiUrl = await check1_resolvedBaseUrl();
  await check2_dnsResolution();
  await check3_sdkVersion();
  await check4_directFetch(apiUrl);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("[firecrawl-diag] unexpected failure:", err);
  process.exit(1);
});
