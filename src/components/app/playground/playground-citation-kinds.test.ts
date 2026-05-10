import { describe, expect, it } from "vitest";
import { HelpCircle, Phone } from "lucide-react";
import { iconForKind, labelForKind } from "./playground-citation-kinds";

/**
 * Regression coverage for the playground crash that surfaced after the
 * Contacts feature (Commit a5ccd17) added a fifth BrainCitation kind:
 * `contact`. The old icon lookup was an `as const` object indexed by
 * `c.kind`; an unknown kind (server adds a new one before the client
 * is bumped, or a serialization gap leaves the field null) bottomed out
 * to undefined and JSX threw on `<undefined ... />`.
 *
 * The resolver now always returns a Lucide component — known kinds get
 * their dedicated icon, everything else gets HelpCircle.
 */

describe("iconForKind", () => {
  it("returns Phone for contact citations", () => {
    expect(iconForKind("contact")).toBe(Phone);
  });

  it("returns the fallback icon for null", () => {
    expect(iconForKind(null)).toBe(HelpCircle);
  });

  it("returns the fallback icon for undefined", () => {
    expect(iconForKind(undefined)).toBe(HelpCircle);
  });

  it("returns the fallback icon for an unknown kind", () => {
    expect(iconForKind("future_kind")).toBe(HelpCircle);
  });

  it("returns the fallback icon for an empty string", () => {
    expect(iconForKind("")).toBe(HelpCircle);
  });
});

describe("labelForKind", () => {
  it("returns 'Contact' for contact citations", () => {
    expect(labelForKind("contact")).toBe("Contact");
  });

  it("returns the four pre-existing labels", () => {
    expect(labelForKind("chunk")).toBe("Source");
    expect(labelForKind("item")).toBe("Product");
    expect(labelForKind("qna")).toBe("Q&A");
    expect(labelForKind("operational_fact")).toBe("Fact");
  });

  it("returns the generic 'Citation' label for unknown/null/undefined", () => {
    expect(labelForKind(null)).toBe("Citation");
    expect(labelForKind(undefined)).toBe("Citation");
    expect(labelForKind("future_kind")).toBe("Citation");
  });
});
