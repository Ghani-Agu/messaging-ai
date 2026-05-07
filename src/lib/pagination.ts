/**
 * Pure pagination math — kept separate from the React component in
 * `src/components/ui/pagination.tsx` so it can be unit-tested without
 * pulling Next.js / React Link context at module load.
 *
 * Used by:
 *  - The Products list page (`/[tenantSlug]/knowledge/items`) to clamp
 *    `?page=` and compute skip/take.
 *  - The `Pagination` component to build the visible page-number strip.
 */

/**
 * Coerce a raw `?page=` query-param value into a positive integer page number.
 * Falls back to 1 for missing / non-numeric / negative input. Caller is still
 * expected to clamp against the actual total via `clampPage`.
 */
export function parsePageParam(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Clamp a page number into the valid range `[1, totalPages]`. NaN / Infinity /
 * non-numeric input clamps to 1; values past the end clamp down to
 * `totalPages`. When the dataset is empty (`totalPages <= 0`), returns 1 so
 * the UI still renders a single (empty) page.
 */
export function clampPage(input: number | undefined, totalPages: number): number {
  if (totalPages <= 0) return 1;
  if (typeof input !== "number" || !Number.isFinite(input)) return 1;
  if (input < 1) return 1;
  if (input > totalPages) return totalPages;
  return Math.floor(input);
}

export type PageWindowEntry = number | "ellipsis-left" | "ellipsis-right";

/**
 * Build the visible page-number strip. For `total <= 7` returns every page;
 * otherwise returns `[1, …, current-2, current-1, current, current+1,
 * current+2, …, last]` with ellipses where gaps exist. The two ellipses are
 * tagged so React keys stay stable when both are present in one render.
 */
export function getPageWindow(current: number, total: number): PageWindowEntry[] {
  if (total <= 0) return [];
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const safeCurrent = Math.max(1, Math.min(current, total));
  const out: PageWindowEntry[] = [1];
  const left = Math.max(2, safeCurrent - 2);
  const right = Math.min(total - 1, safeCurrent + 2);
  if (left > 2) out.push("ellipsis-left");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push("ellipsis-right");
  out.push(total);
  return out;
}
