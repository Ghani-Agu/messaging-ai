import { describe, expect, it } from "vitest";
import { importCsvForItems, parseCsvText } from "./csv-import";

describe("parseCsvText", () => {
  it("parses a simple header + body", () => {
    expect(parseCsvText("a,b,c\n1,2,3\n4,5,6")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCsvText('name,description\n"Macbook, Pro","16GB, 512GB"')).toEqual([
      ["name", "description"],
      ["Macbook, Pro", "16GB, 512GB"],
    ]);
  });

  it('escapes "" inside quoted fields', () => {
    expect(parseCsvText('name\n"He said ""hi"""')).toEqual([
      ["name"],
      ['He said "hi"'],
    ]);
  });

  it("handles \\r\\n line endings", () => {
    expect(parseCsvText("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves newlines inside quoted fields", () => {
    expect(parseCsvText('a\n"line one\nline two"')).toEqual([
      ["a"],
      ["line one\nline two"],
    ]);
  });

  it("skips fully-empty trailing rows", () => {
    expect(parseCsvText("a\n1\n\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("importCsvForItems — happy path", () => {
  it("maps standard headers to typed fields and gathers extras into specs", () => {
    const csv = `name,brand,sku,price,currency,availability,description,color,ram
Macbook Pro M3,Apple,MBP-M3-14,2200.00,USD,in_stock,14-inch laptop,space gray,16GB
iPhone 15,Apple,IP-15-128,799.00,USD,in_stock,128GB phone,black,8GB`;
    const r = importCsvForItems(csv);
    expect(r.summary).toEqual({ total: 2, ok: 2, failed: 0 });
    expect(r.headers).toEqual([
      "name",
      "brand",
      "sku",
      "price",
      "currency",
      "availability",
      "description",
      "color",
      "ram",
    ]);
    const first = r.rows[0]!;
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.input.name).toBe("Macbook Pro M3");
      expect(first.input.brand).toBe("Apple");
      expect(first.input.sku).toBe("MBP-M3-14");
      expect(first.input.priceCents).toBe(220_000);
      expect(first.input.currency).toBe("USD");
      expect(first.input.availability).toBe("IN_STOCK");
      // Non-standard columns flow into specs.
      expect(first.input.specs).toMatchObject({ color: "space gray", ram: "16GB" });
    }
  });

  it("recognizes header aliases (product / cost / stock)", () => {
    const csv = `product,cost,stock
Item One,100.00,available
Item Two,200.50,low`;
    const r = importCsvForItems(csv);
    expect(r.summary.ok).toBe(2);
    const first = r.rows[0]!;
    if (first.ok) {
      expect(first.input.name).toBe("Item One");
      expect(first.input.priceCents).toBe(10_000);
      expect(first.input.availability).toBe("IN_STOCK");
    }
    const second = r.rows[1]!;
    if (second.ok) {
      expect(second.input.priceCents).toBe(20_050);
      expect(second.input.availability).toBe("LOW_STOCK");
    }
  });

  it("normalizes availability variants (out_of_stock / outofstock / unavailable)", () => {
    const csv = `name,availability
A,out
B,unavailable
C,instock
D,limited`;
    const r = importCsvForItems(csv);
    expect(r.rows.map((row) => (row.ok ? row.input.availability : "—"))).toEqual([
      "OUT_OF_STOCK",
      "OUT_OF_STOCK",
      "IN_STOCK",
      "LOW_STOCK",
    ]);
  });

  it("falls through to UNKNOWN for unrecognized availability", () => {
    const csv = `name,availability
A,maybe`;
    const first = r0(csv).rows[0]!;
    if (first.ok) expect(first.input.availability).toBe("UNKNOWN");
  });

  it("parses comma-decimal prices (European format)", () => {
    const csv = `name,price
A,"1500,50"`;
    const first = r0(csv).rows[0]!;
    if (first.ok) expect(first.input.priceCents).toBe(150_050);
  });

  it("skips reserved _-prefix and numeric headers in specs", () => {
    const csv = `name,_template_id,1,custom
A,template-1,number-col,real-spec`;
    const first = r0(csv).rows[0]!;
    if (first.ok) {
      expect(first.input.specs).toEqual({ custom: "real-spec" });
    }
  });
});

describe("importCsvForItems — failures", () => {
  it("reports missing required name as failed row, not throw", () => {
    const csv = `name,price
,100
Valid,200`;
    const r = importCsvForItems(csv);
    expect(r.summary.total).toBe(2);
    expect(r.summary.ok).toBe(1);
    expect(r.summary.failed).toBe(1);
    const failed = r.rows[0]!;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.row).toBe(2); // 1-based + 1 for header
      expect(failed.raw.price).toBe("100");
    }
  });

  it("returns empty result for empty CSV", () => {
    expect(importCsvForItems("")).toEqual({
      headers: [],
      rows: [],
      summary: { total: 0, ok: 0, failed: 0 },
    });
  });
});

// helper
function r0(csv: string) {
  return importCsvForItems(csv);
}
