import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCrawl } from "./crawler";
import { PermanentError } from "./errors";

/**
 * Verifies the permanent-vs-transient classification contract that lets
 * the BullMQ worker decide whether to retry. PermanentError extends
 * UnrecoverableError, which BullMQ recognises as "stop retrying."
 */
describe("crawler — error classification", () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("4xx (not 429) → PermanentError (no BullMQ retry)", async () => {
    fetchMock.mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );
    await expect(
      startCrawl({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it("401 → PermanentError", async () => {
    fetchMock.mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(
      startCrawl({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it("429 → transient Error (BullMQ retries)", async () => {
    fetchMock.mockResolvedValue(
      new Response("Too Many Requests", { status: 429 }),
    );
    const promise = startCrawl({ url: "https://example.com" });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("5xx → transient Error (BullMQ retries)", async () => {
    fetchMock.mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );
    const promise = startCrawl({ url: "https://example.com" });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("503 → transient Error (BullMQ retries)", async () => {
    fetchMock.mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );
    const promise = startCrawl({ url: "https://example.com" });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("AbortError (timeout) → transient Error (BullMQ retries)", async () => {
    // Simulate AbortSignal.timeout firing: fetch rejects with a
    // TimeoutError DOMException. crawler.ts re-throws it as a plain Error.
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    const promise = startCrawl({ url: "https://example.com" });
    await expect(promise).rejects.toThrow(/timed out/);
    await expect(promise).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("network error (e.g. ETIMEDOUT) → transient Error (BullMQ retries)", async () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ETIMEDOUT" },
    });
    fetchMock.mockRejectedValue(err);
    const promise = startCrawl({ url: "https://example.com" });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(PermanentError);
  });

  it("happy path returns the job id", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, id: "job-abc-123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await startCrawl({ url: "https://example.com" });
    expect(r.jobId).toBe("job-abc-123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.firecrawl.dev/v1/crawl");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer test-key",
    );
    // Every call must carry an explicit AbortSignal — the whole point of
    // this rewrite. Without it we are back to the old hang.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("2xx with malformed body → PermanentError (the endpoint changed)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "bad" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      startCrawl({ url: "https://example.com" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});
