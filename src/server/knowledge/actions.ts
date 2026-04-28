"use server";

import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  appendSourceLog,
  createSource,
} from "@/server/db/knowledge";
import { enqueueCrawlWebsite } from "@/server/queue/jobs";

/**
 * Phase-3 Server Actions — the entrypoints from the Knowledge page UI to
 * the ingestion pipeline. Every action resolves the tenant context from
 * the URL slug + session before doing any work; client-supplied tenantId
 * is never trusted (CLAUDE.md hard rule).
 */

const websiteUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .max(2048, "URL is too long")
  .url()
  .refine((s) => /^https?:\/\//i.test(s), "URL must use http or https");

export async function createWebsiteSource(
  slug: string,
  input: { url: string },
): Promise<{ sourceId: string }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const url = websiteUrlSchema.parse(input.url);
  const hostname = new URL(url).hostname;

  const { id: sourceId } = await createSource({
    tenantId: ctx.tenant.id,
    type: "WEBSITE",
    name: hostname,
    sourceUrl: url,
  });
  await appendSourceLog({
    sourceId,
    level: "info",
    text: `Crawl queued for ${url}`,
  });
  await enqueueCrawlWebsite({
    sourceId,
    tenantId: ctx.tenant.id,
    rootUrl: url,
  });
  return { sourceId };
}
