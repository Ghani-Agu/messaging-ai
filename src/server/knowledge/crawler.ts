import "server-only";
import {
  MAX_CRAWL_DEPTH,
  MAX_PAGES_PER_CRAWL,
  SAME_DOMAIN_ONLY,
} from "./limits";
import { PermanentError } from "./errors";

/**
 * Firecrawl REST client over native `fetch`. Replaces the `@mendable/
 * firecrawl-js` SDK after we hit ETIMEDOUT failures from inside the
 * long-lived BullMQ worker — the SDK's bundled axios client has no default
 * timeout and reuses stale keepalive sockets, causing connect timeouts on
 * an upstream-half-closed pool. CLAUDE.md §6 has the full write-up.
 *
 * Only the v1 endpoints we actually use are wrapped:
 *   POST /v1/crawl       — start an async crawl
 *   GET  /v1/crawl/:id   — poll status / fetch results (with optional `next`)
 *
 * Polls — does not wire up webhooks (locked decision §7). The shape we
 * expose isolates the rest of the pipeline from Firecrawl's field renames.
 */

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const START_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 30_000;
// Fence pagination so a runaway `next` chain can't pin the worker.
const MAX_RESULT_PAGES = 20;

export type CrawlPage = {
  url: string;
  title: string | null;
  markdown: string;
};

/**
 * Internal state after collapsing Firecrawl's "cancelled" alongside "failed":
 * the rest of the pipeline doesn't care which kind of unhappy ending we got.
 */
export type CrawlState = "scraping" | "completed" | "failed";

export type CrawlStatus = {
  jobId: string;
  state: CrawlState;
  pagesCrawled: number;
  totalPages: number; // running estimate from Firecrawl
  error?: string;
};

type FirecrawlStartResponse = {
  success?: boolean;
  id?: string;
  url?: string;
  error?: string;
};

type FirecrawlDocumentMetadata = {
  sourceURL?: string;
  url?: string;
  title?: string;
};

type FirecrawlDocument = {
  markdown?: string;
  url?: string;
  metadata?: FirecrawlDocumentMetadata;
};

type FirecrawlStatusResponse = {
  success?: boolean;
  status?: "scraping" | "completed" | "failed" | "cancelled";
  completed?: number;
  total?: number;
  data?: FirecrawlDocument[];
  next?: string | null;
  error?: string;
};

function apiKey(): string {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set");
  return k;
}

/**
 * Map a non-2xx HTTP status to a permanent or transient error. Caller
 * keeps the (already-read) response body so the message is informative.
 *
 * Permanent: 4xx except 429 — the same request will fail the same way on
 *            retry, so flip the source to ERROR and stop burning attempts.
 * Transient: 5xx, 429 — upstream is having a moment; let BullMQ retry.
 */
function classifyHttpError(status: number, bodyText: string): never {
  const message = `Firecrawl ${status}: ${bodyText.slice(0, 500)}`;
  if (status >= 400 && status < 500 && status !== 429) {
    throw new PermanentError(message);
  }
  throw new Error(message);
}

/**
 * Wrap a fetch with an explicit AbortSignal.timeout. AbortError surfaces
 * as a plain Error (transient): the worker retries on the next attempt,
 * but won't hang indefinitely on a stalled response.
 */
async function firecrawlFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`Firecrawl request timed out after ${timeoutMs} ms: ${url}`);
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Firecrawl request aborted: ${url}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function startCrawl(args: {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  sameDomainOnly?: boolean;
}): Promise<{ jobId: string }> {
  const sameDomain = args.sameDomainOnly ?? SAME_DOMAIN_ONLY;
  const body = {
    url: args.url,
    limit: args.maxPages ?? MAX_PAGES_PER_CRAWL,
    maxDepth: args.maxDepth ?? MAX_CRAWL_DEPTH,
    allowBackwardLinks: false,
    allowExternalLinks: !sameDomain,
    scrapeOptions: { formats: ["markdown"] },
  };

  const res = await firecrawlFetch(
    `${FIRECRAWL_BASE_URL}/v1/crawl`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    START_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    classifyHttpError(res.status, text);
  }
  const json = (await res.json()) as FirecrawlStartResponse;
  if (!json.success || !json.id) {
    // The API returned 2xx but the response shape is bad — treat as
    // permanent so we don't retry against an unsupported endpoint.
    throw new PermanentError(
      `Firecrawl start response invalid: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { jobId: json.id };
}

async function getStatusRaw(url: string): Promise<FirecrawlStatusResponse> {
  const res = await firecrawlFetch(
    url,
    { headers: { authorization: `Bearer ${apiKey()}` } },
    STATUS_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    classifyHttpError(res.status, text);
  }
  return (await res.json()) as FirecrawlStatusResponse;
}

export async function getCrawlStatus(jobId: string): Promise<CrawlStatus> {
  const r = await getStatusRaw(`${FIRECRAWL_BASE_URL}/v1/crawl/${jobId}`);
  // Collapse "cancelled" into "failed" — both are terminal-and-unhappy.
  const state: CrawlState =
    r.status === "completed"
      ? "completed"
      : r.status === "scraping"
        ? "scraping"
        : "failed";
  return {
    jobId,
    state,
    pagesCrawled: r.completed ?? 0,
    totalPages: r.total ?? 0,
    error: state === "failed" ? `Firecrawl status=${r.status ?? "<unknown>"}` : undefined,
  };
}

export async function fetchCrawlPages(jobId: string): Promise<CrawlPage[]> {
  // Walk the `next` chain so we don't lose pages when Firecrawl paginates.
  // Bounded so a runaway response can't pin the worker.
  const docs: FirecrawlDocument[] = [];
  let next: string | null = `${FIRECRAWL_BASE_URL}/v1/crawl/${jobId}`;
  for (let i = 0; i < MAX_RESULT_PAGES && next; i++) {
    const r: FirecrawlStatusResponse = await getStatusRaw(next);
    if (i === 0 && r.status !== "completed") {
      throw new Error(`Crawl ${jobId} not completed (status=${r.status ?? "<unknown>"})`);
    }
    if (Array.isArray(r.data)) docs.push(...r.data);
    next = r.next ?? null;
  }

  return docs
    .filter((p) => typeof p.markdown === "string" && p.markdown.length > 0)
    .map((p) => ({
      url: p.metadata?.sourceURL ?? p.metadata?.url ?? p.url ?? "",
      title: p.metadata?.title ?? null,
      markdown: p.markdown ?? "",
    }));
}
