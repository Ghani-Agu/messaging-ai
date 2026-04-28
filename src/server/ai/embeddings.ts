import "server-only";

/**
 * Unified embedding client.
 *
 * Voyage AI (`voyage-3-large` @ 1024 dims) is the primary; OpenAI
 * (`text-embedding-3-small` @ 1024 dims) is the fallback. Both produce
 * 1024-dim vectors that share a single pgvector column and a single HNSW
 * index — callers never see provider-specific behavior.
 *
 * Two layers of failure handling:
 *
 *  1. Per-call failover. A Voyage error (5xx, network failure, timeout)
 *     transparently falls through to OpenAI within the same `embed()` call.
 *
 *  2. Sliding-window circuit breaker. Five Voyage failures within 60 s
 *     opens the circuit for 5 min, during which Voyage is skipped entirely.
 *     After the open window expires, the next call is a half-open probe:
 *     success closes the circuit, failure re-opens it. State is held at
 *     module scope, so the web process and the worker process maintain
 *     independent breakers — sufficient for v1.
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const OPENAI_URL = "https://api.openai.com/v1/embeddings";

const VOYAGE_MODEL = "voyage-3-large";
const OPENAI_MODEL = "text-embedding-3-small";

const EMBED_DIMS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;
// Stay comfortably under both providers' batch limits (Voyage: 128, OpenAI: 2048).
const PER_CALL_BATCH = 96;

const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 5 * 60_000;

export type EmbedInputType = "document" | "query";
export type EmbedProvider = "voyage" | "openai";

export type EmbedResult = {
  vectors: number[][];
  provider: EmbedProvider;
  model: typeof VOYAGE_MODEL | typeof OPENAI_MODEL;
};

type CircuitState = {
  failures: number[];
  openedAt: number | null;
};

const circuit: CircuitState = { failures: [], openedAt: null };

function isCircuitOpen(now: number): boolean {
  return circuit.openedAt != null && now - circuit.openedAt < OPEN_DURATION_MS;
}

function recordVoyageFailure(now: number): void {
  circuit.failures = circuit.failures.filter((ts) => now - ts < FAILURE_WINDOW_MS);
  circuit.failures.push(now);
  if (circuit.failures.length >= FAILURE_THRESHOLD) {
    circuit.openedAt = now;
    circuit.failures = [];
  }
}

function recordVoyageSuccess(): void {
  circuit.failures = [];
  circuit.openedAt = null;
}

/** Reset breaker state. Exposed for tests; do not call from app code. */
export function __resetCircuitBreakerForTests(): void {
  circuit.failures = [];
  circuit.openedAt = null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type EmbeddingsApiResponse = {
  data: Array<{ embedding: number[]; index: number }>;
};

async function postEmbeddings(args: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
}): Promise<number[][]> {
  const res = await fetchWithTimeout(
    args.url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.body),
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`Embedding provider returned ${res.status}: ${text}`);
  }
  const json = (await res.json()) as EmbeddingsApiResponse;
  // Sort by `index` so the returned vectors line up with the input array
  // even if the provider returns them out of order.
  json.data.sort((a, b) => a.index - b.index);
  return json.data.map((d) => d.embedding);
}

async function callVoyage(args: {
  inputs: string[];
  inputType: EmbedInputType;
}): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");
  const all: number[][] = [];
  for (const batch of chunkArray(args.inputs, PER_CALL_BATCH)) {
    const vectors = await postEmbeddings({
      url: VOYAGE_URL,
      apiKey,
      body: {
        model: VOYAGE_MODEL,
        input: batch,
        input_type: args.inputType,
        output_dimension: EMBED_DIMS,
      },
    });
    all.push(...vectors);
  }
  return all;
}

async function callOpenAi(args: { inputs: string[] }): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const all: number[][] = [];
  for (const batch of chunkArray(args.inputs, PER_CALL_BATCH)) {
    const vectors = await postEmbeddings({
      url: OPENAI_URL,
      apiKey,
      body: {
        model: OPENAI_MODEL,
        input: batch,
        dimensions: EMBED_DIMS,
      },
    });
    all.push(...vectors);
  }
  return all;
}

/**
 * Embed `inputs` into 1024-dim vectors. Empty input returns an empty vector
 * list without hitting either provider. The returned `provider` and `model`
 * reflect which path produced the vectors (for logging only — the column
 * type and index are provider-agnostic).
 */
export async function embed(args: {
  inputs: string[];
  inputType: EmbedInputType;
}): Promise<EmbedResult> {
  if (args.inputs.length === 0) {
    return { vectors: [], provider: "voyage", model: VOYAGE_MODEL };
  }

  const now = Date.now();
  if (!isCircuitOpen(now)) {
    try {
      const vectors = await callVoyage({ inputs: args.inputs, inputType: args.inputType });
      // Counts as either a normal success or a successful half-open probe;
      // either way, fully reset the breaker.
      recordVoyageSuccess();
      return { vectors, provider: "voyage", model: VOYAGE_MODEL };
    } catch {
      // Use Date.now() again — the call may have taken seconds.
      recordVoyageFailure(Date.now());
      // Fall through to OpenAI.
    }
  }

  const vectors = await callOpenAi({ inputs: args.inputs });
  return { vectors, provider: "openai", model: OPENAI_MODEL };
}
