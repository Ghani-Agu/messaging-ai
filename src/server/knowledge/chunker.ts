import "server-only";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import {
  CHUNK_OVERLAP_TOKENS,
  TARGET_CHUNK_TOKENS,
} from "./limits";

/**
 * Token-aware recursive chunker. Splits content along the strongest
 * structural boundary that produces fitting pieces — markdown headings,
 * paragraphs, lines, sentences, words, and finally raw tokens — then
 * greedily packs the resulting atoms into chunks of <=TARGET_CHUNK_TOKENS
 * with CHUNK_OVERLAP_TOKENS of overlap carried across boundaries.
 *
 * Tokenizer: OpenAI's cl100k_base via js-tiktoken. We don't need exact
 * Voyage-style tokenization — we just need consistent counts to size
 * chunks. Both providers comfortably embed 600-token inputs.
 *
 * `chunkMarkdown` additionally tracks the H1/H2/H3 heading stack so each
 * chunk's metadata.headingPath captures the breadcrumbs of the section it
 * came from. The retriever and the Phase-4 prompt builder both consume that.
 */

export type ChunkInput = {
  content: string;
  /** Page URL for WEBSITE chunks; storage path for FILE; usually omitted for MANUAL. */
  sourceUrl?: string | null;
  /** Pre-existing breadcrumbs (e.g. file title for FILE chunks). */
  initialHeadingPath?: string[];
};

export type Chunk = {
  content: string;
  tokenCount: number;
  metadata: {
    url?: string;
    headingPath: string[];
    /** 0-based position of this chunk within its source. */
    position: number;
  };
};

let cachedEncoding: Tiktoken | null = null;
function enc(): Tiktoken {
  if (!cachedEncoding) cachedEncoding = getEncoding("cl100k_base");
  return cachedEncoding;
}

export function countTokens(text: string): number {
  return enc().encode(text).length;
}

/**
 * Chunk plain text with no heading awareness. Use for MANUAL entries and
 * for FILE / WEBSITE inputs that have no markdown structure.
 */
export function chunkPlainText(input: ChunkInput): Chunk[] {
  const url = input.sourceUrl ?? undefined;
  const headingPath = input.initialHeadingPath ?? [];
  const pieces = splitWithOverlap(
    input.content.trim(),
    TARGET_CHUNK_TOKENS,
    CHUNK_OVERLAP_TOKENS,
  );
  return pieces.map((content, position) => ({
    content,
    tokenCount: countTokens(content),
    metadata: { url, headingPath: [...headingPath], position },
  }));
}

/**
 * Chunk markdown content while tracking the H1/H2/H3 heading stack.
 * Sections under different headings are chunked independently so a chunk
 * never spans a heading boundary, and each chunk inherits the breadcrumbs
 * of the section it was emitted from.
 */
export function chunkMarkdown(input: ChunkInput): Chunk[] {
  const url = input.sourceUrl ?? undefined;
  const initial = input.initialHeadingPath ?? [];
  const lines = input.content.split(/\r?\n/);

  // Walk the lines collecting (headingPath, sectionText) pairs.
  type Section = { headingPath: string[]; text: string };
  const sections: Section[] = [];
  const stack: string[] = [...initial];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ headingPath: [...stack], text });
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) {
      flush();
      const level = m[1]!.length; // 1, 2, or 3
      const heading = m[2]!.trim();
      // Truncate everything beyond the parent of this heading's level, then
      // push the new heading. The `initial` prefix from the caller is always
      // preserved (e.g. file title for FILE chunks).
      stack.splice(initial.length + level - 1);
      stack.push(heading);
      // Include the heading line itself in the section body so the chunk
      // preserves the visible heading text alongside its breadcrumbs.
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const pieces = splitWithOverlap(
      section.text,
      TARGET_CHUNK_TOKENS,
      CHUNK_OVERLAP_TOKENS,
    );
    for (const piece of pieces) {
      chunks.push({
        content: piece,
        tokenCount: countTokens(piece),
        metadata: {
          url,
          headingPath: [...section.headingPath],
          position: chunks.length,
        },
      });
    }
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

const SEPARATORS = ["\n\n", "\n", ". ", " "] as const;

type Atom = { text: string; sep: string };

/**
 * Recursively atomize the input into pieces no larger than maxTokens, using
 * the strongest separator available at each level. Each atom remembers the
 * separator that originally followed it so the packer can re-stitch them.
 */
function atomize(text: string, maxTokens: number, depth = 0): Atom[] {
  if (countTokens(text) <= maxTokens) return [{ text, sep: "" }];

  if (depth >= SEPARATORS.length) {
    // Final fallback: hard token-window split. No overlap here — overlap is
    // applied later when atoms cross chunk boundaries.
    const ids = enc().encode(text);
    const out: Atom[] = [];
    for (let i = 0; i < ids.length; i += maxTokens) {
      out.push({ text: enc().decode(ids.slice(i, i + maxTokens)), sep: "" });
    }
    return out;
  }

  const sep = SEPARATORS[depth]!;
  const parts = text.split(sep);
  if (parts.length === 1) return atomize(text, maxTokens, depth + 1);

  const out: Atom[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const sepAfter = i < parts.length - 1 ? sep : "";
    if (countTokens(part) <= maxTokens) {
      out.push({ text: part, sep: sepAfter });
    } else {
      const sub = atomize(part, maxTokens, depth + 1);
      if (sub.length > 0) sub[sub.length - 1]!.sep = sepAfter;
      out.push(...sub);
    }
  }
  return out;
}

/**
 * Greedy packer that fills chunks up to maxTokens, then prepends the last
 * `overlap` tokens of the previous chunk to the next one so retrieval
 * doesn't lose context across the boundary.
 */
function splitWithOverlap(
  text: string,
  maxTokens: number,
  overlap: number,
): string[] {
  if (!text.trim()) return [];
  if (countTokens(text) <= maxTokens) return [text.trim()];

  const atoms = atomize(text, maxTokens);
  const chunks: string[] = [];
  let buf = "";
  let bufTokens = 0;

  for (const atom of atoms) {
    const piece = atom.text + atom.sep;
    const pieceTokens = countTokens(piece);

    if (bufTokens + pieceTokens > maxTokens && buf) {
      chunks.push(buf.trim());
      const tail = takeTailTokens(buf, overlap);
      buf = tail ? tail + (tail.endsWith(" ") ? "" : " ") + piece : piece;
      bufTokens = countTokens(buf);
    } else {
      buf += piece;
      bufTokens += pieceTokens;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function takeTailTokens(text: string, tokens: number): string {
  if (tokens <= 0) return "";
  const ids = enc().encode(text);
  if (ids.length <= tokens) return text;
  return enc().decode(ids.slice(-tokens));
}
