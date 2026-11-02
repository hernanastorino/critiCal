import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web", "supabase/functions"],
    coverage: {
      provider: "v8",
      include: ["**/src/**/*.{ts,tsx}", "supabase/functions/_shared/**/*.ts"],
      exclude: ["**/*.test.*", "**/main.tsx", "**/*.d.ts", "**/testing.ts"],
      reporter: ["text", "lcov", "json-summary"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        "packages/engine/src/**": { lines: 90, functions: 90, branches: 90 },
      },
    },
  },
});
