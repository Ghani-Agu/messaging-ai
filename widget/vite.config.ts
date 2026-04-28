import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { visualizer } from "rollup-plugin-visualizer";

/**
 * Vite library build for the embeddable chat widget.
 *
 * Output: a single IIFE bundle at dist/widget.js that any client embeds via
 *   <script src="…/widget.js" data-tenant="…" async></script>
 *
 * CSS is inlined into the JS bundle (we import it via `?inline` in main.ts
 * and inject into the Shadow DOM at mount time), so no separate stylesheet
 * leaks onto the host page.
 *
 * Bundle-size guards (post-build):
 *   - hard limit: 25 KB gz   → exit 1 in scripts/check-bundle-size.mjs
 *   - stretch:    20 KB gz   → warn, do not fail
 * Composition (preact / widget src / styles) reported via stats.json from
 * rollup-plugin-visualizer.
 */
export default defineConfig({
  plugins: [
    preact(),
    visualizer({
      template: "raw-data",
      filename: "dist/stats.json",
      gzipSize: true,
      sourcemap: false,
    }),
  ],
  build: {
    lib: {
      entry: "src/main.ts",
      name: "MessagingAIWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      // Bundle preact in — the widget must run with no host-page deps.
      external: [],
    },
  },
});
