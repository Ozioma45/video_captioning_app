import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // .kilo/worktrees/** is a separate git worktree the Kilo Code IDE
    // extension maintains for its own purposes — it contains a full
    // mirror of src/ (tests included) and its own vitest.config.ts.
    // Vitest's default recursive discovery would otherwise walk into it
    // from the project root and double-run everything found there.
    exclude: [...configDefaults.exclude, ".kilo/**"],
  },
});
