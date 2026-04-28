import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    // Files under src/server/** import "server-only", which throws unless the
    // `react-server` Node export condition is set. Next.js sets it for Server
    // Components and Server Actions; Vitest must opt in explicitly for tests.
    conditions: ["react-server"],
  },
});
