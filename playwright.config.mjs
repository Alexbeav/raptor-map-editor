import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    headless: true,
    acceptDownloads: true,
  },
  reporter: process.env.CI ? "github" : "list",
});
