import { describe, expect, it } from "vitest";
import {
  defaultVoiceProfile,
  getVoiceProfile,
  voiceProfileSchema,
} from "./validators";

describe("voice profile", () => {
  it("default profile is fully populated", () => {
    const p = defaultVoiceProfile();
    expect(p.tone).toBe("friendly");
    expect(p.formality).toBe(3);
    expect(p.emojiPolicy).toBe("minimal");
    expect(p.defaultLanguage).toBe("fr");
    expect(p.fallbackLanguage).toBe("en");
    expect(p.signaturePhrases).toEqual([]);
    expect(p.avoid).toEqual([]);
    expect(p.fewShot).toEqual([]);
  });

  it("rejects out-of-range formality", () => {
    expect(() => voiceProfileSchema.parse({ formality: 0 })).toThrow();
    expect(() => voiceProfileSchema.parse({ formality: 6 })).toThrow();
    expect(() => voiceProfileSchema.parse({ formality: 2.5 })).toThrow();
  });

  it("rejects unknown tone / language / emoji policy", () => {
    expect(() => voiceProfileSchema.parse({ tone: "snarky" })).toThrow();
    expect(() => voiceProfileSchema.parse({ defaultLanguage: "es" })).toThrow();
    expect(() => voiceProfileSchema.parse({ emojiPolicy: "many" })).toThrow();
  });

  it("caps few-shot examples at 20 and signature phrases at 10", () => {
    const tooManyShots = Array.from({ length: 21 }, () => ({
      customer: "hi",
      reply: "hello",
    }));
    expect(() => voiceProfileSchema.parse({ fewShot: tooManyShots })).toThrow();

    const tooManyPhrases = Array.from({ length: 11 }, (_, i) => `phrase ${i}`);
    expect(() =>
      voiceProfileSchema.parse({ signaturePhrases: tooManyPhrases }),
    ).toThrow();
  });
});

describe("getVoiceProfile()", () => {
  it("returns the stored profile when settings is well-formed", () => {
    const p = getVoiceProfile({
      voiceProfile: { tone: "formal", formality: 5, fallbackLanguage: "ar" },
    });
    expect(p.tone).toBe("formal");
    expect(p.formality).toBe(5);
    expect(p.fallbackLanguage).toBe("ar");
    // Unspecified fields fall back to defaults.
    expect(p.emojiPolicy).toBe("minimal");
  });

  it("falls back to default when settings is null / undefined / malformed", () => {
    expect(getVoiceProfile(null).tone).toBe("friendly");
    expect(getVoiceProfile(undefined).tone).toBe("friendly");
    expect(getVoiceProfile("not an object").tone).toBe("friendly");
    // settings is an object but voiceProfile field is bad shape → default.
    expect(getVoiceProfile({ voiceProfile: { tone: "snarky" } }).tone).toBe(
      "friendly",
    );
  });

  it("preserves legacy settings fields via passthrough on parse", () => {
    // Just verifying we don't throw on legacy seeds with brandVoice etc.
    const p = getVoiceProfile({
      defaultLanguage: "en",
      brandVoice: "friendly-professional",
      businessHours: { tz: "Africa/Algiers" },
    });
    expect(p.tone).toBe("friendly"); // no voiceProfile field → default
  });
});
