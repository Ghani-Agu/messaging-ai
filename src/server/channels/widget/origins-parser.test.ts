import { describe, expect, it } from "vitest";
import { ORIGIN_MAX_COUNT, originsTextSchema } from "./origins-parser";

/**
 * The tests assert canonicalization, splitting, deduping, capping, and the
 * per-line error path that the form's UI uses to render "Line N: …" under
 * the textarea. These cases mirror the user-facing flows: typing a URL with
 * a trailing slash, mixing protocols, pasting a comma-separated list, etc.
 */

describe("originsTextSchema — canonicalization", () => {
  it("strips trailing slash, path, query, and hash", () => {
    const out = originsTextSchema.parse(
      "https://example.com/some/path?x=1#frag",
    );
    expect(out).toEqual(["https://example.com"]);
  });

  it("lowercases the host", () => {
    const out = originsTextSchema.parse("https://Example.COM");
    expect(out).toEqual(["https://example.com"]);
  });

  it("strips default ports (443 for https, 80 for http)", () => {
    const out = originsTextSchema.parse(
      "https://example.com:443\nhttp://example.com:80",
    );
    expect(out).toEqual(["https://example.com", "http://example.com"]);
  });

  it("preserves non-default ports", () => {
    const out = originsTextSchema.parse("http://localhost:5173");
    expect(out).toEqual(["http://localhost:5173"]);
  });
});

describe("originsTextSchema — splitting + trimming", () => {
  it("splits on newlines", () => {
    const out = originsTextSchema.parse(
      "https://acme.com\nhttps://www.acme.com",
    );
    expect(out).toEqual(["https://acme.com", "https://www.acme.com"]);
  });

  it("splits on commas", () => {
    const out = originsTextSchema.parse(
      "https://acme.com, https://www.acme.com",
    );
    expect(out).toEqual(["https://acme.com", "https://www.acme.com"]);
  });

  it("handles mixed comma + newline + extra whitespace", () => {
    const out = originsTextSchema.parse(
      "  https://a.com  ,\n  https://b.com\n,https://c.com  ",
    );
    expect(out).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("filters out empty entries from trailing/leading separators", () => {
    const out = originsTextSchema.parse(",,\nhttps://a.com,\n\n");
    expect(out).toEqual(["https://a.com"]);
  });

  it("returns [] for empty input", () => {
    expect(originsTextSchema.parse("")).toEqual([]);
    expect(originsTextSchema.parse("\n\n  ,, ")).toEqual([]);
  });
});

describe("originsTextSchema — dedupe", () => {
  it("dedupes after canonicalization", () => {
    const out = originsTextSchema.parse(
      "https://example.com\nhttps://Example.com/\nhttps://example.com:443",
    );
    expect(out).toEqual(["https://example.com"]);
  });
});

describe("originsTextSchema — caps", () => {
  it(`rejects more than ${ORIGIN_MAX_COUNT} origins with a form-level message`, () => {
    const lines = Array.from(
      { length: ORIGIN_MAX_COUNT + 1 },
      (_, i) => `https://h${i}.example.com`,
    );
    const result = originsTextSchema.safeParse(lines.join("\n"));
    expect(result.success).toBe(false);
    if (!result.success) {
      // Form-level (not per-line) — empty path on the issue.
      const overflow = result.error.issues.find((i) =>
        i.message.includes(`Maximum ${ORIGIN_MAX_COUNT}`),
      );
      expect(overflow).toBeDefined();
      expect(overflow?.path).toEqual([]);
    }
  });

  it(`accepts exactly ${ORIGIN_MAX_COUNT} origins`, () => {
    const lines = Array.from(
      { length: ORIGIN_MAX_COUNT },
      (_, i) => `https://h${i}.example.com`,
    );
    const out = originsTextSchema.parse(lines.join("\n"));
    expect(out).toHaveLength(ORIGIN_MAX_COUNT);
  });
});

describe("originsTextSchema — per-line errors", () => {
  it("rejects a missing scheme with a per-line error path", () => {
    const result = originsTextSchema.safeParse(
      "https://good.com\nexample.com\nhttps://other.com",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "origins" && i.path[1] === 1,
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("not a valid origin");
    }
  });

  it("rejects a non-http(s) scheme with a per-line error", () => {
    const result = originsTextSchema.safeParse("ftp://files.example.com");
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "origins");
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["origins", 0]);
    }
  });

  it("reports multiple per-line errors with their original indices", () => {
    const result = originsTextSchema.safeParse(
      "bad-1\nhttps://ok.com\nbad-2",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const indices = result.error.issues
        .filter((i) => i.path[0] === "origins")
        .map((i) => i.path[1]);
      // Indices reflect the post-trim, post-empty-filter positions.
      expect(indices).toEqual([0, 2]);
    }
  });
});
