// vitest.config.ts — fast default suite excludes e2e and forbids real network (msw onUnhandledRequest:error).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**"],
    pool: "threads",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli/bin.ts", "src/agents/prompts*/**", "**/*.d.ts"],
      // Gate the pure functional core (idempotency is load-bearing for autonomous dedupe).
      // Global thresholds intentionally ratchet up as the integration suite fills in.
      thresholds: {
        "src/util/idempotency.ts": { lines: 100, branches: 80, functions: 100, statements: 100 },
      },
    },
  },
});
