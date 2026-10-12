const { test, expect } = require("./fixtures");

// The options page: two tabs (Categories, Statistics) under a sticky top bar that also holds Backup & Restore.

const notes = (categories, trainingStats) => ({
  lichessNotes: { categories, meta: { version: 1, updatedAt: 0, ...(trainingStats ? { trainingStats } : {}) } },
});
const cycle = (n) => ({ category: `Cycle ${n}`, timeTaken: 60_000 + n, totalPuzzles: 10, correct: 7, incorrect: 2, skipped: 1, completedAt: 1_700_000_000_000 + n * 86_400_000 });
// stored out of order on purpose: "most recent" must come from the dates, not from the order in storage
const cycles = (n) => Array.from({ length: n }, (_, i) => cycle(i + 1)).sort((a, b) => ((a.completedAt / 86_400_000) % 7) - ((b.completedAt / 86_400_000) % 7));

async function optionsPage({ context, extensionUrl }) {
  const page = await context.newPage();
  await page.goto(extensionUrl("options.html"));
  return page;
}
const tab = (page, name) => page.getByRole("tab", { name });
const backupButton = (page) => page.getByRole("button", { name: "Backup & Restore" });
const backupDialog = (page) => page.getByRole("dialog", { name: "Backup & Restore" });

test("two tabs, Categories first: one panel shows at a time, and the tabs work from the keyboard", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage({ ...notes({ Pins: ["abc12"] }, cycles(3)) });
  const page = await optionsPage({ context, extensionUrl });
  await expect(page.getByRole("tablist")).toBeVisible();
  await expect(tab(page, "Categories")).toHaveAttribute("aria-selected", "true"); // the default
  await expect(tab(page, "Statistics")).toHaveAttribute("aria-selected", "false");

  // Categories: search, New Category and the list; nothing of Statistics
  await expect(page.locator("#search-input")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ New Category" })).toBeVisible();
  await expect(page.locator(".category-card")).toHaveCount(1);
  await expect(page.locator("#stats-table-container")).toBeHidden();
  await expect(page.locator("#btn-clear-stats")).toBeHidden();

  await tab(page, "Statistics").click();
  await expect(tab(page, "Statistics")).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, "Categories")).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#stats-table-container")).toBeVisible();
  await expect(page.locator("#btn-clear-stats")).toBeVisible();
  await expect(page.getByRole("button", { name: /refresh/i })).toHaveCount(0); // the page keeps itself up to date, so there is nothing to press
  await expect(page.locator("#search-input")).toBeHidden();
  await expect(page.locator(".category-card")).toBeHidden();

  // each tab controls its own panel
  for (const [name, panel] of [["Categories", "#panel-categories"], ["Statistics", "#panel-stats"]]) {
    const id = await tab(page, name).getAttribute("aria-controls");
    expect(`#${id}`).toBe(panel);
    await expect(page.locator(panel)).toHaveAttribute("role", "tabpanel");
  }

  // keyboard: arrows move between tabs (and select them), Home and End jump
  await tab(page, "Statistics").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Categories")).toBeFocused();
  await expect(tab(page, "Categories")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#search-input")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Statistics")).toBeFocused();
  await expect(page.locator("#stats-table-container")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(tab(page, "Categories")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tab(page, "Statistics")).toHaveAttribute("aria-selected", "true");
  // only the selected tab is in the tab order
  await expect(tab(page, "Categories")).toHaveAttribute("tabindex", "-1");
  await expect(tab(page, "Statistics")).toHaveAttribute("tabindex", "0");
});

