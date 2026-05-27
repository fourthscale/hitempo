import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    pool: "forks", // each test file gets its own postgres client; cleaner isolation
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Next.js's `server-only` package throws on import to prevent client bundling.
      // In the Node test environment we alias it to an empty module so we can
      // import server-only code (Strategies, Builders, etc.) directly.
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
});
