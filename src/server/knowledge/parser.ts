import "server-only";
import { PermanentError } from "./errors";

/**
 * LlamaParse wrapper over plain fetch. Polls — does not wire up webhooks.
 *
 * Endpoints used (LlamaParse Cloud, ~Phase 3 stable):
 *   POST /api/parsing/upload                   → { id }
 *   GET  /api/parsing/job/{id}                 → { status: "PENDING|SUCCESS|ERROR", error?: string }
 *   GET  /api/parsing/job/{id}/result/markdown → { markdown: string }
 *
 * The wrapper exposes the same poll-shaped surface as crawler.ts so the
 * worker can drive both with one pattern. Same explicit-timeout +
 * permanent/transient classification we added to crawler.ts after the
 * Firecrawl ETIMEDOUT incident — see CLAUDE.md §6.
 */

const BASE_URL = "https://api.cloud.llamaindex.ai";
const START_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 30_000;

export type ParseState = "PENDING" | "SUCCESS" | "ERROR";

export type ParseStatus = {
  jobId: string;
  state: ParseState;
  error?: string;
};

export type ParsedDocument = {
  /** Combined markdown across all pages, separated by `\n\n---\n\n`. */
  markdown: string;
};

function apiKey(): string {
  const k = process.env.LLAMAPARSE_API_KEY;
  if (!k) throw new Error("LLAMAPARSE_API_KEY is not set");
  return k;
}

/**
 * 4xx (except 429) → permanent: bad upload, expired token, etc. won't fix
 * itself on retry. Everything else (5xx, 429, network, AbortError) stays
 * transient so BullMQ keeps trying.
 */
function classifyHttpError(status: number, bodyText: string): never {
  const message = `LlamaParse ${status}: ${bodyText.slice(0, 500)}`;
  if (status >= 400 && status < 500 && status !== 429) {
    throw new PermanentError(message);
  }
  throw new Error(message);
}

async function llamaFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`LlamaParse request timed out after ${timeoutMs} ms: ${url}`);
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`LlamaParse request aborted: ${url}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function startParse(args: {
  fileBuffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{ jobId: string }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(args.fileBuffer)], { type: args.mime }),
    args.filename,
  );
  // Defaults are reasonable for our use case; stay on `markdown` output.
  form.append("result_type", "markdown");

  const res = await llamaFetch(
    `${BASE_URL}/api/parsing/upload`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}` },
      body: form,
    },
    START_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    classifyHttpError(res.status, text);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new PermanentError("LlamaParse upload response missing id");
  }
  return { jobId: json.id };
}

export async function getParseStatus(jobId: string): Promise<ParseStatus> {
  const res = await llamaFetch(
    `${BASE_URL}/api/parsing/job/${jobId}`,
    { headers: { authorization: `Bearer ${apiKey()}` } },
    STATUS_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    classifyHttpError(res.status, text);
  }
  const json = (await res.json()) as { status?: string; error?: string };
  const state: ParseState =
    json.status === "SUCCESS"
      ? "SUCCESS"
      : json.status === "ERROR" || json.status === "CANCELLED"
        ? "ERROR"
        : "PENDING";
  return { jobId, state, error: json.error };
}

export async function fetchParseResult(jobId: string): Promise<ParsedDocument> {
  const res = await llamaFetch(
    `${BASE_URL}/api/parsing/job/${jobId}/result/markdown`,
    { headers: { authorization: `Bearer ${apiKey()}` } },
    STATUS_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    classifyHttpError(res.status, text);
  }
  const json = (await res.json()) as { markdown?: string };
  return { markdown: json.markdown ?? "" };
}
