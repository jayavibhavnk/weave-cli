import { defineConfig } from "vitest/config";
import type { UserConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    // Resolve .ts from src when tests import from "../src/..."
    alias: {},
  },
} as UserConfig);
