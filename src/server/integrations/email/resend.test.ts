import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * sendEmail wraps the Resend SDK. These tests mock the SDK constructor so
 * we never hit the real API, and toggle RESEND_API_KEY across test cases
 * to exercise the "not configured" branch. The wrapper itself never
 * throws — failures come back as { ok: false, error }.
 */

const sendSpy = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendSpy },
  })),
}));

const ORIGINAL_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  sendSpy.mockReset();
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = ORIGINAL_KEY;
  }
});

describe("sendEmail", () => {
  it("returns ok=false with 'Resend not configured' when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail } = await import("./resend");
    const result = await sendEmail({
      to: "u@example.com",
      subject: "hi",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: false, error: "Resend not configured" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns ok=true and forwards the payload when the SDK succeeds", async () => {
    process.env.RESEND_API_KEY = "test-key";
    sendSpy.mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });
    const { sendEmail, FROM_EMAIL } = await import("./resend");

    const result = await sendEmail({
      to: "u@example.com",
      subject: "Reset your password",
      html: "<p>click</p>",
      text: "click",
    });
    expect(result).toEqual({ ok: true });
    expect(sendSpy).toHaveBeenCalledWith({
      from: FROM_EMAIL,
      to: "u@example.com",
      subject: "Reset your password",
      html: "<p>click</p>",
      text: "click",
    });
  });

  it("returns ok=false with the SDK error message when Resend reports an error", async () => {
    process.env.RESEND_API_KEY = "test-key";
    sendSpy.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` address" },
    });
    const { sendEmail } = await import("./resend");
    const result = await sendEmail({
      to: "bad",
      subject: "x",
      html: "x",
      text: "x",
    });
    expect(result).toEqual({ ok: false, error: "Invalid `to` address" });
  });

  it("returns ok=false with an error message when the SDK throws", async () => {
    process.env.RESEND_API_KEY = "test-key";
    sendSpy.mockRejectedValueOnce(new Error("ECONNRESET"));
    const { sendEmail } = await import("./resend");
    const result = await sendEmail({
      to: "u@example.com",
      subject: "x",
      html: "x",
      text: "x",
    });
    expect(result).toEqual({ ok: false, error: "ECONNRESET" });
  });

  it("handles a non-Error throw with a generic message", async () => {
    process.env.RESEND_API_KEY = "test-key";
    sendSpy.mockRejectedValueOnce("string-rejection");
    const { sendEmail } = await import("./resend");
    const result = await sendEmail({
      to: "u@example.com",
      subject: "x",
      html: "x",
      text: "x",
    });
    expect(result).toEqual({ ok: false, error: "Unknown email error" });
  });
});
