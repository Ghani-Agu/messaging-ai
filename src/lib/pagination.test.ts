import { describe, expect, it } from "vitest";
import { clampPage, getPageWindow, parsePageParam } from "@/lib/pagination";

describe("parsePageParam", () => {
  it("returns 1 for missing input", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
  });

  it("returns 1 for non-numeric input", () => {
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("NaN")).toBe(1);
  });

  it("returns 1 for non-positive input", () => {
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-3")).toBe(1);
  });

  it("returns the integer floor of valid positive input", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("87")).toBe(87);
    expect(parsePageParam("3.7")).toBe(3);
  });
});

describe("clampPage", () => {
  it("clamps to 1 when input is below range", () => {
    expect(clampPage(0, 40)).toBe(1);
    expect(clampPage(-5, 40)).toBe(1);
  });

  it("clamps to totalPages when input exceeds range", () => {
    expect(clampPage(999, 40)).toBe(40);
    expect(clampPage(41, 40)).toBe(40);
  });

  it("clamps NaN / Infinity to 1", () => {
    expect(clampPage(NaN, 40)).toBe(1);
    expect(clampPage(Infinity, 40)).toBe(1);
    expect(clampPage(-Infinity, 40)).toBe(1);
    expect(clampPage(undefined, 40)).toBe(1);
  });

  it("returns 1 when totalPages is zero or negative (empty dataset)", () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(1, 0)).toBe(1);
    expect(clampPage(1, -1)).toBe(1);
  });

  it("returns the floored input when in range", () => {
    expect(clampPage(1, 40)).toBe(1);
    expect(clampPage(20, 40)).toBe(20);
    expect(clampPage(40, 40)).toBe(40);
    expect(clampPage(3.9, 40)).toBe(3);
  });

  it("handles the canonical scenario: 1996 items / 50 per page → 40 pages", () => {
    const totalPages = Math.ceil(1996 / 50);
    expect(totalPages).toBe(40);
    expect(clampPage(1, totalPages)).toBe(1);
    expect(clampPage(40, totalPages)).toBe(40);
    expect(clampPage(41, totalPages)).toBe(40);
  });
});

describe("getPageWindow", () => {
  it("returns an empty array when total is non-positive", () => {
    expect(getPageWindow(1, 0)).toEqual([]);
    expect(getPageWindow(1, -1)).toEqual([]);
  });

  it("returns every page when total is small enough to fit (<=7)", () => {
    expect(getPageWindow(1, 1)).toEqual([1]);
    expect(getPageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("includes a right ellipsis but no left ellipsis when current is near the start", () => {
    // 1 [2] 3 4 5 ... 40
    expect(getPageWindow(2, 40)).toEqual([1, 2, 3, 4, "ellipsis-right", 40]);
    // 1 2 [3] 4 5 ... 40
    expect(getPageWindow(3, 40)).toEqual([1, 2, 3, 4, 5, "ellipsis-right", 40]);
  });

  it("includes a left ellipsis but no right ellipsis when current is near the end", () => {
    // 1 ... 36 37 38 [39] 40
    expect(getPageWindow(39, 40)).toEqual([
      1,
      "ellipsis-left",
      37,
      38,
      39,
      40,
    ]);
    expect(getPageWindow(40, 40)).toEqual([
      1,
      "ellipsis-left",
      38,
      39,
      40,
    ]);
  });

  it("includes both ellipses when current is in the middle", () => {
    // 1 ... 19 20 [21] 22 23 ... 40
    expect(getPageWindow(21, 40)).toEqual([
      1,
      "ellipsis-left",
      19,
      20,
      21,
      22,
      23,
      "ellipsis-right",
      40,
    ]);
  });

  it("clamps current to range when out of bounds (defensive)", () => {
    // current=999, total=40 → behaves like current=40
    expect(getPageWindow(999, 40)).toEqual(getPageWindow(40, 40));
    // current=0 → behaves like current=1
    expect(getPageWindow(0, 40)).toEqual(getPageWindow(1, 40));
  });
});

describe("pagination math — full integration scenario", () => {
  it("1996 rows × 50 per page produces 40 pages, last page has 46 rows", () => {
    const total = 1996;
    const pageSize = 50;
    const totalPages = Math.ceil(total / pageSize);
    expect(totalPages).toBe(40);

    // First page: rows 1–50.
    const page1 = 1;
    expect((page1 - 1) * pageSize + 1).toBe(1);
    expect(Math.min(page1 * pageSize, total)).toBe(50);

    // Last page: rows 1951–1996 (46 rows).
    const lastPage = totalPages;
    expect((lastPage - 1) * pageSize + 1).toBe(1951);
    expect(Math.min(lastPage * pageSize, total)).toBe(1996);
    expect(total - (lastPage - 1) * pageSize).toBe(46);
  });
});

describe("pagination math — filtered counts", () => {
  it("totalCount=20 with pageSize=50 → 1 page, single-entry window", () => {
    const total = 20;
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    expect(totalPages).toBe(1);
    expect(getPageWindow(1, totalPages)).toEqual([1]);
  });

  it("totalCount=0 (no matches) → empty window, page still clamps to 1", () => {
    const total = 0;
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    expect(totalPages).toBe(1);
    // Component renders no Pagination footer when count===0; the helper's
    // own guard returns an empty window for total<=0.
    expect(getPageWindow(1, 0)).toEqual([]);
    // Clamp returns a valid page so the URL builder doesn't blow up.
    expect(clampPage(5, totalPages)).toBe(1);
  });

  it("page=5 with filtered totalCount=20 clamps back to last filtered page", () => {
    // Operator was on page 5 of a 1996-item view, then narrowed search to
    // 20 matches. The page param in the URL is now stale — clampPage
    // drives the server-side reslice onto the last valid page (page 1).
    const total = 20;
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    expect(clampPage(5, totalPages)).toBe(1);
  });

  it("filtered totalCount=120 → 3 pages, each page yields the right slice", () => {
    const total = 120;
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    expect(totalPages).toBe(3);
    // Page 1: rows 1–50.
    expect((1 - 1) * pageSize + 1).toBe(1);
    expect(Math.min(1 * pageSize, total)).toBe(50);
    // Page 3: rows 101–120.
    expect((3 - 1) * pageSize + 1).toBe(101);
    expect(Math.min(3 * pageSize, total)).toBe(120);
    // No ellipsis when the window fits in <=7 entries.
    expect(getPageWindow(2, totalPages)).toEqual([1, 2, 3]);
  });
});
