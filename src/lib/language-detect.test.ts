import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language-detect";

describe("detectLanguage", () => {
  it("returns darija for Arabizi messages with dialect markers", () => {
    expect(detectLanguage("wach 3andkom des horaires?")).toBe("darija");
    expect(detectLanguage("kifash nta khouya?")).toBe("darija");
    expect(detectLanguage("bezzaf ghali")).toBe("darija");
  });

  it("returns darija for Arabic-script messages with Darija markers", () => {
    expect(detectLanguage("واش عندكم وقت الخدمة؟")).toBe("darija");
    expect(detectLanguage("كيفاش نخدم")).toBe("darija");
    expect(detectLanguage("بزاف غالي")).toBe("darija");
  });

  it("returns ar (MSA) for Arabic-script messages without Darija markers", () => {
    expect(detectLanguage("ما هي ساعات العمل؟")).toBe("ar");
    expect(detectLanguage("كم سعر هذا المنتج؟")).toBe("ar");
  });

  it("returns fr for French messages", () => {
    expect(detectLanguage("Bonjour, quel est votre prix?")).toBe("fr");
    expect(detectLanguage("Comment fonctionne la livraison?")).toBe("fr");
    expect(detectLanguage("Merci de votre réponse")).toBe("fr");
  });

  it("returns en as the default fallback", () => {
    expect(detectLanguage("How can I order?")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("12345")).toBe("en");
  });

  it("Arabizi takes precedence over French token overlap", () => {
    // "wach" wins over "comment" — Arabizi check fires first.
    expect(detectLanguage("wach comment ça marche?")).toBe("darija");
  });
});
