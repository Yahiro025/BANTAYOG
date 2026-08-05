import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts", "lib/env.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@bantayog/schema/analytics": path.resolve(__dirname, "../../packages/schema/src/analytics.ts"),
      "@bantayog/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
      "@bantayog/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
});
