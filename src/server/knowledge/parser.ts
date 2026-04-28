import "server-only";

/**
 * LlamaParse wrapper over plain fetch. Polls — does not wire up webhooks.
 *
 * Endpoints used (LlamaParse Cloud, ~Phase 3 stable):
 *   POST /api/parsing/upload                   → { id }
 *   GET  /api/parsing/job/{id}                 → { status: "PENDING|SUCCESS|ERROR", error?: string }
 *   GET  /api/parsing/job/{id}/result/markdown → { markdown: string }
 *
 * The wrapper exposes the same poll-shaped surface as crawler.ts so the
 * worker can drive both with one pattern.
 */

const BASE_URL = "https://api.cloud.llamaindex.ai";

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

  const res = await fetch(`${BASE_URL}/api/parsing/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`LlamaParse upload ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("LlamaParse upload response missing id");
  }
  return { jobId: json.id };
}

export async function getParseStatus(jobId: string): Promise<ParseStatus> {
  const res = await fetch(`${BASE_URL}/api/parsing/job/${jobId}`, {
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    return { jobId, state: "ERROR", error: `status ${res.status}` };
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
  const res = await fetch(
    `${BASE_URL}/api/parsing/job/${jobId}/result/markdown`,
    { headers: { authorization: `Bearer ${apiKey()}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`LlamaParse result ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { markdown?: string };
  return { markdown: json.markdown ?? "" };
}
