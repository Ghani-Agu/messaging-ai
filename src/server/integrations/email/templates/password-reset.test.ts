import { describe, expect, it } from "vitest";
import { passwordResetEmail } from "./password-reset";

describe("passwordResetEmail", () => {
  it("includes the resetUrl in both the html and text bodies", () => {
    const url = "https://app.example.com/reset-password/abc123";
    const rendered = passwordResetEmail({ resetUrl: url, userName: "Sam" });
    expect(rendered.html).toContain(url);
    expect(rendered.text).toContain(url);
  });

  it("greets by name when userName is supplied", () => {
    const rendered = passwordResetEmail({
      resetUrl: "https://x/reset",
      userName: "Sam",
    });
    expect(rendered.html).toContain("Bonjour Sam,");
    expect(rendered.text.startsWith("Bonjour Sam,")).toBe(true);
  });

  it("falls back to a generic greeting when userName is missing / null / empty", () => {
    for (const name of [undefined, null, "", "   "] as const) {
      const r = passwordResetEmail({
        resetUrl: "https://x/reset",
        userName: name as string | null | undefined,
      });
      expect(r.html).toContain("Bonjour,");
      expect(r.text.startsWith("Bonjour,")).toBe(true);
      // Never emits a stray "Bonjour ," with a space-then-comma.
      expect(r.html).not.toMatch(/Bonjour\s,/);
    }
  });

  it("produces a non-empty subject + html + text", () => {
    const r = passwordResetEmail({ resetUrl: "https://x/reset" });
    expect(r.subject.length).toBeGreaterThan(0);
    expect(r.html.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0);
  });
});
