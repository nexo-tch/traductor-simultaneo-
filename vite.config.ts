import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
  },
  test: {
    root: ".",
    include: ["client/**/*.test.ts", "server/**/*.test.ts"],
  },
});
