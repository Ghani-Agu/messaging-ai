"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  appendSourceLog,
  createSource,
  getSource,
} from "@/server/db/knowledge";
import { enqueueCrawlWebsite, enqueueParseFile } from "@/server/queue/jobs";
import {
  createSignedUploadUrl,
  knowledgeStoragePath,
} from "@/server/storage/supabase";
import { MAX_FILE_BYTES } from "./limits";
import { prisma } from "@/server/db/client";

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

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const fileMetadataSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Filename is required")
    .max(255, "Filename is too long"),
  mime: z
    .string()
    .refine((m) => ALLOWED_MIMES.has(m), {
      message: "Only PDF, DOCX, and plain-text files are accepted",
    }),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_BYTES, `File exceeds ${MAX_FILE_BYTES} bytes`),
});

/**
 * First leg of the file-upload flow. Server pre-generates the source row
 * (and therefore the storage path), mints a one-shot signed upload URL,
 * and returns it. The browser PUTs the file body to that URL directly,
 * then calls finalizeFileUpload to enqueue parsing.
 */
export async function createFileSource(
  slug: string,
  input: { filename: string; mime: string; size: number },
): Promise<{ sourceId: string; signedUrl: string; storagePath: string }> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const { filename, mime, size } = fileMetadataSchema.parse(input);

  // Pre-generate the source ID so we can derive the storage path before
  // creating the row — the row's sourceUrl stores that path.
  const sourceId = randomUUID();
  const storagePath = knowledgeStoragePath({
    tenantId: ctx.tenant.id,
    sourceId,
    filename,
  });

  // Insert the row directly (helper auto-generates IDs; we need a specific
  // one here to keep storagePath in lockstep).
  await prisma.knowledgeSource.create({
    data: {
      id: sourceId,
      tenantId: ctx.tenant.id,
      type: "FILE",
      name: filename,
      sourceUrl: storagePath,
      metadata: { mime, size },
    },
  });
  await appendSourceLog({
    sourceId,
    level: "info",
    text: `Awaiting upload: ${filename}`,
  });

  const { signedUrl } = await createSignedUploadUrl({ path: storagePath });
  return { sourceId, signedUrl, storagePath };
}

export async function finalizeFileUpload(
  slug: string,
  input: { sourceId: string },
): Promise<void> {
  const ctx = await requireTenantContext(slug, { minRole: "AGENT" });
  const source = await getSource({
    tenantId: ctx.tenant.id,
    sourceId: input.sourceId,
  });
  if (!source) throw new Error("Source not found");
  if (source.type !== "FILE") {
    throw new Error("finalizeFileUpload called on a non-FILE source");
  }
  if (!source.sourceUrl) {
    throw new Error("File source has no storage path");
  }
  await appendSourceLog({
    sourceId: source.id,
    level: "info",
    text: "Upload finalized; parse queued",
  });
  await enqueueParseFile({
    sourceId: source.id,
    tenantId: ctx.tenant.id,
    storagePath: source.sourceUrl,
    filename: source.name,
  });
}
