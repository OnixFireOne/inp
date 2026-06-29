// vitest.config.ts
// Vitest setup. Node env is enough for the pure resolver under lib/links/.
// UI tests (when they arrive) will need jsdom + a separate include.
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
})
