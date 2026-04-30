/**
 * CSV import for KnowledgeItem (Phase 8c).
 *
 * Generic header-mapped parser. The first row is treated as headers; rows
 * with the same length get mapped to a draft KnowledgeItemInput shape.
 * Headers matching standard fields (name, category, brand, sku, currency,
 * price, availability, description, externalId / external_id) populate
 * the typed slots; everything else becomes a spec key/value pair.
 *
 * Per Gate-1 B: "generic CSV parser with preset framework support" — the
 * preset hook is the future expansion (an Odoo preset would just be a
 * different header-name mapping table). For P8c-4 we ship the generic
 * mapping; specific presets land when the Odoo connector does.
 *
 * Pure function — no I/O. Used by both client preview UI and server
 * validation. Runs on small (~10KB) pasted CSV bodies; no streaming.
 */

import { knowledgeItemInputSchema, type KnowledgeItemInput } from "./items";

export type CsvRowResult =
  | { row: number; ok: true; input: KnowledgeItemInput }
  | { row: number; ok: false; error: string; raw: Record<string, string> };

export type CsvImportResult = {
  /** Headers as parsed (lowercased + trimmed). */
  headers: string[];
  /** Per-row outcome. Includes both ok and failed rows. */
  rows: CsvRowResult[];
  /** Aggregate counts for the UI banner. */
  summary: { total: number; ok: number; failed: number };
};

const FIELD_HEADER_ALIASES: Record<string, keyof KnowledgeItemInput | "price"> = {
  // Standard aliases — operators with a generic CSV from any source can
  // expect these to map.
  name: "name",
  product: "name",
  product_name: "name",
  title: "name",
  category: "category",
  type: "category",
  brand: "brand",
  manufacturer: "brand",
  sku: "sku",
  reference: "sku",
  ref: "sku",
  currency: "currency",
  price: "price",
  cost: "price",
  amount: "price",
  availability: "availability",
  stock: "availability",
  status: "availability",
  description: "description",
  desc: "description",
  notes: "description",
  externalid: "externalId",
  external_id: "externalId",
  id: "externalId",
};

const AVAILABILITY_ALIASES: Record<string, KnowledgeItemInput["availability"]> = {
  in_stock: "IN_STOCK",
  instock: "IN_STOCK",
  available: "IN_STOCK",
  yes: "IN_STOCK",
  "true": "IN_STOCK",
  low: "LOW_STOCK",
  low_stock: "LOW_STOCK",
  lowstock: "LOW_STOCK",
  limited: "LOW_STOCK",
  out: "OUT_OF_STOCK",
  out_of_stock: "OUT_OF_STOCK",
  outofstock: "OUT_OF_STOCK",
  unavailable: "OUT_OF_STOCK",
  no: "OUT_OF_STOCK",
  "false": "OUT_OF_STOCK",
};

/**
 * Split a CSV body into rows + cells. Handles quoted fields with embedded
 * commas and double-quote escaping ("" inside quotes). Newlines inside
 * quoted fields are preserved.
 *
 * Pure JS; no streaming. For pasted CSV up to a few MB this is fine.
 */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Treat \r\n as one newline.
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      cell = "";
      // Skip empty trailing rows (blank lines).
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  // Flush last cell + row if no trailing newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export function importCsvForItems(text: string): CsvImportResult {
  const grid = parseCsvText(text);
  if (grid.length === 0) {
    return {
      headers: [],
      rows: [],
      summary: { total: 0, ok: 0, failed: 0 },
    };
  }
  const rawHeaders = grid[0]!;
  const headers = rawHeaders.map((h) => h.trim().toLowerCase());
  const dataRows = grid.slice(1);
  const results: CsvRowResult[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r]!;
    const raw: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c]!;
      raw[h] = (cells[c] ?? "").trim();
    }
    try {
      const draft = mapRow(raw);
      const parsed = knowledgeItemInputSchema.parse(draft);
      results.push({ row: r + 2, ok: true, input: parsed }); // +2 = +1 for header, +1 for 1-based
    } catch (err) {
      results.push({
        row: r + 2,
        ok: false,
        error: err instanceof Error ? err.message : "unknown error",
        raw,
      });
    }
  }

  return {
    headers,
    rows: results,
    summary: {
      total: results.length,
      ok: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
    },
  };
}

function mapRow(raw: Record<string, string>): unknown {
  // Resolve standard fields by header alias.
  const standard: Partial<Record<keyof KnowledgeItemInput, string>> & {
    price?: string;
  } = {};
  const specs: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    const target = FIELD_HEADER_ALIASES[k];
    if (target) {
      // Last-write-wins if multiple aliases collide.
      (standard as Record<string, string>)[target] = v;
    } else {
      // Non-standard column → spec key. Skip header noise (numbers,
      // empty headers from trailing commas).
      const safeKey = k.trim();
      if (!safeKey || /^\d+$/.test(safeKey) || safeKey.startsWith("_")) continue;
      specs[safeKey] = v;
    }
  }

  // Parse price → priceCents (decimal → int * 100). Drop on bad input.
  let priceCents: number | undefined;
  if (standard.price) {
    const parsed = Number.parseFloat(standard.price.replace(/,/g, "."));
    if (Number.isFinite(parsed) && parsed >= 0) {
      priceCents = Math.round(parsed * 100);
    }
  }

  // Normalize availability via alias map; default to UNKNOWN if unknown.
  let availability: KnowledgeItemInput["availability"] = "UNKNOWN";
  if (standard.availability) {
    const key = standard.availability.toLowerCase().trim().replace(/\s+/g, "_");
    availability = AVAILABILITY_ALIASES[key] ?? "UNKNOWN";
  }

  return {
    name: standard.name ?? "",
    category: standard.category,
    externalId: standard.externalId,
    sku: standard.sku,
    brand: standard.brand,
    currency: standard.currency,
    priceCents,
    availability,
    description: standard.description,
    specs,
  };
}