test("the top bar is sticky: the tabs and Backup & Restore stay in view while a long list scrolls", async ({ context, extensionUrl, seedStorage }) => {
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Category ${String(i + 1).padStart(2, "0")}`, ["abc12", "def34", "ghi56"]]));
  await seedStorage(notes(many));
  const page = await optionsPage({ context, extensionUrl });
  await expect(page.locator(".category-card")).toHaveCount(80);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(2000);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
  const bar = await page.locator(".topbar").boundingBox();
  expect(bar.y).toBeLessThanOrEqual(1); // still at the top of the screen
  // and opaque (rgb, not rgba), or the categories scrolling underneath would show through its text
  expect(await page.locator(".topbar").evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/^rgb\(/);
  await expect(backupButton(page)).toBeInViewport();
  await expect(tab(page, "Categories")).toBeInViewport();
  await expect(tab(page, "Statistics")).toBeInViewport();

  // and a tab can be switched from down there
  await tab(page, "Statistics").click();
  await expect(tab(page, "Statistics")).toHaveAttribute("aria-selected", "true");
});

test("Backup & Restore is one button in the top bar that opens a small dialog with Import JSON and Export JSON", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  const trigger = backupButton(page);
  await expect(trigger).toBeVisible();
  await expect(backupDialog(page)).toBeHidden();
  // the old standalone buttons at the foot of the page are gone
  await expect(page.getByRole("button", { name: "Import Data (JSON)" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export Data (JSON)" })).toHaveCount(0);

  // the button sits on the right of the same bar as the title
  const [title, button, bar] = await Promise.all([page.locator(".header h1").boundingBox(), trigger.boundingBox(), page.locator(".topbar").boundingBox()]);
  expect(button.x).toBeGreaterThan(title.x + title.width);
  expect(Math.abs((button.y + button.height / 2) - (title.y + title.height / 2))).toBeLessThan(8);
  expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width);

  await trigger.click();
  const dialog = backupDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import JSON" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export JSON" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Import JSON" })).toBeFocused(); // focus moves into the dialog

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused(); // and comes back to where it was

  await trigger.click();
  await page.locator("#backup-overlay").click({ position: { x: 5, y: 5 } }); // the backdrop
  await expect(dialog).toBeHidden();

  await trigger.click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("Export JSON from the dialog downloads the file and closes the dialog", async ({ context, extensionUrl, send }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  await send({ type: "ADD_PUZZLE", category: "Pins", puzzleId: "abc12" });
  const page = await optionsPage({ context, extensionUrl });
  await backupButton(page).click();
  const [download] = await Promise.all([page.waitForEvent("download"), backupDialog(page).getByRole("button", { name: "Export JSON" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^lichess-puzzle-saver-export-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.locator("#toast")).toHaveText("Export downloaded.");
  await expect(backupDialog(page)).toBeHidden();
});

test("the table's columns are Category, Time, Puzzles, Correct, Incorrect, Skipped, Accuracy and Completed, with icons and dividers", async ({ context, extensionUrl, seedStorage }) => {
  // the widest realistic row first: the longest name Woodpecker makes ("All Categories"), a long time, and a "Today, 11:22 AM" date
  const widest = { category: "All Categories", timeTaken: 341_000, totalPuzzles: 6, correct: 1, incorrect: 1, skipped: 4, completedAt: Date.now() - 60_000 };
  await seedStorage(notes({}, [...cycles(11), widest]));
  const page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  const heads = page.locator(".stats-table th");

  const labels = (await heads.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(labels).toEqual(["Category", "Time", "Puzzles", "Correct", "Incorrect", "Skipped", "Accuracy", "Completed"]);

  // an icon in front of every column's name except the date (the Category column has its folder)
  const withIcon = await heads.evaluateAll((els) => els.map((el) => !!el.querySelector("svg")));
  expect(withIcon).toEqual([true, true, true, true, true, true, true, false]);

  // the colour system: Correct green, Incorrect red, Skipped amber, Accuracy neutral, on the icons AND on the numbers
  const colourOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color.match(/\d+/g).map(Number));
  const icon = (name) => heads.filter({ hasText: new RegExp(`^${name}$`) }).locator("svg");
  const row0 = page.locator("#stats-tbody tr").first();
  const isGreenish = ([r, g, b]) => g > r + 60 && g > b + 40;
  const isRed = ([r, g, b]) => r > 200 && g < 110 && b < 110;
  const isAmber = ([r, g, b]) => r > 220 && g > 140 && g < 190 && b < 60;
  const isNeutral = ([r, g, b]) => Math.min(r, g, b) > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
  expect(isGreenish(await colourOf(icon("Correct"))), "Correct icon is green").toBe(true);
  expect(isRed(await colourOf(icon("Incorrect"))), "Incorrect icon is red").toBe(true);
  expect(isAmber(await colourOf(icon("Skipped"))), "Skipped icon is amber").toBe(true);
  expect(isNeutral(await colourOf(icon("Accuracy"))), "Accuracy icon is neutral").toBe(true);
  expect(isGreenish(await colourOf(row0.locator(".correct"))), "Correct numbers are green").toBe(true);
  expect(isRed(await colourOf(row0.locator(".incorrect"))), "Incorrect numbers are red").toBe(true);
  expect(isAmber(await colourOf(row0.locator(".skipped"))), "Skipped numbers are amber").toBe(true);

  // every header fits on one line, and nothing is clipped, wrapped or scrolled sideways, even on the widest row
  for (const h of await heads.all()) expect((await h.boundingBox()).height).toBeLessThanOrEqual(46);
  const container = page.locator("#stats-table-container");
  expect(await container.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "no sideways scroll").toBe(true);
  const top = page.locator("#stats-tbody tr").first();
  await expect(top.locator(".category-name")).toHaveText("All Categories");
  await expect(top.locator(".completed-date")).toContainText("Today");
  expect((await top.boundingBox()).height, "the widest row stays on one line").toBeLessThanOrEqual(38);
  const box = await container.boundingBox();
  const textRight = await top.locator(".completed-date").evaluate((td) => { const r = document.createRange(); r.selectNodeContents(td); return r.getBoundingClientRect().right; }); // the words, not the cell around them
  expect(textRight, "the date is not clipped by the table's edge").toBeLessThanOrEqual(box.x + box.width - 4);

  // thin dividers between the columns (none before the first), in the header and in the rows
  const left = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth));
  expect(await left(heads.first())).toBe(0);
  for (const i of [1, 4, 7]) {
    expect(await left(heads.nth(i)), `header ${i}`).toBeGreaterThanOrEqual(1);
    expect(await left(page.locator("#stats-tbody tr").first().locator("td").nth(i)), `cell ${i}`).toBeGreaterThanOrEqual(1);
  }

  // hovering a header explains it, and Accuracy still says what it counts
  await expect(heads.filter({ hasText: "Accuracy" })).toHaveAttribute("title", /without a wrong move/);
  await expect(heads.filter({ hasText: /^Time$/ })).toHaveAttribute("title", /long/i);
  await expect(heads.filter({ hasText: /^Puzzles$/ })).toHaveAttribute("title", /puzzles in the cycle/i);
});

test("every date the table can show fits: 'Yesterday, hh:mm AM' is the widest and is not clipped or scrolled", async ({ context, extensionUrl, seedStorage }) => {
  const DAY = 86_400_000;
  const row = (category, ago) => ({ category, timeTaken: 2_461_000, totalPuzzles: 108, correct: 80, incorrect: 22, skipped: 6, completedAt: Date.now() - ago });
  // the longest name, a long time, and one row for each shape of date: today, yesterday, "N days ago", a full date
  await seedStorage(notes({}, [row("All Categories", 60_000), row("All Categories", 30 * 3_600_000), row("All Categories", 4 * DAY), row("All Categories", 40 * DAY)]));
  const page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  const dates = await page.locator("#stats-tbody .completed-date").allTextContents();
  expect(dates[1], "the second row is the yesterday one").toMatch(/^Yesterday, \d\d:\d\d [AP]M$/);
  expect(dates.length).toBe(4);

  const container = page.locator("#stats-table-container");
  const box = await container.boundingBox();
  const overflow = await container.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, `the table does not scroll sideways (it overflows by ${overflow}px)`).toBeLessThanOrEqual(0);
  for (const [i, td] of (await page.locator("#stats-tbody .completed-date").all()).entries()) {
    const right = await td.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().right; });
    expect(right, `"${dates[i]}" ends inside the table (${Math.round(right)} vs ${Math.round(box.x + box.width)})`).toBeLessThanOrEqual(box.x + box.width - 4); // the same margin as the "Today" check above
  }
  for (const tr of await page.locator("#stats-tbody tr").all()) expect((await tr.boundingBox()).height, "one line per row").toBeLessThanOrEqual(38);
});

test("Statistics shows the 10 most recent cycles, newest first, and Load more shows 10 more", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({}, cycles(25)));
  const page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  const rows = page.locator("#stats-tbody tr");
  const names = () => rows.locator(".category-name").allTextContents();

  await expect(rows).toHaveCount(10);
  expect(await names()).toEqual(Array.from({ length: 10 }, (_, i) => `Cycle ${25 - i}`)); // newest first, whatever the stored order
  await expect(page.locator("#stats-count")).toHaveText("Showing 10 of 25");
  const more = page.getByRole("button", { name: /Load more/ });
  await expect(more).toBeVisible();

  await more.click();
  await expect(rows).toHaveCount(20);
  await expect(page.locator("#stats-count")).toHaveText("Showing 20 of 25");
  expect((await names())[19]).toBe("Cycle 6");

  await more.click();
  await expect(rows).toHaveCount(25);
  await expect(page.locator("#stats-count")).toHaveText("Showing 25 of 25");
  await expect(more).toBeHidden(); // nothing more to load
  expect((await names())[24]).toBe("Cycle 1");

  await expect(rows).toHaveCount(25); // and what was loaded stays loaded (the live-sync tests below cover new cycles arriving)
});

test("with ten cycles or fewer there is nothing to load, and no empty-table clutter", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({}, cycles(10)));
  let page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  await expect(page.locator("#stats-tbody tr")).toHaveCount(10);
  await expect(page.getByRole("button", { name: /Load more/ })).toBeHidden();
  await expect(page.locator("#stats-count")).toBeHidden();
  await page.close();

  await seedStorage(notes({}));
  page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  await expect(page.locator("#stats-empty")).toBeVisible();
  await expect(page.locator("#stats-table-container")).toBeHidden();
  await expect(page.getByRole("button", { name: /Load more/ })).toBeHidden();
});

test("Clear Stats asks in the page itself (never a native dialog), and only clears on confirmation", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await seedStorage(notes({ Pins: ["abc12"] }, cycles(12)));
  const page = await optionsPage({ context, extensionUrl });
  let nativeDialogs = 0; // a native confirm() is auto-dismissed by automation and can be suppressed by the browser
  page.on("dialog", (d) => { nativeDialogs++; d.dismiss(); });
  await tab(page, "Statistics").click();
  await page.locator("#btn-clear-stats").click();
  const ask = page.getByRole("dialog", { name: "Clear statistics" });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("12");
  await expect(ask).toContainText("cannot be undone");

  await ask.getByRole("button", { name: "Cancel" }).click(); // keep them
  await expect(ask).toBeHidden();
  expect((await getStorage("lichessNotes")).meta.trainingStats).toHaveLength(12);
  await expect(page.locator("#stats-tbody tr")).toHaveCount(10);

  await page.locator("#btn-clear-stats").click(); // Escape also cancels
  await page.keyboard.press("Escape");
  await expect(ask).toBeHidden();
  expect((await getStorage("lichessNotes")).meta.trainingStats).toHaveLength(12);

  await page.locator("#btn-clear-stats").click();
  await ask.getByRole("button", { name: "Clear" }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Training statistics cleared.");
  expect((await getStorage("lichessNotes")).meta.trainingStats).toEqual([]);
  expect((await getStorage("lichessNotes")).categories).toEqual({ Pins: ["abc12"] }); // the saved puzzles are untouched
  await expect(page.locator("#stats-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: /Load more/ })).toBeHidden();
  expect(nativeDialogs).toBe(0);
});

test("the version still shows, now at the foot of the page", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  await expect(page.locator("#version")).toHaveText(/^v\d+\.\d+\.\d+$/);
});


// ---- The Statistics tab's layout ----

test("Training History is laid out as a heading with an icon, a bordered table with compact rows, and a footer bar", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({}, cycles(15)));
  const page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();

  // heading: an icon tile and the title on the left, Clear Stats on the right of the same row (no Refresh: the page syncs itself)
  const heading = page.locator(".section-header h2");
  await expect(heading).toHaveText("Training History");
  await expect(page.locator(".section-icon svg")).toBeVisible();
  const [icon, title, clear] = await Promise.all([page.locator(".section-icon").boundingBox(), heading.boundingBox(), page.locator("#btn-clear-stats").boundingBox()]);
  const mid = (b) => b.y + b.height / 2;
  expect(icon.x + icon.width).toBeLessThanOrEqual(title.x + 1); // icon, then title
  for (const b of [icon, clear]) expect(Math.abs(mid(b) - mid(title))).toBeLessThan(6);
  expect(clear.x).toBeGreaterThan(title.x + title.width);
  const sectionBox = await page.locator(".stats-section").boundingBox();
  expect(clear.x + clear.width, "Clear Stats sits at the right end of the heading row").toBeGreaterThan(sectionBox.x + sectionBox.width - 40);
  await expect(page.locator("#btn-refresh-stats")).toHaveCount(0);
  await expect(page.locator(".section-header-buttons button")).toHaveCount(1);

  // the table sits in its own rounded, bordered box
  const box = page.locator("#stats-table-container");
  const frame = await box.evaluate((el) => { const st = getComputedStyle(el); return { border: parseFloat(st.borderTopWidth), radius: parseFloat(st.borderTopLeftRadius) }; });
  expect(frame.border).toBeGreaterThanOrEqual(1);
  expect(frame.radius).toBeGreaterThanOrEqual(8);

  // rows are compact
  const rows = page.locator("#stats-tbody tr");
  await expect(rows).toHaveCount(10);
  expect((await rows.first().boundingBox()).height).toBeLessThanOrEqual(38);
  expect(await rows.last().locator("td").first().evaluate((el) => parseFloat(getComputedStyle(el).borderBottomWidth))).toBe(0); // no line under the last row

  // alignment: the category and the date on the left, every figure centred under its header
  const align = (loc) => loc.evaluate((el) => getComputedStyle(el).textAlign);
  const first = rows.first();
  for (const cell of [".category-name", ".completed-date"]) expect(["left", "start"]).toContain(await align(first.locator(cell)));
  for (const cell of [".time-taken", ".total-puzzles", ".correct", ".incorrect", ".skipped", ".success-rate"]) expect(await align(first.locator(cell))).toBe("center");
  for (const head of ["Time", "Puzzles", "Correct", "Incorrect", "Skipped", "Accuracy"]) expect(await align(page.locator(".stats-table th", { hasText: new RegExp(`^${head}$`) })), head).toBe("center");
  expect(["left", "start"]).toContain(await align(page.locator(".stats-table th", { hasText: "Completed" })));

  // names and totals are the bold ones; durations are plain figures, not monospace code
  expect(parseInt(await first.locator(".category-name").evaluate((el) => getComputedStyle(el).fontWeight), 10)).toBeGreaterThanOrEqual(600);
  expect(parseInt(await first.locator(".total-puzzles").evaluate((el) => getComputedStyle(el).fontWeight), 10)).toBeGreaterThanOrEqual(600);
  expect(await first.locator(".time-taken").evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono|courier/i);

  // footer: the count and Load more sit in their own bar
  const bar = page.locator("#stats-more");
  const barStyle = await bar.evaluate((el) => { const st = getComputedStyle(el); return { border: parseFloat(st.borderTopWidth), radius: parseFloat(st.borderTopLeftRadius) }; });
  expect(barStyle.border).toBeGreaterThanOrEqual(1);
  expect(barStyle.radius).toBeGreaterThanOrEqual(8);
  const [barBox, count, more] = await Promise.all([bar.boundingBox(), page.locator("#stats-count").boundingBox(), page.getByRole("button", { name: /Load more/ }).boundingBox()]);
  expect(count.x).toBeGreaterThanOrEqual(barBox.x);
  expect(more.x).toBeGreaterThan(count.x + count.width);
  expect(more.x + more.width).toBeLessThanOrEqual(barBox.x + barBox.width);
});

// ---- Help & About ----

const helpButton = (page) => page.getByRole("button", { name: "Help & About" });
const helpDialog = (page) => page.getByRole("dialog", { name: "Help & About" });
const REPO = "https://github.com/avendesta/lichess-woodpecker";
const HELP_ITEMS = [
  ["Help & Documentation", "Learn how to save puzzles and use Woodpecker training.", `${REPO}#readme`],
  ["Report an Issue", "Found a bug or have a feature request? Let me know.", `${REPO}/issues`],
  ["Contact Developer", "Questions, feedback or other inquiries.", "mailto:avendesta2020@gmail.com"],
  ["Privacy Policy", "Learn what data is stored and how your privacy is protected.", `${REPO}/blob/main/PRIVACY_POLICY.md`],
];

test("a Help & About button sits right beside Backup & Restore, and the popup is left free of it", async ({ context, extPage, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  const help = helpButton(page);
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute("title", "Help & About");
  await expect(help.locator("svg")).toBeVisible(); // an icon button, no label
  const [b, h, bar] = await Promise.all([backupButton(page).boundingBox(), help.boundingBox(), page.locator(".topbar").boundingBox()]);
  const mid = (x) => x.y + x.height / 2;
  expect(h.x).toBeGreaterThan(b.x + b.width - 1); // to the right of Backup & Restore
  expect(h.x - (b.x + b.width)).toBeLessThan(20); // right beside it
  expect(Math.abs(mid(h) - mid(b))).toBeLessThan(3); // on the same line
  expect(h.x + h.width).toBeLessThanOrEqual(bar.x + bar.width);
  expect(h.width).toBeGreaterThanOrEqual(32);

  // the icon is in the middle of its button (not pushed against an edge)
  const icon = await help.locator("svg").boundingBox();
  expect(Math.abs((icon.x + icon.width / 2) - (h.x + h.width / 2)), "icon centred horizontally").toBeLessThanOrEqual(1.5);
  expect(Math.abs((icon.y + icon.height / 2) - (h.y + h.height / 2)), "icon centred vertically").toBeLessThanOrEqual(1.5);

  // the popup stays focused on saving and training
  await expect(extPage.getByRole("button", { name: /help|about/i })).toHaveCount(0);
  await expect(extPage.getByRole("link", { name: /privacy|report an issue|contact/i })).toHaveCount(0);
});

test("Help & About lists documentation, issues, contact and privacy, each with its icon and a link to where it goes", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  await expect(helpDialog(page)).toBeHidden();
  await helpButton(page).click();
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h2")).toHaveText("Help & About");
  await expect(dialog).toContainText("Information, support and resources for Lichess Woodpecker.");

  // the logo on its light tile, loaded
  const logo = dialog.locator(".about-logo img");
  await expect(logo).toBeVisible();
  expect(await logo.getAttribute("src")).toMatch(/icons\/logo\.svg$/);
  expect(await logo.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(await dialog.locator(".about-logo").evaluate((el) => Math.min(...getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number)))).toBeGreaterThan(200);

  const items = dialog.locator(".help-item");
  await expect(items).toHaveCount(HELP_ITEMS.length);
  for (const [i, [title, description, href]] of HELP_ITEMS.entries()) {
    const item = items.nth(i);
    await expect(item.locator(".help-title")).toHaveText(title);
    await expect(item.locator(".help-desc")).toHaveText(description);
    await expect(item).toHaveAttribute("href", href);
    await expect(item.locator(".help-icon svg"), `${title} has its icon`).toBeVisible();
    await expect(item.locator(".help-ext svg"), `${title} shows that it leaves the page`).toBeVisible();
    await expect(item).toHaveAccessibleName(new RegExp(title.replace(/[&]/g, "\\$&")));
    if (href.startsWith("https:")) {
      await expect(item).toHaveAttribute("target", "_blank"); // its own tab: this page stays as it is
      expect(await item.getAttribute("rel")).toMatch(/noopener/);
    } else {
      expect(await item.getAttribute("target")).toBeNull(); // mailto opens the mail app, not an empty tab
    }
  }
});

test("each web link in Help & About opens its page in a new tab", async ({ context, extensionUrl }) => {
  await context.route("https://github.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>github</title>" }));
  const page = await optionsPage({ context, extensionUrl });
  await helpButton(page).click();
  for (const [title, , href] of HELP_ITEMS.filter(([, , h]) => h.startsWith("https:"))) {
    const [opened] = await Promise.all([context.waitForEvent("page"), helpDialog(page).locator(".help-item", { hasText: title }).click()]);
    await opened.waitForLoadState();
    expect(opened.url().replace(/#.*$/, ""), title).toBe(href.replace(/#.*$/, ""));
    await opened.close();
    await expect(helpDialog(page)).toBeVisible(); // this page and its dialog are untouched
  }
});

test("Help & About shows the version of the installed extension, read from its manifest", async ({ context, extensionUrl }) => {
  const manifest = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "manifest.json"), "utf8"));
  const page = await optionsPage({ context, extensionUrl });
  await helpButton(page).click();
  const foot = helpDialog(page).locator(".about-foot");
  await expect(foot).toContainText("Lichess Woodpecker");
  await expect(foot).toContainText(`Version ${manifest.version}`);
  // and the footer of the page, as before
  await expect(page.locator("#version")).toHaveText(`v${manifest.version}`);
});

