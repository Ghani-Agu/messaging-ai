"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  appendSourceLog,
  attachEmbeddings,
  createSource,
  deleteChunksForSource,
  deleteSource as deleteSourceDb,
  getSource,
  insertChunksWithoutEmbeddings,
  listSourcesForTenant,
  markSourceVerified,
  maybeMarkSourceReady,
  type SourceSummary,
  updateSourceStatus,
} from "@/server/db/knowledge";
import { embed } from "@/server/ai/embeddings";
import { chunkPlainText } from "@/server/knowledge/chunker";
import {
  retrieve,
  type RetrievedChunk,
} from "@/server/knowledge/retriever";
import { enqueueCrawlWebsite, enqueueParseFile } from "@/server/queue/jobs";
import {
  createSignedUploadUrl,
  deleteFile,
  knowledgeStoragePath,
} from "@/server/storage/supabase";
import { MAX_FILE_BYTES, MAX_MANUAL_CONTENT_CHARS } from "./limits";
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
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
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
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
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
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// Manual entries
// ─────────────────────────────────────────────────────────────────────────────

const manualEntrySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(MAX_MANUAL_CONTENT_CHARS, `Content exceeds ${MAX_MANUAL_CONTENT_CHARS} characters`),
});

/**
 * Manual entries skip the queue entirely — chunking + embedding finish in
 * a couple of seconds, so we run them inline. The original text is kept
 * in metadata.rawContent so reingestSource can re-chunk without losing
 * what the user typed (blocking revision #5).
 */
export async function createManualSource(
  slug: string,
  input: { name: string; content: string },
): Promise<{ sourceId: string }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
  const { name, content } = manualEntrySchema.parse(input);

  const { id: sourceId } = await createSource({
    tenantId: ctx.tenant.id,
    type: "MANUAL",
    name,
    sourceUrl: null,
    metadata: { rawContent: content },
  });
  await runManualIngestion({
    sourceId,
    tenantId: ctx.tenant.id,
    content,
  });
  return { sourceId };
}

/** Inline chunk + embed + insert + READY transition. Used by both create and reingest. */
async function runManualIngestion(args: {
  sourceId: string;
  tenantId: string;
  content: string;
}): Promise<void> {
  await updateSourceStatus({
    sourceId: args.sourceId,
    status: "PROCESSING",
    error: null,
  });
  const chunks = chunkPlainText({ content: args.content });
  if (chunks.length === 0) {
    await updateSourceStatus({
      sourceId: args.sourceId,
      status: "ERROR",
      error: "Content produced no chunks",
    });
    throw new Error("Content produced no chunks");
  }
  const { chunkIds } = await insertChunksWithoutEmbeddings({
    tenantId: args.tenantId,
    sourceId: args.sourceId,
    chunks,
  });
  const result = await embed({
    inputs: chunks.map((c) => c.content),
    inputType: "document",
  });
  await attachEmbeddings({ chunkIds, vectors: result.vectors });
  await updateSourceStatus({
    sourceId: args.sourceId,
    progress: {
      totalChunks: chunkIds.length,
      chunksEmbedded: chunkIds.length,
    },
  });
  await maybeMarkSourceReady(args.sourceId);
  await appendSourceLog({
    sourceId: args.sourceId,
    level: "ok",
    text: `Ready (embedded via ${result.provider})`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-ingest / delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forced re-do, branched by source type per blocking revision #5. Always
 * clears chunks first, then routes:
 *   WEBSITE — re-enqueue crawl-website on the existing rootUrl
 *   FILE    — re-enqueue parse-file on the existing storagePath (no re-upload)
 *   MANUAL  — re-chunk + re-embed inline from metadata.rawContent
 */
export async function reingestSource(
  slug: string,
  input: { sourceId: string },
): Promise<void> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
  const source = await getSource({
    tenantId: ctx.tenant.id,
    sourceId: input.sourceId,
  });
  if (!source) throw new Error("Source not found");

  await deleteChunksForSource(source.id);
  await updateSourceStatus({
    sourceId: source.id,
    status: "PENDING",
    error: null,
    progress: {},
  });
  await appendSourceLog({
    sourceId: source.id,
    level: "info",
    text: `Re-ingest requested`,
  });

  if (source.type === "WEBSITE") {
    if (!source.sourceUrl) throw new Error("WEBSITE source missing rootUrl");
    await enqueueCrawlWebsite({
      sourceId: source.id,
      tenantId: ctx.tenant.id,
      rootUrl: source.sourceUrl,
    });
    return;
  }
  if (source.type === "FILE") {
    if (!source.sourceUrl) throw new Error("FILE source missing storagePath");
    await enqueueParseFile({
      sourceId: source.id,
      tenantId: ctx.tenant.id,
      storagePath: source.sourceUrl,
      filename: source.name,
    });
    return;
  }
  // MANUAL — re-chunk + re-embed inline.
  const meta = source.metadata as { rawContent?: unknown } | null;
  const rawContent = typeof meta?.rawContent === "string" ? meta.rawContent : "";
  if (!rawContent) {
    throw new Error("Manual source missing rawContent — cannot re-ingest");
  }
  await runManualIngestion({
    sourceId: source.id,
    tenantId: ctx.tenant.id,
    content: rawContent,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing — used by the polling UI on the Knowledge page
// ─────────────────────────────────────────────────────────────────────────────

export async function listSources(slug: string): Promise<SourceSummary[]> {
  const ctx = await requireTenantContext(slug, {
    minRole: "VIEWER",
    requiredPermission: "documents:view",
  });
  return listSourcesForTenant(ctx.tenant.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval test
// ─────────────────────────────────────────────────────────────────────────────

const retrievalQuerySchema = z.object({
  query: z.string().trim().min(1, "Query is required").max(1000, "Query is too long"),
  topK: z.number().int().min(1).max(20),
});

export async function runRetrieval(
  slug: string,
  input: { query: string; topK: number },
): Promise<RetrievedChunk[]> {
  const ctx = await requireTenantContext(slug, {
    minRole: "VIEWER",
    requiredPermission: "documents:view",
  });
  const { query, topK } = retrievalQuerySchema.parse(input);
  return retrieve({ tenantId: ctx.tenant.id, query, topK });
}

// ─────────────────────────────────────────────────────────────────────────────
// Freshness — Phase 8g operator-asserted "still correct" stamp.
// ─────────────────────────────────────────────────────────────────────────────

export async function markSourceVerifiedAction(
  slug: string,
  input: { sourceId: string },
): Promise<{ ok: true }> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
  await markSourceVerified({ tenantId: ctx.tenant.id, sourceId: input.sourceId });
  return { ok: true };
}

export async function deleteSource(
  slug: string,
  input: { sourceId: string },
): Promise<void> {
  const ctx = await requireTenantContext(slug, {
    minRole: "AGENT",
    requiredPermission: "documents:edit",
  });
  const source = await getSource({
    tenantId: ctx.tenant.id,
    sourceId: input.sourceId,
  });
  if (!source) return; // already gone — idempotent

  // Best-effort delete from storage for FILE sources before the row goes.
  if (source.type === "FILE" && source.sourceUrl) {
    try {
      await deleteFile(source.sourceUrl);
    } catch (err) {
      // Don't block the row deletion on a missing object — it may have
      // been cleaned up out of band. Log and proceed.
      console.warn(
        `[deleteSource] storage delete failed for ${source.id}:`,
        err,
      );
    }
  }
  await deleteSourceDb({ tenantId: ctx.tenant.id, sourceId: source.id });
}
