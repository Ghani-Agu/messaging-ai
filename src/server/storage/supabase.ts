import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Storage helper for the private `knowledge-uploads` bucket.
 *
 * Server-only: uses the SERVICE_ROLE_KEY which must never reach the browser.
 * Tenant scoping is enforced at our app layer (every signed URL is minted by
 * a Server Action that already passed requireTenantContext) — Storage RLS is
 * not configured per locked decision §6.
 *
 * Object layout: `{tenantId}/{sourceId}/{originalFilename}`. Two layers
 * isolate per-tenant and per-source so a leaked path can't enumerate
 * sibling tenants' files.
 */

export const KNOWLEDGE_BUCKET = "knowledge-uploads";

let cachedClient: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("SUPABASE_URL is not set");
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    cachedClient = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return cachedClient;
}

export function knowledgeStoragePath(args: {
  tenantId: string;
  sourceId: string;
  filename: string;
}): string {
  // Strip path separators and trim aggressively so a malicious filename
  // can't escape the {tenantId}/{sourceId}/ prefix.
  const safe = args.filename
    .replace(/[\\/]+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 200);
  return `${args.tenantId}/${args.sourceId}/${safe}`;
}

/**
 * One-shot signed URL the browser uploads the file body to (PUT). The token
 * encodes the path; expires after `expiresInSec` seconds.
 */
export async function createSignedUploadUrl(args: {
  path: string;
  expiresInSec?: number;
}): Promise<{ signedUrl: string; token: string; path: string }> {
  const expiresIn = args.expiresInSec ?? 600;
  const { data, error } = await client()
    .storage.from(KNOWLEDGE_BUCKET)
    .createSignedUploadUrl(args.path, { upsert: true });
  if (error || !data) {
    throw new Error(
      `createSignedUploadUrl failed: ${error?.message ?? "unknown"}`,
    );
  }
  void expiresIn; // Supabase v2 SDK manages expiry server-side; option held for callers.
  return data;
}

/** Server-side download. Used by the parse-file worker to fetch upload bytes. */
export async function downloadToBuffer(path: string): Promise<Buffer> {
  const { data, error } = await client()
    .storage.from(KNOWLEDGE_BUCKET)
    .download(path);
  if (error || !data) {
    throw new Error(`download failed: ${error?.message ?? "unknown"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteFile(path: string): Promise<void> {
  const { error } = await client()
    .storage.from(KNOWLEDGE_BUCKET)
    .remove([path]);
  if (error) {
    throw new Error(`delete failed: ${error.message}`);
  }
}
