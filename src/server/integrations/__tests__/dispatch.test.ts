import { describe, expect, it, vi } from "vitest";
import type { LiveDataSource } from "@prisma/client";

// dispatch.ts → odoo/sync.ts → knowledge/embed-item.ts → db/items.ts →
// queue/jobs.ts → queue/queues.ts, which calls `new Queue(...)` at
// module-load against REDIS_URL. We only exercise the pure isDueForSync
// helper here, so short-circuit the queue import the same way
// typed-knowledge.test.ts does.
vi.mock("@/server/queue/jobs", () => ({
  enqueueEmbedItems: vi.fn(async () => {}),
  enqueueEmbedQna: vi.fn(async () => {}),
  enqueueEmbedKnowledgeGap: vi.fn(async () => {}),
}));

import { isDueForSync } from "../dispatch";

// Helpers — assemble a LiveDataSource record with sensible defaults.
function source(overrides: Partial<LiveDataSource> = {}): LiveDataSource {
  return {
    id: "src_test",
    tenantId: "tenant_test",
    type: "ODOO",
    name: "Test source",
    encryptedConfig: "<redacted>",
    status: "CONNECTED",
    lastSyncedAt: null,
    lastSyncStartedAt: null,
    lastSyncError: null,
    syncedRecordCount: 0,
    createdAt: new Date("2026-05-06T00:00:00Z"),
    updatedAt: new Date("2026-05-06T00:00:00Z"),
    ...overrides,
  };
}

// Africa/Algiers is UTC+1 year-round (no DST). Test `now` instants
// chosen so the local time is unambiguous:
//   2026-05-06T11:00:00Z  → Wednesday 12:00 Algiers (business hours)
//   2026-05-06T20:00:00Z  → Wednesday 21:00 Algiers (off-hours, weekday)
//   2026-05-08T10:00:00Z  → Friday 11:00 Algiers   (off-hours, weekend)
//   2026-05-09T10:00:00Z  → Saturday 11:00 Algiers (off-hours, weekend)
//   2026-05-10T10:00:00Z  → Sunday 11:00 Algiers   (business hours)
const WED_BUSINESS = new Date("2026-05-06T11:00:00Z");
const WED_OFFHOURS = new Date("2026-05-06T20:00:00Z");
const FRI_WEEKEND = new Date("2026-05-08T10:00:00Z");
const SUN_BUSINESS = new Date("2026-05-10T10:00:00Z");

describe("isDueForSync", () => {
  describe("never-synced sources", () => {
    it("CONNECTED + lastSyncedAt=null → due immediately", () => {
      expect(isDueForSync(source(), WED_BUSINESS)).toBe(true);
    });

    it("ERROR + lastSyncedAt=null → due (auto-recover from PENDING_TEST→ERROR)", () => {
      expect(isDueForSync(source({ status: "ERROR" }), WED_BUSINESS)).toBe(
        true,
      );
    });
  });

  describe("non-eligible statuses", () => {
    it("PENDING_TEST → not due (cron shouldn't drive PENDING_TEST → CONNECTED)", () => {
      // PENDING_TEST gets picked up by the initial-save flow's
      // fire-and-forget syncSource() call, not by the cron.
      expect(
        isDueForSync(source({ status: "PENDING_TEST" }), WED_BUSINESS),
      ).toBe(false);
    });

    it("DISCONNECTED → not due", () => {
      expect(
        isDueForSync(source({ status: "DISCONNECTED" }), WED_BUSINESS),
      ).toBe(false);
    });
  });

  describe("business-hours cadence (15 min)", () => {
    it("Wednesday 12:00 Algiers, last synced 14 min ago → not due", () => {
      const lastSyncedAt = new Date(WED_BUSINESS.getTime() - 14 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), WED_BUSINESS)).toBe(false);
    });

    it("Wednesday 12:00 Algiers, last synced 16 min ago → due", () => {
      const lastSyncedAt = new Date(WED_BUSINESS.getTime() - 16 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), WED_BUSINESS)).toBe(true);
    });

    it("Sunday 11:00 Algiers (still business hours, work week starts Sun) → 16 min → due", () => {
      const lastSyncedAt = new Date(SUN_BUSINESS.getTime() - 16 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), SUN_BUSINESS)).toBe(true);
    });
  });

  describe("off-hours cadence (60 min)", () => {
    it("Wednesday 21:00 Algiers (after 18:00) + 30 min stale → not due", () => {
      const lastSyncedAt = new Date(WED_OFFHOURS.getTime() - 30 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), WED_OFFHOURS)).toBe(false);
    });

    it("Wednesday 21:00 Algiers + 61 min stale → due", () => {
      const lastSyncedAt = new Date(WED_OFFHOURS.getTime() - 61 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), WED_OFFHOURS)).toBe(true);
    });

    it("Friday 11:00 Algiers (weekend in Algeria) + 30 min stale → not due", () => {
      const lastSyncedAt = new Date(FRI_WEEKEND.getTime() - 30 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), FRI_WEEKEND)).toBe(false);
    });

    it("Friday 11:00 Algiers (weekend) + 61 min stale → due", () => {
      const lastSyncedAt = new Date(FRI_WEEKEND.getTime() - 61 * 60_000);
      expect(isDueForSync(source({ lastSyncedAt }), FRI_WEEKEND)).toBe(true);
    });
  });

  describe("in-progress / stuck-sync watchdog", () => {
    it("sync started 5 min ago, still in progress → not due (don't double-fire)", () => {
      const lastSyncStartedAt = new Date(WED_BUSINESS.getTime() - 5 * 60_000);
      expect(
        isDueForSync(source({ lastSyncStartedAt }), WED_BUSINESS),
      ).toBe(false);
    });

    it("sync started 31 min ago with no completion → STUCK, due for retry", () => {
      const lastSyncStartedAt = new Date(WED_BUSINESS.getTime() - 31 * 60_000);
      expect(
        isDueForSync(source({ lastSyncStartedAt }), WED_BUSINESS),
      ).toBe(true);
    });

    it("stuck sync on a PENDING_TEST source still does NOT run (status gate)", () => {
      // The watchdog isn't a backdoor — sources we can't sync still
      // shouldn't sync just because they got stuck.
      const lastSyncStartedAt = new Date(WED_BUSINESS.getTime() - 31 * 60_000);
      expect(
        isDueForSync(
          source({ status: "PENDING_TEST", lastSyncStartedAt }),
          WED_BUSINESS,
        ),
      ).toBe(false);
    });
  });
});
