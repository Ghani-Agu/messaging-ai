import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embed, __resetCircuitBreakerForTests } from "./embeddings";

const VOYAGE_RE = /api\.voyageai\.com/;
const OPENAI_RE = /api\.openai\.com/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function singleVector(vector: number[]): Response {
  return jsonResponse({ data: [{ embedding: vector, index: 0 }] });
}

describe("embed()", () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-voyage-key";
    process.env.OPENAI_API_KEY = "test-openai-key";
    __resetCircuitBreakerForTests();
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("uses Voyage on the happy path", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) return singleVector([0.1, 0.2, 0.3]);
      throw new Error(`unexpected url ${url}`);
    });
    const r = await embed({ inputs: ["hello"], inputType: "document" });
    expect(r.provider).toBe("voyage");
    expect(r.model).toBe("voyage-3-large");
    expect(r.vectors).toEqual([[0.1, 0.2, 0.3]]);
  });

  it("falls back to OpenAI when Voyage 5xx", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) return new Response("Service Unavailable", { status: 503 });
      if (OPENAI_RE.test(url)) return singleVector([0.4, 0.5, 0.6]);
      throw new Error(`unexpected url ${url}`);
    });
    const r = await embed({ inputs: ["hello"], inputType: "document" });
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("text-embedding-3-small");
    expect(r.vectors).toEqual([[0.4, 0.5, 0.6]]);
  });

  it("falls back to OpenAI when Voyage fetch throws (network error)", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) throw new TypeError("fetch failed");
      if (OPENAI_RE.test(url)) return singleVector([0.7]);
      throw new Error(`unexpected url ${url}`);
    });
    const r = await embed({ inputs: ["hello"], inputType: "document" });
    expect(r.provider).toBe("openai");
    expect(r.vectors).toEqual([[0.7]]);
  });

  it("opens the circuit after 5 failures and skips Voyage", async () => {
    let voyageCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) {
        voyageCalls++;
        return new Response("err", { status: 500 });
      }
      if (OPENAI_RE.test(url)) return singleVector([0]);
      throw new Error(`unexpected url ${url}`);
    });

    // Five Voyage failures, each one falling back to OpenAI.
    for (let i = 0; i < 5; i++) {
      const r = await embed({ inputs: ["x"], inputType: "document" });
      expect(r.provider).toBe("openai");
    }
    expect(voyageCalls).toBe(5);

    // Sixth call: circuit is open, Voyage is skipped entirely.
    const r = await embed({ inputs: ["x"], inputType: "document" });
    expect(r.provider).toBe("openai");
    expect(voyageCalls).toBe(5);
  });

  it("preserves input order when the provider returns shuffled indices", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) {
        return jsonResponse({
          data: [
            { embedding: [3], index: 2 },
            { embedding: [1], index: 0 },
            { embedding: [2], index: 1 },
          ],
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const r = await embed({ inputs: ["a", "b", "c"], inputType: "document" });
    expect(r.vectors).toEqual([[1], [2], [3]]);
  });

  it("returns an empty result without calling either provider on empty input", async () => {
    const r = await embed({ inputs: [], inputType: "document" });
    expect(r.vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards inputType=query as input_type to Voyage", async () => {
    let bodySeen: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (VOYAGE_RE.test(url)) {
        bodySeen = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return singleVector([0]);
      }
      throw new Error(`unexpected url ${url}`);
    });
    await embed({ inputs: ["hi"], inputType: "query" });
    expect(bodySeen).toMatchObject({
      model: "voyage-3-large",
      input_type: "query",
      output_dimension: 1024,
    });
  });
});
