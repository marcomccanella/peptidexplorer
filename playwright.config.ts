import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8081",
    ...(process.env["PLAYWRIGHT_CHANNEL"] ? { channel: process.env["PLAYWRIGHT_CHANNEL"] } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node --import ./tests/e2e/upstreams.mjs ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8081",
    url: "http://127.0.0.1:8081",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BEACON_TEST_FIXTURES: "1" },
  },
});