test("Help & About closes with Escape, the backdrop or ✕, and gives focus back", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  const dialog = helpDialog(page);
  await helpButton(page).click();
  expect(await dialog.evaluate((el) => el.contains(document.activeElement)), "focus moves into the dialog").toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(helpButton(page)).toBeFocused();

  await helpButton(page).click();
  await page.locator("#help-overlay").click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeHidden();

  await helpButton(page).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(helpButton(page)).toBeFocused();
});

test("the Help & About text is readable on its surfaces", async ({ context, extensionUrl }) => {
  const page = await optionsPage({ context, extensionUrl });
  await helpButton(page).click();
  const low = [];
  for (const [what, selector] of [["title", "#help-overlay h2"], ["subtitle", ".about-subtitle"], ["item title", ".help-title"], ["item description", ".help-desc"], ["icon", ".help-icon"], ["version", ".about-foot"]]) {
    const { bg, color } = await paint(page.locator(selector).first());
    const c = contrast(color, bg);
    if (c < 4.5) low.push(`${what}: ${c.toFixed(2)}`);
  }
  expect(low).toEqual([]);
});

// ---- Following changes made elsewhere, without a reload ----

const isOpen = (page, name) => card(page, name).evaluate((el) => !el.classList.contains("collapsed"));

test("a puzzle saved from the popup, or any other change made elsewhere, shows on the open settings page by itself", async ({ context, extensionUrl, seedStorage, send }) => {
  await seedStorage(notes({ A: ["p1111"] }));
  const page = await optionsPage({ context, extensionUrl });
  const cats = page.locator("#stat-categories"), puzzles = page.locator("#stat-puzzles");
  await expect(cats).toHaveText("1");
  await expect(puzzles).toHaveText("1");

  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "p2222" }); // what the popup's Save does
  await expect(card(page, "A").locator(".count")).toHaveText("2 puzzles");
  await expect(puzzles).toHaveText("2");

  await send({ type: "CREATE_CATEGORY", name: "B" });
  await expect(page.locator(".category-card")).toHaveCount(2);
  await expect(cats).toHaveText("2");

  await send({ type: "RENAME_CATEGORY", oldName: "B", newName: "Bishops" });
  await expect(card(page, "Bishops")).toHaveCount(1);
  await expect(card(page, "B")).toHaveCount(0);

  await send({ type: "REMOVE_PUZZLE", category: "A", puzzleId: "p1111" });
  await expect(card(page, "A").locator(".count")).toHaveText("1 puzzle");
  await expect(puzzles).toHaveText("1");

  await send({ type: "DELETE_CATEGORY", name: "Bishops" });
  await expect(page.locator(".category-card")).toHaveCount(1);
  await expect(cats).toHaveText("1");
});

