import { describe, expect, it } from "vitest";
import {
  detectTier2Relevance,
  pickRelevantTier2,
  type OperationalFactsData,
} from "./operational-facts";

describe("detectTier2Relevance — keyword intent gates", () => {
  it("flags hours intent on English / French / Arabic / Darija variants", () => {
    expect(detectTier2Relevance("What are your hours?").hours).toBe(true);
    expect(detectTier2Relevance("Quels sont vos horaires?").hours).toBe(true);
    expect(detectTier2Relevance("ما هي ساعات العمل؟").hours).toBe(true);
    expect(detectTier2Relevance("waqt l-khedma?").hours).toBe(true);
    expect(detectTier2Relevance("Are you open today?").hours).toBe(true);
  });

  it("flags exceptions intent together with hours (today's behavior)", () => {
    const r = detectTier2Relevance("What are your hours on holidays?");
    expect(r.hours).toBe(true);
    expect(r.exceptions).toBe(true);
  });

  it("flags locations intent on English / French / Arabic / Darija variants", () => {
    expect(detectTier2Relevance("Where are you located?").locations).toBe(true);
    expect(detectTier2Relevance("Quelle est votre adresse?").locations).toBe(true);
    expect(detectTier2Relevance("أين موقعكم؟").locations).toBe(true);
    expect(detectTier2Relevance("win l-magasin?").locations).toBe(true);
  });

  it("flags currency / price intent", () => {
    expect(detectTier2Relevance("How much does it cost?").currency).toBe(true);
    expect(detectTier2Relevance("Quel est le prix?").currency).toBe(true);
    expect(detectTier2Relevance("كم السعر؟").currency).toBe(true);
    expect(detectTier2Relevance("ch7al hada?").currency).toBe(true);
  });

  it("flags service-area intent on delivery questions", () => {
    expect(detectTier2Relevance("Do you deliver to Oran?").serviceArea).toBe(true);
    expect(detectTier2Relevance("Livraison disponible?").serviceArea).toBe(true);
    expect(detectTier2Relevance("هل توصلون إلى وهران؟").serviceArea).toBe(true);
  });

  it("returns all-false on unrelated questions", () => {
    expect(detectTier2Relevance("What is the warranty period?")).toEqual({
      hours: false,
      exceptions: false,
      locations: false,
      currency: false,
      serviceArea: false,
    });
  });

  it("handles empty / null-ish input without throwing", () => {
    expect(detectTier2Relevance("")).toEqual({
      hours: false,
      exceptions: false,
      locations: false,
      currency: false,
      serviceArea: false,
    });
  });
});

describe("pickRelevantTier2", () => {
  const sample: OperationalFactsData = {
    displayName: "Acme",
    primaryLanguage: "fr",
    hours: { tz: "Africa/Algiers", weekly: [] },
    locations: [{ label: "HQ", address: "Algiers" }],
    currency: "DZD",
    serviceArea: "Algeria",
  };

  it("returns only flagged + present fields", () => {
    expect(
      pickRelevantTier2(sample, {
        hours: true,
        exceptions: false,
        locations: false,
        currency: false,
        serviceArea: false,
      }),
    ).toEqual({ hours: { tz: "Africa/Algiers", weekly: [] } });
  });

  it("omits flagged fields that aren't present in the data", () => {
    const sparse: OperationalFactsData = { displayName: "X" };
    expect(
      pickRelevantTier2(sparse, {
        hours: true,
        exceptions: true,
        locations: true,
        currency: true,
        serviceArea: true,
      }),
    ).toEqual({});
  });

  it("includes all present fields when all flags are true", () => {
    const r = pickRelevantTier2(sample, {
      hours: true,
      exceptions: true,
      locations: true,
      currency: true,
      serviceArea: true,
    });
    expect(r).toEqual({
      hours: sample.hours,
      locations: sample.locations,
      currency: sample.currency,
      serviceArea: sample.serviceArea,
    });
    // exceptions wasn't in `sample`, so it shouldn't appear in output even
    // though the flag was true.
    expect("exceptions" in r).toBe(false);
  });
});
