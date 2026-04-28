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
  // Dev-only: proxy /api/* to the Next.js dev server so streamMessage
  // (widget/src/api.ts) can issue relative fetches against the real
  // POST /api/widget/messages route while the dev shell runs at :5173.
  // Phase 6e will formalize the production base-URL story — likely a
  // data-api-base attribute on the embed script — so the widget bundle
  // can be served from any origin and call back to ours.
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
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