test("the Chrome polyfill exposes the storage change event that the live sync depends on", async ({ context, extensionUrl }) => {
  // Current Chromium defines `browser` itself, so the polyfill is skipped there; older Chrome relies on it. Run it as that
  // older Chrome would see it: with no `browser` defined.
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "browser-polyfill.js"), "utf8");
  const page = await optionsPage({ context, extensionUrl });
  const kinds = await page.evaluate(`(() => {
    const saved = globalThis.browser;
    globalThis.browser = undefined;
    try {
      ${source}
      return { addListener: typeof globalThis.browser.storage.onChanged.addListener, get: typeof globalThis.browser.storage.local.get };
    } finally { globalThis.browser = saved; }
  })()`);
  expect(kinds).toEqual({ addListener: "function", get: "function" });
});

test("clicking Save in the real popup updates the settings page open in another tab", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ Pins: ["old11"], Forks: [] }));
  const page = await optionsPage({ context, extensionUrl });
  await expect(page.locator("#stat-puzzles")).toHaveText("1");

  await extPage.reload(); // the popup, which loads what is stored when it opens
  await extPage.evaluate(() => { currentPuzzleId = "7BpCV"; renderAll(); });
  await extPage.locator('.category-row[data-cat="Forks"] .btn-save').click();
  await expect(extPage.locator('.category-row[data-cat="Forks"] .btn-save')).toContainText("Saved");

  await page.bringToFront(); // the user switches to the settings tab: it is already up to date
  await expect(card(page, "Forks").locator(".count")).toHaveText("1 puzzle");
  await expect(page.locator("#stat-puzzles")).toHaveText("2");

  await extPage.bringToFront(); // and taking it back out of the popup is followed too
  await extPage.locator('.category-row[data-cat="Forks"] .btn-save').click();
  await page.bringToFront();
  await expect(card(page, "Forks").locator(".count")).toHaveText("0 puzzles");
  await expect(page.locator("#stat-puzzles")).toHaveText("1");
});

