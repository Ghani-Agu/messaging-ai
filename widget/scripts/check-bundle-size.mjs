// Post-build bundle-size guard. Runs as the second step of `npm run build`.
//
// Reports total widget.js size (raw + gzipped) and a composition breakdown
// (preact / widget src / styles / other) parsed from the visualizer stats
// JSON. Exits non-zero if the gzipped total exceeds the hard budget; emits
// a warning between the stretch and hard budgets.

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STRETCH_LIMIT_KB = 20;
const HARD_LIMIT_KB = 25;

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "..", "dist");
const widgetJs = resolve(distRoot, "widget.js");
const statsPath = resolve(distRoot, "stats.json");

if (!existsSync(widgetJs)) {
  console.error("✗ widget.js not built yet. Run: npm run build (inside widget/)");
  process.exit(1);
}

const raw = readFileSync(widgetJs);
const gz = gzipSync(raw, { level: 9 });

const rawKb = (raw.length / 1024).toFixed(2);
const gzKb = (gz.length / 1024).toFixed(2);

console.log(`\nwidget.js: ${rawKb} KB raw / ${gzKb} KB gz`);

if (existsSync(statsPath)) {
  // visualizer raw-data v2 shape:
  //   tree: nested { name, children, uid? } — leaves carry uid
  //   nodeParts[uid]: { gzipLength, renderedLength, metaUid }
  //   nodeMetas[metaUid]: { id: <full path> }
  const stats = JSON.parse(readFileSync(statsPath, "utf8"));
  const buckets = { preact: 0, widgetSrc: 0, styles: 0, other: 0 };
  const parts = stats.nodeParts ?? {};
  const metas = stats.nodeMetas ?? {};

  for (const uid of Object.keys(parts)) {
    const part = parts[uid];
    const meta = metas[part.metaUid];
    const path = meta?.id ?? "";
    const size = typeof part.gzipLength === "number" ? part.gzipLength : 0;
    if (/node_modules[\\/]preact/.test(path)) buckets.preact += size;
    else if (/[\\/]widget[\\/]src[\\/]/.test(path)) buckets.widgetSrc += size;
    else if (/\.css(\?|$)/.test(path)) buckets.styles += size;
    else buckets.other += size;
  }

  const fmt = (n) => `${(n / 1024).toFixed(2)} KB`;
  console.log("Composition (gz, approximate):");
  console.log(`  preact:      ${fmt(buckets.preact)}`);
  console.log(`  widget src:  ${fmt(buckets.widgetSrc)}`);
  console.log(`  styles:      ${fmt(buckets.styles)}`);
  console.log(`  other:       ${fmt(buckets.other)}`);
} else {
  console.log("(stats.json missing — composition breakdown skipped)");
}

if (gz.length > HARD_LIMIT_KB * 1024) {
  console.error(
    `\n✗ over hard budget: ${gzKb} KB gz exceeds ${HARD_LIMIT_KB} KB. Trim before merging.`,
  );
  process.exit(1);
}
if (gz.length > STRETCH_LIMIT_KB * 1024) {
  console.warn(
    `\n⚠ over stretch budget: ${gzKb} KB gz > ${STRETCH_LIMIT_KB} KB (hard ${HARD_LIMIT_KB} KB still satisfied).`,
  );
} else {
  console.log(`\n✓ under stretch budget (${STRETCH_LIMIT_KB} KB gz)`);
}
