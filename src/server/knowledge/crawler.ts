import "server-only";
import Firecrawl from "@mendable/firecrawl-js";
import {
  MAX_CRAWL_DEPTH,
  MAX_PAGES_PER_CRAWL,
  SAME_DOMAIN_ONLY,
} from "./limits";

/**
 * Firecrawl wrapper. Polls — does not wire up webhooks (locked decision §7).
 *
 * Phase-3 stays on the v1 SDK surface (`client.v1.*`). The shape we expose
 * here isolates the rest of the pipeline from Firecrawl's field renames
 * across SDK versions — if the upstream API moves, only this file chases it.
 */

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

let cachedClient: Firecrawl | null = null;
function client(): Firecrawl {
  if (!cachedClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
    cachedClient = new Firecrawl({ apiKey });
  }
  return cachedClient;
}

export async function startCrawl(args: {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  sameDomainOnly?: boolean;
}): Promise<{ jobId: string }> {
  const sameDomain = args.sameDomainOnly ?? SAME_DOMAIN_ONLY;
  const result = await client().v1.asyncCrawlUrl(args.url, {
    limit: args.maxPages ?? MAX_PAGES_PER_CRAWL,
    maxDepth: args.maxDepth ?? MAX_CRAWL_DEPTH,
    allowBackwardLinks: false,
    allowExternalLinks: !sameDomain,
    scrapeOptions: { formats: ["markdown"] },
  });
  if (!result.success) {
    throw new Error(`Firecrawl rejected crawl: ${result.error}`);
  }
  if (!result.id) {
    throw new Error("Firecrawl response missing job id");
  }
  return { jobId: result.id };
}

export async function getCrawlStatus(jobId: string): Promise<CrawlStatus> {
  const r = await client().v1.checkCrawlStatus(jobId);
  if (!r.success) {
    return {
      jobId,
      state: "failed",
      pagesCrawled: 0,
      totalPages: 0,
      error: r.error,
    };
  }
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
    pagesCrawled: r.completed,
    totalPages: r.total,
    error: state === "failed" ? `Firecrawl status=${r.status}` : undefined,
  };
}

export async function fetchCrawlPages(jobId: string): Promise<CrawlPage[]> {
  // Pull the full document set in one call. For larger crawls, Firecrawl
  // exposes pagination via `next` — Phase 3 stays at MAX_PAGES_PER_CRAWL=50
  // so we don't need to follow it yet.
  const r = await client().v1.checkCrawlStatus(jobId, true);
  if (!r.success) {
    throw new Error(`Failed to fetch crawl results: ${r.error}`);
  }
  if (r.status !== "completed") {
    throw new Error(`Crawl ${jobId} not completed (status=${r.status})`);
  }
  return r.data
    .filter((p) => typeof p.markdown === "string" && p.markdown.length > 0)
    .map((p) => ({
      url: p.metadata?.sourceURL ?? p.metadata?.url ?? p.url ?? "",
      title: p.metadata?.title ?? null,
      markdown: p.markdown ?? "",
    }));
}