test("a sync keeps your place: the category you opened stays open, and the search and an open dialog are left alone", async ({ context, extensionUrl, seedStorage, send }) => {
  await seedStorage(notes({ A: ["p1111"], B: ["p9999"] }));
  const page = await optionsPage({ context, extensionUrl });

  await card(page, "A").locator(".category-card-header").click(); // open A
  expect(await isOpen(page, "A")).toBe(true);
  expect(await isOpen(page, "B")).toBe(false);

  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "p2222" });
  await expect(card(page, "A").locator(".puzzle-chip")).toHaveCount(2); // the new puzzle is there...
  expect(await isOpen(page, "A")).toBe(true); // ...and A is still open, B still closed
  expect(await isOpen(page, "B")).toBe(false);
  await expect(card(page, "A").locator(".puzzle-chip", { hasText: "p2222" })).toBeVisible();

  // your own action no longer folds the category shut either
  await card(page, "A").locator(".puzzle-chip", { hasText: "p1111" }).locator(".btn-remove").click();
  await expect(card(page, "A").locator(".puzzle-chip")).toHaveCount(1);
  expect(await isOpen(page, "A")).toBe(true);

  // a search stays applied to what arrives
  await page.locator("#search-input").fill("p3");
  await expect(page.locator(".category-card")).toHaveCount(0);
  await send({ type: "ADD_PUZZLE", category: "B", puzzleId: "p3333" });
  await expect(page.locator(".category-card")).toHaveCount(1);
  await expect(card(page, "B")).toHaveCount(1);
  await expect(page.locator("#search-input")).toHaveValue("p3");
  await page.locator("#search-input").fill("");

  // a dialog you are typing in is not closed or cleared
  await page.getByRole("button", { name: "+ New Category" }).click();
  await page.locator("#modal-input").fill("Draft");
  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "p4444" });
  await expect(card(page, "A").locator(".count")).toHaveText("2 puzzles");
  await expect(page.locator("#modal-overlay")).toBeVisible();
  await expect(page.locator("#modal-input")).toHaveValue("Draft");
});

test("a finished training cycle shows in Statistics by itself, and keeps what you had loaded", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ A: ["p1111"] }, cycles(12)));
  const page = await optionsPage({ context, extensionUrl });
  await tab(page, "Statistics").click();
  const rows = page.locator("#stats-tbody tr");
  await expect(rows).toHaveCount(10);
  await page.getByRole("button", { name: /Load more/ }).click();
  await expect(rows).toHaveCount(12);

  // the overlay writes a new record when a cycle ends: it is the newest, so it goes on top
  await seedStorage(notes({ A: ["p1111"] }, [...cycles(12), { ...cycle(99), category: "Just finished", completedAt: Date.now() }]));
  await expect(rows).toHaveCount(13); // not folded back to ten
  await expect(rows.first().locator(".category-name")).toHaveText("Just finished");
  await expect(page.locator("#stats-count")).toHaveText("Showing 13 of 13");
});

test("a change to something the list does not show leaves the list untouched, and opened categories stay open", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ A: ["p1111"] }, cycles(2)));
  const page = await optionsPage({ context, extensionUrl });
  await card(page, "A").locator(".category-card-header").click();
  await card(page, "A").evaluate((el) => { el.dataset.marker = "same node"; }); // a tag on the very element on screen

  await seedStorage(notes({ A: ["p1111"] }, cycles(5))); // only the statistics changed
  await expect(page.locator("#stats-tbody tr")).toHaveCount(5); // the sync has happened
  await expect(card(page, "A")).toHaveAttribute("data-marker", "same node"); // and it did not rebuild the list
  expect(await isOpen(page, "A")).toBe(true);
});

