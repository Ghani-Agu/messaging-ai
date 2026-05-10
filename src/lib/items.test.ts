import { describe, expect, it } from "vitest";
import { buildItemEmbedText, inferBrandFromName } from "./items";

describe("inferBrandFromName", () => {
  it("returns the canonical brand when first token matches a known brand", () => {
    expect(inferBrandFromName("AJAX Détecteur de Mouvement")).toBe("Ajax");
    expect(inferBrandFromName("Dahua Camera HDCVI 2MP")).toBe("Dahua");
    expect(inferBrandFromName("IMOU Wifi indoor camera")).toBe("Imou");
    expect(inferBrandFromName("Hikvision DS-2CD2T87G2")).toBe("Hikvision");
    expect(inferBrandFromName("UBIQUITI UniFi 6 LR")).toBe("Ubiquiti");
    expect(inferBrandFromName("MAXHUB V6 75 pouces")).toBe("Maxhub");
  });

  it("matches case-insensitively but always returns canonical form", () => {
    expect(inferBrandFromName("ajax kit")).toBe("Ajax");
    expect(inferBrandFromName("DaHuA dome cam")).toBe("Dahua");
  });

  it("returns null when first token isn't on the known list", () => {
    // SKU-shaped first token — never infer.
    expect(inferBrandFromName("DH-XVR-5849")).toBeNull();
    // Product noun first; brand later (don't false-positive on later tokens).
    expect(inferBrandFromName("Camera Dahua HDCVI")).toBeNull();
    expect(inferBrandFromName("Onduleur Smart UPS")).toBeNull();
  });

  it("handles empty / whitespace / null / undefined", () => {
    expect(inferBrandFromName("")).toBeNull();
    expect(inferBrandFromName("   ")).toBeNull();
    expect(inferBrandFromName(null)).toBeNull();
    expect(inferBrandFromName(undefined)).toBeNull();
  });

  it("trims leading whitespace before matching", () => {
    expect(inferBrandFromName("  AJAX Hub Plus")).toBe("Ajax");
    expect(inferBrandFromName("\tDahua\tcamera")).toBe("Dahua");
  });

  it("does not match when a known brand appears mid-name", () => {
    expect(inferBrandFromName("Kit avec Ajax Hub")).toBeNull();
    expect(inferBrandFromName("Onduleur compatible Ubiquiti")).toBeNull();
  });
});

describe("buildItemEmbedText — brand inference fallback", () => {
  it("uses explicit item.brand when present (no inference)", () => {
    const text = buildItemEmbedText({
      name: "Dahua Camera HDCVI",
      brand: "AcmeCo", // explicit, even if not on known list
    });
    expect(text).toContain("Marque: AcmeCo");
    expect(text).not.toContain("Marque: Dahua");
  });

  it("falls back to inferred brand when item.brand is null and name starts with a known brand", () => {
    const text = buildItemEmbedText({
      name: "AJAX Détecteur de Mouvement",
      brand: null,
    });
    expect(text).toContain("Marque: Ajax");
  });

  it("falls back to inferred brand when item.brand is undefined (synced row with missing brand custom-field)", () => {
    const text = buildItemEmbedText({
      name: "Dahua Camera HDCVI 2MP",
    });
    expect(text).toContain("Marque: Dahua");
  });

  it("does NOT include a brand line when name starts with a non-brand token", () => {
    const text = buildItemEmbedText({
      name: "Camera Dahua HDCVI",
      brand: null,
    });
    expect(text).not.toMatch(/Marque:/);
  });

  it("treats whitespace-only brand as missing and falls back to inference", () => {
    const text = buildItemEmbedText({
      name: "AJAX Hub Plus",
      brand: "   ",
    });
    expect(text).toContain("Marque: Ajax");
  });
});
