const { test, expect } = require("./fixtures");

// Import on the options page: pick a file written by Export, see what it would change, then merge it in.

const exportFile = (categories, over = {}) => ({
  app: "lichess-puzzle-saver", exportVersion: 1, exportedAt: "2026-01-01T00:00:00.000Z",
  source: { extension: "chrome", extensionVersion: "1.1.0" }, data: { categories }, ...over,
});
const asFile = (obj, name = "lichess-puzzle-saver-export.json") => ({ name, mimeType: "application/json", buffer: Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)) });

async function optionsPage({ context, extensionUrl }) {
  const page = await context.newPage();
  await page.goto(extensionUrl("options.html"));
  return page;
}
const categoriesOf = async (getStorage) => ((await getStorage("lichessNotes")) || {}).categories || {}; // nothing is stored until the first save: reading no longer writes the defaults
const openBackup = async (page) => { // Import and Export live in the Backup & Restore dialog
  await page.getByRole("button", { name: "Backup & Restore" }).click();
  return page.getByRole("dialog", { name: "Backup & Restore" });
};

test("choosing a file shows what it would change, and Cancel changes nothing", async ({ context, extensionUrl, send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  await send({ type: "ADD_PUZZLE", category: "Pins", puzzleId: "abc12" });
  const page = await optionsPage({ context, extensionUrl });
  const before = await categoriesOf(getStorage);

  await page.locator("#import-file").setInputFiles(asFile(exportFile({ Pins: ["abc12", "def34"], Forks: ["ghi56"] })));
  const dialog = page.getByRole("dialog", { name: "Import Data" });
  await expect(dialog).toBeVisible();
  const summary = page.locator("#import-summary");
  await expect(summary).toContainText("New categories: 1");
  await expect(summary).toContainText("Existing categories updated: 1");
  await expect(summary).toContainText("New puzzles added: 2");
  await expect(summary).toContainText("Already saved, skipped: 1");
  expect(await categoriesOf(getStorage)).toEqual(before); // looking is not importing

  await page.locator("#import-cancel").click();
  await expect(dialog).toBeHidden();
  expect(await categoriesOf(getStorage)).toEqual(before);
  await expect(page.locator(".category-card")).toHaveCount(1);
});

test("confirming merges the file in, says what happened, and a second import has nothing left to do", async ({ context, extensionUrl, send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  await send({ type: "ADD_PUZZLE", category: "Pins", puzzleId: "abc12" });
  const page = await optionsPage({ context, extensionUrl });
  const file = asFile(exportFile({ Pins: ["abc12", "def34"], Forks: ["ghi56"] }));

  await page.locator("#import-file").setInputFiles(file);
  await page.locator("#import-confirm").click();
  await expect(page.locator("#toast")).toHaveText("Imported 2 new puzzles and 1 new category.");
  await expect(page.locator("#import-overlay")).toBeHidden();
  await expect(page.locator(".category-card")).toHaveCount(2); // the list refreshed by itself
  expect(await categoriesOf(getStorage)).toEqual({ Pins: ["abc12", "def34"], Forks: ["ghi56"] });

  await page.locator("#import-file").setInputFiles(file); // the same file again
  await expect(page.locator("#import-summary")).toContainText("Everything in this file is already here.");
  await expect(page.locator("#import-confirm")).toBeHidden(); // nothing to confirm
  await page.locator("#import-cancel").click();
  expect(await categoriesOf(getStorage)).toEqual({ Pins: ["abc12", "def34"], Forks: ["ghi56"] });
});

test("a file that is not a Lichess Woodpecker export is refused with a reason, and nothing changes", async ({ context, extensionUrl, send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  const page = await optionsPage({ context, extensionUrl });
  const before = await categoriesOf(getStorage);

  await page.locator("#import-file").setInputFiles(asFile("this is { not json", "notes.json"));
  await expect(page.locator("#toast")).toHaveText("That file isn't valid JSON.");
  await expect(page.locator("#import-overlay")).toBeHidden();

  await page.locator("#import-file").setInputFiles(asFile({ hello: "world" }));
  await expect(page.locator("#toast")).toContainText("export");
  await page.locator("#import-file").setInputFiles(asFile(exportFile({ A: ["abc12"] }, { exportVersion: 2 })));
  await expect(page.locator("#toast")).toContainText("newer version");
  await expect(page.locator("#import-overlay")).toBeHidden();
  expect(await categoriesOf(getStorage)).toEqual(before);
});

test("a file far larger than any export is refused before it is read", async ({ context, extensionUrl, getStorage }) => {
  const page = await optionsPage({ context, extensionUrl });
  const before = await categoriesOf(getStorage);
  await page.locator("#import-file").setInputFiles({ name: "huge.json", mimeType: "application/json", buffer: Buffer.alloc(3 * 1024 * 1024, " ") });
  await expect(page.locator("#toast")).toContainText("too large");
  await expect(page.locator("#import-overlay")).toBeHidden();
  expect(await categoriesOf(getStorage)).toEqual(before);
});

test("Import JSON in the Backup & Restore dialog opens the file picker, and the chosen file shows the preview", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  const dialog = await openBackup(page);
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await dialog.getByRole("button", { name: "Import JSON" }).click(); // the button itself, not the hidden input
  await (await chooser).setFiles(asFile(exportFile({ Forks: ["ghi56"] })));
  await expect(page.getByRole("dialog", { name: "Import Data" })).toBeVisible();
  await expect(page.locator("#import-summary")).toContainText("New puzzles added: 1");
  await expect(dialog).toBeHidden(); // the backup dialog got out of the way of the preview
});

test("if the background cannot be reached, Import says so instead of doing nothing", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  await page.evaluate(() => { browser.runtime.sendMessage = () => Promise.reject(new Error("Extension context invalidated.")); });
  await page.locator("#import-file").setInputFiles(asFile(exportFile({ Forks: ["ghi56"] })));
  await expect(page.locator("#toast")).toContainText("Couldn't reach the extension");
  await expect(page.locator("#import-overlay")).toBeHidden();
});

test("the Import dialog works from the keyboard", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  await expect(page.getByRole("button", { name: "Backup & Restore" })).toBeVisible();
  await page.locator("#import-file").setInputFiles(asFile(exportFile({ Forks: ["ghi56"] })));
  await expect(page.getByRole("dialog", { name: "Import Data" })).toBeVisible();
  await expect(page.locator("#import-confirm")).toBeFocused(); // the likely next step
  await page.keyboard.press("Escape");
  await expect(page.locator("#import-overlay")).toBeHidden();
});

