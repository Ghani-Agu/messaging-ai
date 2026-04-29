import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  isWithinCustomerServiceWindow,
} from "./policy";

describe("isWithinCustomerServiceWindow", () => {
  const now = new Date("2026-04-29T12:00:00Z").getTime();

  it("returns false for null lastInboundAt (never any inbound)", () => {
    expect(isWithinCustomerServiceWindow(null, now)).toBe(false);
  });

  it("returns true for a message just received", () => {
    expect(
      isWithinCustomerServiceWindow(new Date(now - 1000), now),
    ).toBe(true);
  });

  it("returns true at 23h 59m 59s after lastInboundAt", () => {
    const lastInbound = new Date(now - (CUSTOMER_SERVICE_WINDOW_MS - 1000));
    expect(isWithinCustomerServiceWindow(lastInbound, now)).toBe(true);
  });

  it("returns false at exactly 24h after lastInboundAt (boundary closes the window)", () => {
    const lastInbound = new Date(now - CUSTOMER_SERVICE_WINDOW_MS);
    expect(isWithinCustomerServiceWindow(lastInbound, now)).toBe(false);
  });

  it("returns false for messages older than 24h", () => {
    const lastInbound = new Date(now - (CUSTOMER_SERVICE_WINDOW_MS + 60_000));
    expect(isWithinCustomerServiceWindow(lastInbound, now)).toBe(false);
  });

  it("uses Date.now() when `now` is omitted", () => {
    const lastInbound = new Date(Date.now() - 60_000);
    expect(isWithinCustomerServiceWindow(lastInbound)).toBe(true);
  });
});