// ---- Stat cards, and the readability of the page's colours ----

const card = (page, name) => page.locator(".category-card").filter({ has: page.locator("h3", { hasText: new RegExp(`^${name}$`) }) });

test("two stat cards show how many categories and how many different puzzles, side by side above the search", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ A: ["p1111", "p2222"], B: ["p2222", "p3333"], C: [] }));
  const page = await optionsPage({ context, extensionUrl });
  const cats = page.locator("#stat-categories"), puzzles = page.locator("#stat-puzzles");
  await expect(page.locator(".stat-card")).toHaveCount(2);
  await expect(cats).toHaveText("3");
  await expect(puzzles).toHaveText("3"); // p2222 is in two categories but is one puzzle
  await expect(page.locator("#stat-categories-label")).toHaveText("Categories");
  await expect(page.locator("#stat-puzzles-label")).toHaveText("Puzzles");
  await expect(page.locator(".stat-card svg").first()).toBeVisible(); // each has its icon

  const [first, second] = await Promise.all(["#stat-categories", "#stat-puzzles"].map((sel) => page.locator(".stat-card").filter({ has: page.locator(sel) }).boundingBox()));
  const [tabs, search] = await Promise.all([page.locator(".tabs").boundingBox(), page.locator("#search-input").boundingBox()]);
  expect(Math.abs(first.y - second.y)).toBeLessThan(3); // side by side
  expect(second.x).toBeGreaterThan(first.x + first.width - 1);
  expect(first.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1); // under the tabs
  expect(first.y + first.height).toBeLessThanOrEqual(search.y); // and above the search
  expect(first.height).toBeLessThanOrEqual(76); // cards, but not bulky ones

  await tab(page, "Statistics").click(); // they belong to the Categories tab
  await expect(page.locator(".stat-card").first()).toBeHidden();
});

test("the stat cards follow every change, and a search never moves them", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ A: ["p1111", "p2222"], B: ["p2222", "p3333"], C: [] }));
  const page = await optionsPage({ context, extensionUrl });
  const cats = page.locator("#stat-categories"), puzzles = page.locator("#stat-puzzles");

  await page.getByRole("button", { name: "+ New Category" }).click();
  await page.locator("#modal-input").fill("D");
  await page.locator("#modal-confirm").click();
  await expect(cats).toHaveText("4");
  await expect(puzzles).toHaveText("3");

  await card(page, "A").locator(".category-card-header").click(); // expand A and take p2222 out of it: B still has it
  await card(page, "A").locator(".puzzle-chip", { hasText: "p2222" }).locator(".btn-remove").click();
  await expect(card(page, "A").locator(".puzzle-chip")).toHaveCount(1);
  await expect(puzzles).toHaveText("3");
  await card(page, "B").locator(".category-card-header").click(); // and p3333 out of B: now it is gone for good
  await card(page, "B").locator(".puzzle-chip", { hasText: "p3333" }).locator(".btn-remove").click();
  await expect(puzzles).toHaveText("2");

  await page.locator("#search-input").fill("zzz"); // no search changes the totals
  await expect(page.locator(".category-card")).toHaveCount(0);
  await expect(cats).toHaveText("4");
  await expect(puzzles).toHaveText("2");
  await page.locator("#search-input").fill("");

  await deleteCategory(card(page, "A"));
  await expect(cats).toHaveText("3");
  await expect(puzzles).toHaveText("1"); // A held the only copy of p1111, so it goes with the category; p2222 stays in B
});

// Deleting a category is two clicks on its bin, with no dialog: the first turns it red, the second deletes. A short pause
// between them stands in for a person seeing the red.
const bin = (cardLocator) => cardLocator.locator(".btn-delete-cat");
const colourOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number));
const isRedish = ([r, g, b]) => r > 200 && g < 135 && b < 135;
async function deleteCategory(cardLocator) {
  await bin(cardLocator).click();
  await expect(bin(cardLocator)).toHaveClass(/armed/);
  await cardLocator.page().waitForTimeout(450);
  await bin(cardLocator).click();
}

test("deleting a category: the first click turns the bin red, the second deletes it, and there is no dialog", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await seedStorage(notes({ A: ["p1111", "p2222"], B: ["p3333"] }));
  const page = await optionsPage({ context, extensionUrl });
  const a = card(page, "A");
  expect(isRedish(await colourOf(bin(a))), "the bin is not red until it is clicked").toBe(false);
  await expect(page.locator("#delete-overlay"), "the old confirmation dialog is gone").toHaveCount(0);

  await bin(a).click();
  await expect(bin(a)).toHaveClass(/armed/);
  await expect.poll(async () => isRedish(await colourOf(bin(a))), { message: "the armed bin is red" }).toBe(true);
  await expect(bin(a)).toHaveAttribute("title", 'Click again to delete "A"');
  await expect(bin(a)).toHaveAccessibleName('Click again to delete "A"');
  await expect(page.locator("#sr-status"), "screen readers are told").toHaveText('Click again to delete "A"');
  await expect(page.locator(".modal-overlay:not(.hidden)"), "nothing opened").toHaveCount(0);
  await expect(a).toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories), "one click deletes nothing").toEqual(["A", "B"]);
  const border = await bin(a).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(border, "a red-tinted background, not just a red icon").not.toBe("rgba(0, 0, 0, 0)");

  await page.waitForTimeout(450);
  await bin(a).click();
  await expect(page.locator(".category-card")).toHaveCount(1);
  await expect(page.locator("#toast")).toHaveText('Deleted "A"');
  expect(Object.keys((await getStorage("lichessNotes")).categories), "the second click deleted A and only A").toEqual(["B"]);
});

