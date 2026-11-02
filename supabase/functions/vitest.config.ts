import { defineConfig } from "vitest/config";

export default defineConfig({ test: { name: "functions", include: ["_shared/**/*.test.ts"] } });
