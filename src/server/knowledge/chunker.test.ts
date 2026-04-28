import { describe, expect, it } from "vitest";
import {
  chunkMarkdown,
  chunkPlainText,
  countTokens,
} from "./chunker";
import { TARGET_CHUNK_TOKENS } from "./limits";

describe("countTokens", () => {
  it("returns positive token count for non-empty text", () => {
    expect(countTokens("hello world")).toBeGreaterThan(0);
  });
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});

describe("chunkPlainText", () => {
  it("returns a single chunk for short input", () => {
    const chunks = chunkPlainText({ content: "Just a tiny bit of text." });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Just a tiny bit of text.");
    expect(chunks[0]!.metadata.position).toBe(0);
    expect(chunks[0]!.metadata.headingPath).toEqual([]);
  });

  it("returns no chunks for whitespace-only input", () => {
    expect(chunkPlainText({ content: "   \n\t  " })).toEqual([]);
  });

  it("splits long input into multiple chunks under the token budget", () => {
    // ~3000 tokens of paragraphs.
    const para =
      "The quick brown fox jumps over the lazy dog. ".repeat(40) +
      "The quick brown fox jumps over the lazy dog.";
    const content = Array.from({ length: 8 }, () => para).join("\n\n");
    const chunks = chunkPlainText({ content });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // Allow a small slack above the target due to overlap and atom rounding.
      expect(c.tokenCount).toBeLessThanOrEqual(TARGET_CHUNK_TOKENS + 50);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });

  it("applies overlap so adjacent chunks share content", () => {
    // Build content too big for one chunk so we know we'll get >=2 pieces.
    const para = "Word ".repeat(800);
    const chunks = chunkPlainText({ content: para });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // With overlap, the last chunk should contain text whose token count
    // is at least the overlap window — i.e. chunk[i] doesn't start with
    // brand-new tokens unrelated to chunk[i-1]. A weaker but reliable check:
    // total tokens across chunks should exceed the original token count.
    const total = chunks.reduce((n, c) => n + c.tokenCount, 0);
    expect(total).toBeGreaterThan(countTokens(para));
  });

  it("propagates sourceUrl and initialHeadingPath into metadata", () => {
    const chunks = chunkPlainText({
      content: "short",
      sourceUrl: "https://example.com/docs",
      initialHeadingPath: ["Docs"],
    });
    expect(chunks[0]!.metadata.url).toBe("https://example.com/docs");
    expect(chunks[0]!.metadata.headingPath).toEqual(["Docs"]);
  });
});

describe("chunkMarkdown", () => {
  it("tracks H1 / H2 / H3 breadcrumbs per section", () => {
    const md = [
      "# Top",
      "Intro paragraph.",
      "",
      "## Shipping",
      "Shipping details here.",
      "",
      "### Domestic",
      "Domestic only stuff.",
      "",
      "## Returns",
      "Return policy here.",
    ].join("\n");
    const chunks = chunkMarkdown({ content: md });
    const paths = chunks.map((c) => c.metadata.headingPath.join(" > "));
    expect(paths).toEqual([
      "Top",
      "Top > Shipping",
      "Top > Shipping > Domestic",
      "Top > Returns",
    ]);
  });

  it("does not span chunk boundaries across headings", () => {
    const md =
      "# A\n" +
      "alpha ".repeat(10) +
      "\n\n## B\n" +
      "beta ".repeat(10);
    const chunks = chunkMarkdown({ content: md });
    // Each heading's section is short enough to be a single chunk; we should
    // see exactly 2 chunks with distinct heading paths.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.metadata.headingPath).toEqual(["A"]);
    expect(chunks[1]!.metadata.headingPath).toEqual(["A", "B"]);
    expect(chunks[0]!.content).toContain("alpha");
    expect(chunks[0]!.content).not.toContain("beta");
    expect(chunks[1]!.content).toContain("beta");
    expect(chunks[1]!.content).not.toContain("alpha");
  });

  it("preserves an initialHeadingPath as a prefix on every chunk", () => {
    const md = "# Section\nHello world.";
    const chunks = chunkMarkdown({
      content: md,
      initialHeadingPath: ["acme.pdf"],
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata.headingPath).toEqual(["acme.pdf", "Section"]);
  });

  it("handles input with no headings as a single section", () => {
    const md = "Just a paragraph.\n\nAnother paragraph.";
    const chunks = chunkMarkdown({ content: md });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata.headingPath).toEqual([]);
    expect(chunks[0]!.content).toContain("Just a paragraph.");
    expect(chunks[0]!.content).toContain("Another paragraph.");
  });

  it("assigns a 0-based position monotonically across chunks", () => {
    const md =
      "# A\n" + "x ".repeat(2000) + "\n\n# B\n" + "y ".repeat(2000);
    const chunks = chunkMarkdown({ content: md });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.metadata.position).toBe(i);
    }
  });
});
