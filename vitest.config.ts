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
      // The idempotency module is now a re-export shim of @kleroterion/koine; its logic and its
      // 100%-coverage test live in koine, so the per-file threshold that used to gate it here is gone.
    },
  },
});
