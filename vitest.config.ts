import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    // Mirror tsconfig.json `paths`: `@/*` → `./src/*`. Required so source
    // files that use the alias load under vitest the same way they do in
    // Next.js (e.g. orchestrator.ts importing @/server/db/client).
    alias: {
      "@": path.resolve(root, "src"),
    },
    // Files under src/server/** import "server-only", which throws unless the
    // `react-server` Node export condition is set. Next.js sets it for Server
    // Components and Server Actions; Vitest must opt in explicitly for tests.
    conditions: ["react-server"],
  },
});
