const { defineConfig } = require("@playwright/test");

// Extensions need a persistent context (see tests/fixtures.js), so one worker, one project.
// Add a "firefox" project here later with its own fixture.
module.exports = defineConfig({
  testDir: "tests",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
});
