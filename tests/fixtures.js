/**
 * The only browser-specific file. Specs use: context, extensionUrl(path), send(msg), seedStorage(obj), getStorage(key).
 * Chromium only: branded Chrome 137+ ignores --load-extension, so use Playwright's bundled Chromium.
 * For Firefox later, provide the same exports from a second fixture and add a Playwright project.
 */
const base = require("@playwright/test");
const path = require("path");
const os = require("os");
const fs = require("fs");

const EXT_PATH = path.resolve(__dirname, "..");

const test = base.test.extend({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-profile-"));
    const context = await base.chromium.launchPersistentContext(userDataDir, {
      headless: false, // new headless via arg below; extensions don't load in old headless
      args: [
        "--headless=new",
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(new URL(sw.url()).host);
  },
  extensionUrl: async ({ extensionId }, use) => {
    await use((p) => `chrome-extension://${extensionId}/${p}`);
  },
  // Run code in an extension page (popup.html) so chrome.* APIs are available.
  extPage: async ({ context, extensionUrl }, use) => {
    const page = await context.newPage();
    await page.goto(extensionUrl("popup.html"));
    await use(page);
  },
  send: async ({ extPage }, use) => {
    await use((msg) => extPage.evaluate((m) => browser.runtime.sendMessage(m), msg));
  },
  // Flush the extension's first load before seeding, then verify the seed stuck. (Reading no longer writes defaults, but a
  // page's own first activity can still race a seed, so the verify loop stays.)
  seedStorage: async ({ extPage }, use) => {
    await use(async (obj) => {
      await extPage.evaluate(() => browser.runtime.sendMessage({ type: "GET_ALL_DATA" }));
      await extPage.evaluate(async (o) => {
        // Storage returns object keys in its own order, so compare canonically
        // (recursing through arrays too, or arrays of objects never match).
        const canon = (v) => {
          if (Array.isArray(v)) return JSON.stringify(v.map(canon));
          if (v && typeof v === "object") return JSON.stringify(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
          return JSON.stringify(v);
        };
        for (let i = 0; i < 10; i++) {
          await browser.storage.local.set(o);
          const got = await browser.storage.local.get(Object.keys(o));
          if (Object.keys(o).every((k) => canon(got[k]) === canon(o[k]))) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("seedStorage: storage kept getting overwritten");
      }, obj);
    });
  },
  getStorage: async ({ extPage }, use) => {
    await use((key) => extPage.evaluate(async (k) => (await browser.storage.local.get(k))[k], key));
  },
});

module.exports = { test, expect: base.expect };
