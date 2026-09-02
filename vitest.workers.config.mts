import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Runs worker tests inside workerd itself, so Durable Objects, SQLite storage and
 * WebSocket hibernation behave as they will in production rather than as mocks.
 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["worker/**/*.test.ts"],
  },
});