test("an armed bin goes back to normal: click elsewhere, Escape, arming another bin, tabbing away, or a few seconds; none deletes", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await seedStorage(notes({ A: ["p1111"], B: ["p3333"] }));
  const page = await optionsPage({ context, extensionUrl });
  const a = card(page, "A"), b = card(page, "B");
  // checked right now, never patiently: the bin also disarms itself after a few seconds, which would rescue a missing rule
  const calm = async (cardLocator, why) => {
    expect(await bin(cardLocator).evaluate((el) => el.classList.contains("armed")), `${why}: disarmed`).toBe(false);
    expect(await bin(cardLocator).getAttribute("title"), `${why}: title`).toBe("Delete category");
    await expect.poll(async () => isRedish(await colourOf(bin(cardLocator))), { timeout: 1000, message: `${why}: no longer red` }).toBe(false); // 1s covers the colour's fade, far under the 4s timer
  };
  const stillThere = async (why) => expect(Object.keys((await getStorage("lichessNotes")).categories), why).toEqual(["A", "B"]);

  await bin(a).click(); await expect(bin(a)).toHaveClass(/armed/);
  await page.locator("h1").click(); // somewhere else
  await calm(a, "clicking elsewhere"); await expect(page.locator("#sr-status")).toHaveText("");

  await bin(a).click(); await expect(bin(a)).toHaveClass(/armed/);
  await page.keyboard.press("Escape");
  await calm(a, "Escape");

  await bin(a).click(); await expect(bin(a)).toHaveClass(/armed/);
  await bin(b).click(); // another bin: only one is ever armed
  await expect(bin(b)).toHaveClass(/armed/);
  await calm(a, "arming another bin");
  await page.locator("h1").click();
  await calm(b, "clicking elsewhere again");

  // In browsers where a click does not focus a button (Safari, Firefox on a Mac) focus never leaves it, so the rules above
  // cannot lean on focus: arm with clicks that do not move focus, which leaves only the page-level rules.
  await bin(a).evaluate((el) => el.click());
  await page.locator("h1").click();
  await calm(a, "clicking elsewhere, without focus to lose");
  await bin(a).evaluate((el) => el.click());
  await bin(b).evaluate((el) => el.click());
  await calm(a, "arming another bin, without focus to lose");
  expect(await bin(b).evaluate((el) => el.classList.contains("armed")), "the other one is armed").toBe(true);
  await page.locator("h1").click();
  await calm(b, "and clicking elsewhere again");

  await bin(a).focus(); await page.keyboard.press("Enter"); // keyboard works too
  await expect(bin(a)).toHaveClass(/armed/);
  await page.keyboard.press("Tab");
  await calm(a, "tabbing away");

  await bin(b).click(); await expect(bin(b)).toHaveClass(/armed/);
  await page.waitForTimeout(4400);
  await calm(b, "waiting a few seconds");

  await stillThere("nothing above deleted anything");
  await bin(b).click(); await expect(bin(b)).toHaveClass(/armed/); // and after any of that, it takes two clicks again
  await stillThere("a fresh click only arms");
});

test("a reflexive double-click on the bin does not delete: it only arms, and a later click deletes", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await seedStorage(notes({ A: ["p1111"], B: ["p3333"] }));
  const page = await optionsPage({ context, extensionUrl });
  await bin(card(page, "A")).dblclick();
  await expect(bin(card(page, "A"))).toHaveClass(/armed/);
  expect(Object.keys((await getStorage("lichessNotes")).categories), "a double-click deletes nothing").toEqual(["A", "B"]);
  await page.waitForTimeout(450);
  await bin(card(page, "A")).click();
  await expect(page.locator(".category-card")).toHaveCount(1);
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["B"]);
});

test("the stat cards say 1 Category and 1 Puzzle in the singular, and 0 when there is nothing", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ Only: ["p1111"] }));
  let page = await optionsPage({ context, extensionUrl });
  await expect(page.locator("#stat-categories-label")).toHaveText("Category");
  await expect(page.locator("#stat-puzzles-label")).toHaveText("Puzzle");
  await page.close();
  await seedStorage(notes({}));
  page = await optionsPage({ context, extensionUrl });
  await expect(page.locator("#stat-categories")).toHaveText("0");
  await expect(page.locator("#stat-categories-label")).toHaveText("Categories");
  await expect(page.locator("#stat-puzzles")).toHaveText("0");
  await expect(page.locator("#stat-puzzles-label")).toHaveText("Puzzles");
});

// WCAG contrast of the text people actually read, measured from the live colours (translucent fills blended over what is
// behind them; gradients contribute their solid base colour)
const luminance = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const paint = (loc) => loc.evaluate((node) => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const layers = [];
  for (let el = node; el; el = el.parentElement) { const c = parse(getComputedStyle(el).backgroundColor); layers.push(c); if (c.a === 1) break; }
  let bg = layers[layers.length - 1];
  for (let i = layers.length - 2; i >= 0; i--) bg = over(layers[i], bg);
  return { bg, color: parse(getComputedStyle(node).color) };
});

test("the page's text is readable on its surfaces, on both tabs and in the dialog", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage(notes({ Pins: ["abc12", "def34"] }, cycles(12)));
  const page = await optionsPage({ context, extensionUrl });
  const low = [];
  const check = async (what, loc, min = 4.5) => {
    const { bg, color } = await paint(loc.first());
    const c = contrast(color, bg);
    if (c < min) low.push(`${what}: ${c.toFixed(2)} (needs ${min})`);
  };

  await check("title", page.locator(".header h1"));
  await check("selected tab", tab(page, "Categories"));
  await check("other tab", tab(page, "Statistics"));
  await check("Backup & Restore", backupButton(page));
  await check("stat number", page.locator("#stat-categories"));
  await check("stat label", page.locator("#stat-categories-label"));
  await check("category name", page.locator(".category-card h3"));
  await check("puzzles pill", page.locator(".category-card .count"));
  await check("New Category", page.getByRole("button", { name: "+ New Category" }));
  await check("version", page.locator(".version-line"));

  await tab(page, "Statistics").click();
  await check("history heading", page.locator(".section-header h2"));
  await check("table heading", page.locator(".stats-table th"));
  await check("table cell", page.locator(".stats-table .category-name"));
  await check("table date", page.locator(".stats-table .completed-date"));
  await check("correct", page.locator(".stats-table .correct"));
  await check("incorrect", page.locator(".stats-table .incorrect"));
  await check("skipped", page.locator(".stats-table .skipped"));
  await check("showing count", page.locator("#stats-count"));
  await check("Load more", page.getByRole("button", { name: /Load more/ }));

  await backupButton(page).click();
  await check("dialog title", page.locator("#backup-title"));
  await check("dialog text", page.locator("#backup-overlay .delete-message"));
  await check("Import JSON", page.getByRole("button", { name: "Import JSON" }));
  expect(low).toEqual([]);
});

// ---- Train from the options page: a lightning button beside Rename and Delete opens the cycle in a new Lichess tab ----

const FAKE_PUZZLE = "<!doctype html><title>puzzle</title><main class='puzzle'><div class='puzzle__moves'></div></main>";

