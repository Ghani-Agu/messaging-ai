import "server-only";

import type { LiveDataSource } from "@prisma/client";
import { syncOdooProducts, type SyncResult } from "./odoo/sync";

/**
 * Type-based dispatch for Live Data Source sync. The cron route walks
 * every CONNECTED / ERROR source and calls syncSource(); this switch
 * routes to the appropriate adapter based on `type`.
 *
 * Adding a new adapter is one new case here + one folder under
 * src/server/integrations/<type>/. Nothing else in the cron, UI, or
 * encryption layer changes.
 */
export async function syncSource(source: LiveDataSource): Promise<SyncResult> {
  switch (source.type) {
    case "ODOO":
      return syncOdooProducts(source);
    default: {
      // Exhaustiveness check — TS will surface a missing case at compile
      // time once new variants land on the LiveDataSourceType enum.
      const _exhaustive: never = source.type;
      throw new Error(
        `Unsupported LiveDataSource type: ${String(_exhaustive)}`,
      );
    }
  }
}

/**
 * Cron-side gate: should this source be synced on this tick?
 *
 * Decision tree (in order):
 *   1. Sync currently in progress (lastSyncStartedAt set, lastSyncedAt
 *      not yet bumped) → SKIP unless it's been >30 min (stuck-sync
 *      watchdog — process restart mid-sync, OOM, etc.).
 *   2. Status is neither CONNECTED nor ERROR (e.g. PENDING_TEST,
 *      DISCONNECTED) → SKIP. The cron shouldn't drive state changes
 *      from those terminal/transitional states.
 *   3. Never synced (lastSyncedAt = null) → SYNC.
 *   4. Within Algerian business hours (Sun-Thu 8am-6pm Africa/Algiers)
 *      → SYNC if last sync was ≥15 min ago.
 *   5. Off-hours → SYNC if last sync was ≥60 min ago.
 *
 * Algeria's work week is Sun-Thu (not Mon-Fri). Friday/Saturday are
 * weekend. The Africa/Algiers timezone is UTC+1 year-round, so we use
 * Intl.DateTimeFormat / toLocaleString to pick up the local-day-of-week
 * and hour without pulling in a tz library.
 */
export function isDueForSync(
  source: LiveDataSource,
  now: Date = new Date(),
): boolean {
  // Stuck-sync watchdog: a sync that started but didn't finish for
  // >30 min is presumed dead. Treat it as eligible for re-sync.
  if (source.lastSyncStartedAt) {
    const stuckThresholdMs = 30 * 60 * 1000;
    const inFlightMs = now.getTime() - source.lastSyncStartedAt.getTime();
    if (inFlightMs < stuckThresholdMs) {
      // Still within the in-flight window; don't double-fire.
      return false;
    }
    // Past the watchdog threshold. Fall through to the cadence checks
    // — they'll generally say "yes" because lastSyncedAt is stale or
    // null, which is exactly the recovery we want.
  }

  if (source.status !== "CONNECTED" && source.status !== "ERROR") return false;
  if (!source.lastSyncedAt) return true;

  const minutesSinceLastSync =
    (now.getTime() - source.lastSyncedAt.getTime()) / 60_000;
  // Read the local day-of-week / hour in Africa/Algiers without pulling
  // a timezone library. toLocaleString preserves wall-clock semantics.
  const tzNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Africa/Algiers" }),
  );
  const day = tzNow.getDay(); // 0=Sun ... 6=Sat
  const hour = tzNow.getHours();
  // Algerian work week is Sun-Thu. JS getDay() returns 0=Sunday,
  // 1=Monday, ..., 4=Thursday, 5=Friday, 6=Saturday — Sun(0) through
  // Thu(4) inclusive matches.
  const isBusinessDay = day >= 0 && day <= 4;
  const isBusinessHour = hour >= 8 && hour < 18;
  const isBusinessHours = isBusinessDay && isBusinessHour;

  return isBusinessHours
    ? minutesSinceLastSync >= 15
    : minutesSinceLastSync >= 60;
}