test("a file exported in one browser imports into another, and carries exactly the categories and puzzles", async ({ context, extPage, extensionUrl, send }) => {
  const { chromium } = require("@playwright/test");
  const fs = require("fs"), os = require("os"), path = require("path");

  // Browser A: make some data and press the real Export button.
  for (const [name, ids] of [["Pins", ["abc12", "def34"]], ["Forks", ["ghi56"]], ["Empty", []]]) {
    await send({ type: "CREATE_CATEGORY", name });
    for (const id of ids) await send({ type: "ADD_PUZZLE", category: name, puzzleId: id });
  }
  const a = await optionsPage({ context, extensionUrl });
  const dialogA = await openBackup(a);
  const [download] = await Promise.all([a.waitForEvent("download"), dialogA.getByRole("button", { name: "Export JSON" }).click()]);
  const file = await download.path();
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));

  // Browser B: a different profile with nothing in it.
  const ext = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-import-"));
  const other = await chromium.launchPersistentContext(dir, { headless: false, args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    let [sw] = other.serviceWorkers(); if (!sw) sw = await other.waitForEvent("serviceworker");
    const b = await other.newPage();
    await b.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
    expect(await b.locator(".category-card").count()).toBe(0);
    await b.locator("#import-file").setInputFiles(file);
    await expect(b.locator("#import-summary")).toContainText("New categories: 3");
    await b.locator("#import-confirm").click();
    await expect(b.locator(".category-card")).toHaveCount(3);
    const got = await b.evaluate(async () => (await browser.runtime.sendMessage({ type: "GET_ALL_DATA" })).categories);
    expect(got).toEqual(exported.data.categories); // the same categories and puzzles, in the new browser
    expect(Object.keys(got).sort()).toEqual(["Empty", "Forks", "Pins"]);
  } finally {
    await other.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