test("the lightning button trains a category in a new tab, which owns the session and shows the overlay with no Resume chip", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await context.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: FAKE_PUZZLE }));
  await seedStorage({ ...notes({ Pins: ["aaaaa", "bbbbb", "ccccc"], Forks: ["ddddd"] }) });
  const page = await optionsPage({ context, extensionUrl });
  const card = page.locator(".category-card", { hasText: "Pins" });
  const train = card.getByRole("button", { name: "Train this category" });
  await expect(train).toBeVisible();
  // between the icons: Train, then Rename, then Delete
  await expect(train).toHaveText("Train");
  const order = await card.locator(".category-card-actions button").evaluateAll((bs) => bs.map((b) => b.className.match(/btn-(train|rename|delete-cat)/)[1]));
  expect(order).toEqual(["train", "rename", "delete-cat"]);

  const opened = context.waitForEvent("page", { predicate: (p) => p !== page });
  await train.click();
  const tab = await opened;
  await expect(tab).toHaveURL(/https:\/\/lichess\.org\/training\/[a-e]{5}/);
  await expect(tab.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible({ timeout: 15_000 });
  await expect(tab.locator("#lpn-woodpecker-overlay .wpk-resume")).toHaveCount(0); // it owns the session from the start

  const s = await getStorage("trainingSession");
  expect(s.category).toBe("Pins");
  expect(Number.isInteger(s.ownerTabId)).toBe(true);
  expect([...s.queue].sort()).toEqual(["aaaaa", "bbbbb", "ccccc"].map((id) => `https://lichess.org/training/${id}`));
  expect(s.totalPuzzles).toBe(3);
});

test("Train on the options page continues the category's paused cycle instead of starting over, and an empty category does not start", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await context.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: FAKE_PUZZLE }));
  const paused = { ownerTabId: null, category: "Pins", queue: ["https://lichess.org/training/aaaaa", "https://lichess.org/training/bbbbb"], currentIndex: 1, totalPuzzles: 2, completedInCycle: 1, correctInCycle: 1, incorrectInCycle: 0, skippedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: Date.now() - 60_000, pausedAt: Date.now() - 30_000 };
  await seedStorage({ ...notes({ Pins: ["aaaaa", "bbbbb"], Empty: [] }), pausedCycles: { Pins: paused } });
  const page = await optionsPage({ context, extensionUrl });

  const opened = context.waitForEvent("page", { predicate: (p) => p !== page });
  const pinsCard = page.locator(".category-card", { hasText: "Pins" });
  await expect(pinsCard.locator(".paused-tag")).toHaveText("⏸ 1/2");
  const resume = pinsCard.getByRole("button", { name: "Resume this category's paused cycle" });
  await expect(resume).toHaveText("Resume");
  await expect(page.locator(".category-card", { hasText: "Empty" }).locator(".paused-tag")).toHaveCount(0); // only the paused category
  await resume.click();
  const tab = await opened;
  await expect(tab).toHaveURL("https://lichess.org/training/bbbbb"); // where it was paused
  const s = await getStorage("trainingSession");
  expect(s.currentIndex).toBe(1);
  expect(s.pausedAt).toBeUndefined();
  expect(await getStorage("pausedCycles")).toBeFalsy(); // taken out of the parked map

  const before = context.pages().length;
  await page.locator(".category-card", { hasText: "Empty" }).getByRole("button", { name: "Train this category" }).click();
  await expect(page.locator(".toast")).toContainText("No puzzles to train");
  expect(context.pages().length).toBe(before); // no tab opened
});

test("a double-click on the lightning button opens one tab, not two", async ({ context, extensionUrl, seedStorage }) => {
  await context.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: FAKE_PUZZLE }));
  await seedStorage({ ...notes({ Pins: ["aaaaa", "bbbbb"] }) });
  const page = await optionsPage({ context, extensionUrl });
  const before = context.pages().length;
  await page.locator(".category-card", { hasText: "Pins" }).getByRole("button", { name: "Train this category" }).dblclick();
  await page.waitForTimeout(1500);
  expect(context.pages().length).toBe(before + 1);
});

test("a cycle paused elsewhere turns Train into Resume with its tag live, and both labels are readable", async ({ context, extensionUrl, seedStorage }) => {
  await seedStorage({ ...notes({ Pins: ["aaaaa", "bbbbb"] }) });
  const page = await optionsPage({ context, extensionUrl });
  const btn = page.locator(".category-card .btn-train");
  await expect(btn).toHaveText("Train");
  await expect(page.locator(".paused-tag")).toHaveCount(0);
  await page.evaluate(() => chrome.storage.local.set({ pausedCycles: { Pins: { category: "Pins", queue: ["https://lichess.org/training/aaaaa", "https://lichess.org/training/bbbbb"], currentIndex: 1, totalPuzzles: 2, completedInCycle: 1, cycleCount: 1, timerStartedAt: 1, pausedAt: 2 } } }));
  await expect(btn).toHaveText("Resume"); // no reload
  await expect(page.locator(".paused-tag")).toHaveText("⏸ 1/2");
  // WCAG contrast of the label on its own button over the card's dark surface (4.5:1)
  const ratio = (a, b) => { const L = (c) => { const [r, g, bl] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }; const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const sel of [".btn-train", ".paused-tag"]) {
    const [fg, bg] = await page.locator(`.category-card ${sel}`).first().evaluate((el) => [getComputedStyle(el).color, getComputedStyle(document.querySelector(".category-card")).backgroundColor].map((c) => c.match(/[\d.]+/g).slice(0, 3).map(Number)));
    expect(ratio(fg, bg), `${sel} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("the accordion slides to the body's real height (no 500px cap, no dead time) and its arrow turns", async ({ context, extensionUrl, seedStorage }) => {
  const many = Array.from({ length: 160 }, (_, i) => `p${String(i).padStart(4, "0")}`.slice(0, 5));
  await seedStorage({ ...notes({ Big: many, Small: ["aaaaa"] }) });
  const page = await optionsPage({ context, extensionUrl });
  const big = page.locator(".category-card", { hasText: "Big" });
  const small = page.locator(".category-card", { hasText: "Small" });
  const h = (loc) => loc.locator(".category-card-collapse").evaluate((e) => e.getBoundingClientRect().height);
  await expect(small.locator(".category-card-collapse")).toHaveJSProperty("clientHeight", 0); // closed: nothing shows
  await small.locator(".category-card-header").click();
  await page.waitForTimeout(450); // longer than the 0.25s slide
  const open = await h(small);
  expect(open).toBeGreaterThan(30);
  expect(open).toBeLessThan(120); // a one-puzzle card is short: it is not stretched to a fixed height

  await big.locator(".category-card-header").click();
  await page.waitForTimeout(450);
  expect(await h(big), "a long list is shown whole, not cut at 500px").toBeGreaterThan(500);

  // half-way through closing the height is between full and zero (the old max-height 500px held a short card full for most of it)
  const arrowOpen = await small.locator(".accordion-arrow").evaluate((e) => getComputedStyle(e).transform);
  await small.locator(".category-card-header").click();
  await page.waitForTimeout(110);
  const mid = await h(small);
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(open - 3);
  await page.waitForTimeout(400);
  expect(await h(small)).toBe(0);
  expect(await small.locator(".accordion-arrow").evaluate((e) => getComputedStyle(e).transform)).not.toBe(arrowOpen); // it turned back
});
