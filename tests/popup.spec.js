const { test, expect } = require("./fixtures");

// The popup page opened as a tab: its toolbar-click puzzle detection cannot run here (activeTab is only granted by a
// real click), so tests set the current puzzle themselves and re-render, exactly as detectCurrentTab would.

const notes = (categories, categoryMeta) => ({
  lichessNotes: { categories, meta: { version: 1, updatedAt: 0, ...(categoryMeta ? { categoryMeta } : {}) } },
});
const many = (n, filled = true) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`Category ${String(i + 1).padStart(3, "0")}`, filled && i % 3 ? ["abc12"] : []]));

async function openPopup({ extPage, seedStorage }, seed, puzzleId) {
  await seedStorage(seed);
  await extPage.reload();
  await expect(extPage.locator("#category-list")).toBeVisible();
  if (puzzleId) await extPage.evaluate((id) => { currentPuzzleId = id; renderAll(); }, puzzleId);
}
const row = (page, name) => page.locator(`.category-row[data-cat="${name}"]`);
const names = (page) => page.locator(".category-row .cat-name").allTextContents();
const dotColor = (page, name) => row(page, name).locator(".cat-dot").evaluate((el) => getComputedStyle(el).backgroundColor);

// Fixture pages for the lichess.org URLs a training session navigates to, so nothing touches the network.
const servePuzzles = (context) =>
  context.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>puzzle</title>" }));

// Starting a session sends the popup's own tab to the puzzle (and the real popup closes itself), so these tests read
// storage through a second extension page, keep the popup tab active, and stop the popup closing the page under test.
async function trainingSetup(context, extPage, extensionUrl) {
  await servePuzzles(context);
  const admin = await context.newPage();
  await admin.goto(extensionUrl("options.html"));
  await extPage.bringToFront();
  await extPage.evaluate(() => { window.close = () => {}; });
  return (key) => admin.evaluate(async (k) => (await browser.storage.local.get(k))[k], key);
}

// Firefox's `chrome.*` is callback-only: with no callback it returns undefined, though `chrome.scripting` exists. The popup
// used to pick `chrome.scripting` whenever it existed and await that undefined, so on Firefox every puzzle page read as
// "No puzzle detected". Chromium cannot show that, so these tests give the popup the same two shapes of browser.
async function detectWith(extPage, shape) {
  return extPage.evaluate(async (shapeName) => {
    const realBrowser = window.browser, realChrome = window.chrome, calls = [];
    const promise = (name) => ({ scripting: { executeScript: async () => { calls.push(name); return [{ result: "abcde" }]; } } });
    const callbackOnly = (name) => ({ scripting: { executeScript: () => { calls.push(name); } } }); // returns undefined, as Firefox's chrome.* does
    if (shapeName === "firefox") { window.browser = promise("browser"); window.chrome = callbackOnly("chrome"); }
    else { window.browser = {}; window.chrome = promise("chrome"); } // Chrome with the polyfill: no browser.scripting, a promise-based chrome.scripting
    currentTabId = 7;
    try { return { id: await extractPuzzleIdFromDOM(), calls }; } finally { window.browser = realBrowser; window.chrome = realChrome; }
  }, shape);
}

test("puzzle detection works on Firefox's shape (a callback-only chrome.* beside a promise-based browser.*)", async ({ extPage }) => {
  const r = await detectWith(extPage, "firefox");
  expect(r.calls, "it asked the promise-based API, not the callback-only one").toEqual(["browser"]);
  expect(r.id).toBe("abcde");
});

test("puzzle detection works on Chrome's shape (the polyfill has no browser.scripting, chrome.scripting returns promises)", async ({ extPage }) => {
  const r = await detectWith(extPage, "chrome");
  expect(r.calls).toEqual(["chrome"]);
  expect(r.id).toBe("abcde");
});

test("with 100 categories the popup stays compact and only the list scrolls", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes(many(100)), "7BpCV");
  const box = (sel) => extPage.locator(sel).boundingBox();
  const container = await box(".popup-container");
  expect(container.height).toBeLessThanOrEqual(480); // the same height for 5 categories or 100
  expect(container.width).toBeCloseTo(380, 0);

  const list = extPage.locator("#category-list");
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(500); // plenty to scroll
  expect(await extPage.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)).toBe(true); // the page itself does not

  for (const sel of [".header", "#search", "#btn-train-all", ".summary"]) { // all still inside the popup frame
    const b = await box(sel);
    expect(b.y).toBeGreaterThanOrEqual(container.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(container.y + container.height + 1);
  }

  const whole = await extPage.evaluate(() => {
    const l = document.querySelector("#category-list").getBoundingClientRect();
    return [...document.querySelectorAll(".category-row")].filter((r) => { const b = r.getBoundingClientRect(); return b.top >= l.top - 1 && b.bottom <= l.bottom + 1; }).length;
  });
  expect(whole).toBeGreaterThanOrEqual(4); // about four categories at once, the fifth peeking in to show there is more
  expect(whole).toBeLessThanOrEqual(5);

  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; }); // the last row is reachable
  await expect(row(extPage, "Category 100")).toBeInViewport();
});

test("the current-puzzle card says only what is true about the puzzle", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: [], B: [], C: [] }));
  const card = extPage.locator("#puzzle-card");
  await expect(card).toHaveClass(/is-unavailable/);
  await expect(card).toContainText("Open Lichess puzzles");
  await expect(extPage.locator("#puzzle-badge")).toBeHidden();

  await extPage.evaluate(() => { currentPuzzleId = "7BpCV"; renderAll(); });
  await expect(extPage.locator("#puzzle-id-display")).toHaveText("7BpCV");
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Not saved");
  await expect(card).not.toHaveClass(/is-saved/);

  await row(extPage, "A").locator(".btn-save").click();
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Saved in 1 category");
  await expect(card).toHaveClass(/is-saved/);
  await row(extPage, "B").locator(".btn-save").click();
  await row(extPage, "C").locator(".btn-save").click();
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Saved in 3 categories");
});

test("Save puts the puzzle in a category in one click, and cannot duplicate or fail silently", async ({ extPage, send, getStorage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: ["old11"], B: [] }), "7BpCV");
  const save = row(extPage, "A").locator(".btn-save");
  await expect(save).toContainText("Save");
  await expect(save).toHaveAccessibleName("Save 7BpCV to A");

  await save.click();
  await expect(save).toContainText("Saved");
  await expect(row(extPage, "A").locator(".cat-count")).toHaveText("2");
  expect((await getStorage("lichessNotes")).categories.A).toEqual(["old11", "7BpCV"]);

  await save.click(); // the saved check is a toggle: clicking it takes the puzzle out again, and Save is back
  await expect(save).toHaveText("Save");
  await expect(save).toHaveAccessibleName("Save 7BpCV to A");
  await expect(row(extPage, "A").locator(".cat-count")).toHaveText("1");
  expect((await getStorage("lichessNotes")).categories.A).toEqual(["old11"]);
  await expect(extPage.locator("#sr-status")).toHaveText("Removed from A");
  await expect(extPage.locator("#toast")).not.toHaveClass(/toast-error/);
  await save.click(); // and back in, once, never twice
  await expect(save).toContainText("Saved");
  expect((await getStorage("lichessNotes")).categories.A).toEqual(["old11", "7BpCV"]);

  await row(extPage, "B").locator(".btn-save").click(); // saving into several categories
  expect((await getStorage("lichessNotes")).categories.B).toEqual(["7BpCV"]);

  await send({ type: "CREATE_CATEGORY", name: "Gone" });
  await extPage.evaluate(() => { loadData().then(renderAll); });
  await expect(row(extPage, "Gone")).toBeVisible();
  await send({ type: "DELETE_CATEGORY", name: "Gone" }); // removed behind the popup's back
  await row(extPage, "Gone").locator(".btn-save").click();
  await expect(extPage.locator("#toast")).toHaveClass(/toast-error/);
  await expect(extPage.locator("#toast")).toContainText("not found");
});

test("the puzzle ID is small and quiet, not the headline of the card", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: [] }), "7BpCV");
  const id = extPage.locator("#puzzle-id-display");
  await expect(id).toHaveText("7BpCV"); // still there for anyone who wants it
  const size = parseFloat(await id.evaluate((el) => getComputedStyle(el).fontSize));
  expect(size).toBeLessThanOrEqual(14);
  const badge = parseFloat(await extPage.locator("#puzzle-badge").evaluate((el) => getComputedStyle(el).fontSize));
  expect(size).toBeLessThanOrEqual(badge + 1); // the saved/not saved status is what matters, so it is not out-shouted
  expect((await extPage.locator("#puzzle-card").boundingBox()).height).toBeLessThanOrEqual(52);
});

test("a summary row replaces the Categories heading: how many categories, and how many different puzzles are saved", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: ["p1111", "p2222"], B: ["p2222", "p3333"], C: [] }), "p4444");
  const cats = extPage.locator("#stat-categories"), puzzles = extPage.locator("#stat-puzzles");
  const summary = extPage.locator(".summary");

  // the old heading and its underline are gone
  await expect(extPage.locator(".section-head")).toHaveCount(0);
  await expect(extPage.getByRole("heading", { name: "Categories" })).toHaveCount(0);
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Categories");
  await expect(summary).toContainText("Puzzles");
  await expect(cats).toHaveText("3");
  await expect(puzzles).toHaveText("3"); // p2222 is in two categories but is one puzzle

  // between the puzzle card and the search box, and slim
  const [card, bar, search] = await Promise.all([extPage.locator("#puzzle-card").boundingBox(), summary.boundingBox(), extPage.locator(".search").boundingBox()]);
  expect(bar.y).toBeGreaterThanOrEqual(card.y + card.height);
  expect(bar.y + bar.height).toBeLessThanOrEqual(search.y);
  expect(bar.height).toBeLessThanOrEqual(30);

  // saving a new puzzle adds one; saving one the library already has adds none; removing counts only when the last copy goes
  await row(extPage, "C").locator(".btn-save").click();
  await expect(puzzles).toHaveText("4");
  await row(extPage, "A").locator(".btn-save").click(); // p4444 again, in a second category
  await expect(puzzles).toHaveText("4");
  await row(extPage, "C").locator(".btn-save").click(); // out of C: still in A
  await expect(puzzles).toHaveText("4");
  await row(extPage, "A").locator(".btn-save").click(); // out of A: gone for good
  await expect(puzzles).toHaveText("3");
  await expect(cats).toHaveText("3"); // none of that changed the categories

  // a new category counts at once; searching does not change either total
  await extPage.locator("#btn-new").click();
  await extPage.locator("#new-name").fill("Endgame");
  await extPage.locator("#new-name").press("Enter");
  await expect(cats).toHaveText("4");
  await extPage.locator("#search").fill("zzz");
  await expect(cats).toHaveText("4");
  await expect(puzzles).toHaveText("3");

  // and a save while a filter is on re-draws the totals without letting the filter shrink them
  await extPage.locator("#search").fill("endgame");
  expect(await names(extPage)).toEqual(["Endgame"]);
  await row(extPage, "Endgame").locator(".btn-save").click();
  await expect(puzzles).toHaveText("4");
  await expect(cats).toHaveText("4");
});

test("the summary says 1 Category and 1 Puzzle in the singular, and 0 when there is nothing", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Only: ["p1111"] }));
  await expect(extPage.locator(".summary")).toHaveText(/1\s*Category\s*1\s*Puzzle\b/);
  await openPopup({ extPage, seedStorage }, notes({}));
  await expect(extPage.locator(".summary")).toHaveText(/0\s*Categories\s*0\s*Puzzles/);
});

test("with no puzzle detected, the card says so and links to Lichess puzzles (the whole card is the target)", async ({ context, extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }));
  const card = extPage.locator("#puzzle-card");
  const link = card.getByRole("link", { name: /Open Lichess puzzles/ });
  await expect(card).toHaveClass(/is-unavailable/);
  await expect(extPage.locator("#puzzle-id-display")).toHaveText("No puzzle detected"); // words, not a dash
  await expect(card.locator(".puzzle-label")).toBeHidden();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://lichess.org/training");
  await expect(link).toHaveAttribute("target", "_blank"); // its own tab: the popup closes, and the current page is left alone
  expect(await link.getAttribute("rel")).toMatch(/noopener/);
  // a standalone link, not one buried in the middle of a sentence
  expect((await extPage.locator("#puzzle-hint").innerText()).trim()).toBe("Open Lichess puzzles");

  // one compact row: the words on the left, the link on the right, in a card well under the full-size one
  const [cardBox, titleBox, linkBox] = await Promise.all([card.boundingBox(), extPage.locator("#puzzle-id-display").boundingBox(), link.boundingBox()]);
  expect(cardBox.height).toBeLessThanOrEqual(40);
  expect(Math.abs((titleBox.y + titleBox.height / 2) - (linkBox.y + linkBox.height / 2))).toBeLessThan(5);
  expect(linkBox.x).toBeGreaterThan(titleBox.x + titleBox.width);

  // readable, and visibly a link
  const paint = await paintOf(link);
  const cardPaint = await paintOf(card);
  expect(ratio(paint.color, cardPaint.bg)).toBeGreaterThanOrEqual(4.5);
  expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
  const title = await paintOf(extPage.locator("#puzzle-id-display"));
  expect(ratio(title.color, cardPaint.bg)).toBeGreaterThanOrEqual(4.5);

  // keyboard: focusable with a visible ring
  await link.focus();
  await extPage.keyboard.press("Shift"); // keyboard modality, so :focus-visible applies
  await link.focus();
  expect(await link.evaluate((el) => { const st = getComputedStyle(el); return st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0; })).toBe(true);

  // clicking anywhere on the card (not just the words) opens Lichess puzzles in a new tab
  await context.route("https://lichess.org/training", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>puzzles</title>" }));
  const [opened] = await Promise.all([context.waitForEvent("page"), card.click({ position: { x: 14, y: 8 } })]);
  await opened.waitForLoadState();
  expect(opened.url()).toBe("https://lichess.org/training");
});

// Chrome closes its popup when a new tab takes focus; Firefox leaves it open, and the open popup cannot read the new tab (its
// activeTab access is for the tab it was opened on), so it kept saying "No puzzle detected" over a Lichess puzzle. Following the
// link therefore closes the popup itself, and opening it again on the puzzle tab detects the puzzle.
test("following the Lichess link closes the popup, so it never sits open saying 'No puzzle detected' over a puzzle", async ({ context, extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }));
  await extPage.evaluate(() => { window.__closes = 0; window.close = () => { window.__closes++; }; });
  await context.route("https://lichess.org/training", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>puzzles</title>" }));

  const before = context.pages().length;
  const [opened] = await Promise.all([context.waitForEvent("page"), extPage.locator("#puzzle-card").click({ position: { x: 14, y: 8 } })]);
  await opened.waitForLoadState();
  expect(opened.url(), "the puzzles opened in a tab").toBe("https://lichess.org/training");
  await expect.poll(() => extPage.evaluate(() => window.__closes), { message: "and the popup closed itself" }).toBe(1);
  await extPage.waitForTimeout(800); // long enough for a second tab, from the link's own default action, to show up if it is going to
  expect(context.pages().length, "exactly one new tab").toBe(before + 1);
});

test("a modified click on the Lichess link is left to the browser: the popup stays, nothing is opened twice", async ({ context, extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }));
  await extPage.evaluate(() => { window.__closes = 0; window.close = () => { window.__closes++; }; });
  await context.route("https://lichess.org/training", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>puzzles</title>" }));
  const link = extPage.locator("#puzzle-card").getByRole("link", { name: /Open Lichess puzzles/ });
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    const r = await link.evaluate((el, k) => { const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, [k]: true }); el.dispatchEvent(ev); return { prevented: ev.defaultPrevented, closes: window.__closes }; }, key);
    expect(r.prevented, `${key}: the browser's own handling is not cancelled`).toBe(false);
    expect(r.closes, `${key}: the popup stays open`).toBe(0);
  }
});

test("once a puzzle is detected the link goes away and the card becomes the full-size current-puzzle card", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }));
  const card = extPage.locator("#puzzle-card");
  const link = card.getByRole("link", { name: /Open Lichess puzzles/ });
  const none = await card.boundingBox();
  await expect(link).toBeVisible();

  await extPage.evaluate(() => { currentPuzzleId = "7BpCV"; renderAll(); }); // the puzzle is detected a moment after the popup opens
  await expect(extPage.locator("#puzzle-id-display")).toHaveText("7BpCV");
  await expect(link).toBeHidden();
  await expect(card.locator(".puzzle-label")).toBeVisible();
  const some = await card.boundingBox();
  expect(none.height).toBeLessThan(some.height - 6); // the empty card is the quieter, smaller one of the two
  expect(Math.abs(some.y - none.y)).toBeLessThanOrEqual(1); // and the card still starts in the same place
});

test("without a puzzle on the page, categories still list and Save explains why it is off", async ({ extPage, getStorage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }));
  await expect(row(extPage, "Pins")).toBeVisible();
  const save = row(extPage, "Pins").locator(".btn-save");
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toHaveAttribute("title", /Open a Lichess puzzle/);
  await save.click({ force: true }); // it is aria-disabled, so Playwright would otherwise wait for it
  expect((await getStorage("lichessNotes")).categories.Pins).toEqual(["abc12"]); // nothing was saved
});

test("search filters the category list as you type, case-insensitively, and the totals count every category", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes(Object.fromEntries(["C1", "C2", "C3", "C4", "C5", "C6", "C7"].map((n) => [n, []]))));
  await expect(extPage.locator("#stat-categories")).toHaveText("7");
  expect(await names(extPage)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7"]);

  await extPage.locator("#search").fill("c7");
  expect(await names(extPage)).toEqual(["C7"]);
  await expect(extPage.locator("#stat-categories")).toHaveText("7"); // the count is of all categories, not of the matches

  await extPage.locator("#search").fill("no such thing");
  await expect(extPage.locator("#category-list")).toContainText("No categories match");
  await extPage.locator("#search").fill("");
  expect(await names(extPage)).toHaveLength(7);
});

test("a category can be created in the popup without saving the puzzle into it", async ({ extPage, getStorage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#btn-new").click();
  await expect(extPage.locator("#new-name")).toBeFocused();

  await extPage.locator("#new-name").fill("Endgame");
  await extPage.locator("#new-name").press("Enter");
  await expect(row(extPage, "Endgame")).toBeVisible(); // in the list at once
  await expect(row(extPage, "Endgame").locator(".cat-count")).toHaveText("0");
  await expect(extPage.locator("#new-category")).toBeHidden();
  await expect(extPage.locator(".toolbar:not(#new-category)")).toBeVisible(); // the search bar is back
  const stored = await getStorage("lichessNotes");
  expect(stored.categories.Endgame).toEqual([]); // the puzzle was NOT saved into the new category
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Not saved");
});

// ---- Create a category: the search bar is replaced, in the same place, by [ Category name ] [ Create ] [ x ] ----

const btnNewOf = (page) => page.locator("#btn-new");
const bar = (page) => page.locator("#toolbar");
const form = (page) => page.locator("#new-category");
const box = async (loc) => { const b = await loc.boundingBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };

test("+ New swaps the search bar for the name field, Create and a close button in the same place, without moving anything else", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"], Forks: [] }), "7BpCV");
  const before = { bar: await box(bar(extPage)), rows: [await box(row(extPage, "Pins")), await box(row(extPage, "Forks"))], footer: await box(extPage.locator("#btn-train-all")), popup: await box(extPage.locator(".popup-container")) };
  expect(await extPage.locator("#search").isVisible()).toBe(true);

  await extPage.locator("#btn-new").click();
  await expect(bar(extPage), "the search bar is gone").toBeHidden();
  await expect(form(extPage)).toBeVisible();
  await expect(extPage.locator("#new-name")).toBeFocused();
  const after = { bar: await box(form(extPage)), rows: [await box(row(extPage, "Pins")), await box(row(extPage, "Forks"))], footer: await box(extPage.locator("#btn-train-all")), popup: await box(extPage.locator(".popup-container")) };
  for (const k of ["x", "y", "width", "height"]) expect(Math.abs(after.bar[k] - before.bar[k]), `the bar's ${k}`).toBeLessThanOrEqual(1);
  expect(after.rows, "the list does not move").toEqual(before.rows);
  expect(after.footer, "nor the footer").toEqual(before.footer);
  expect(after.popup.height, "nor does the popup change size").toBe(before.popup.height);
  // three controls on one line, all as tall as the search bar, none past the edge
  const [field, create, close] = [await box(extPage.locator("#new-name")), await box(extPage.locator("#new-create")), await box(extPage.locator("#new-cancel"))];
  expect(Math.abs(create.y - close.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(create.height - before.bar.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(close.height - before.bar.height)).toBeLessThanOrEqual(1);
  expect(close.x + close.width, "inside the bar").toBeLessThanOrEqual(after.bar.x + after.bar.width + 0.5);
  expect(field.width, "the name field takes the room").toBeGreaterThan(160);
  expect(await extPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= document.body.clientWidth), "no sideways overflow").toBe(true);
  await expect(extPage.locator("#new-name")).toHaveAttribute("placeholder", "Category name");
  await expect(extPage.locator("#new-cancel")).toHaveAccessibleName("Cancel");

  await extPage.locator("#new-cancel").click(); // and back
  await expect(bar(extPage)).toBeVisible();
  expect(await box(bar(extPage))).toEqual(before.bar);
  await expect(btnNewOf(extPage)).toBeFocused();
});

test("after creating, focus goes back to + New, and pressing Enter twice quickly makes one category with no false error", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#btn-new").click();
  await extPage.locator("#new-name").fill("Mates");
  await extPage.locator("#new-name").press("Enter");
  await expect(row(extPage, "Mates")).toBeVisible();
  await expect(extPage.locator("#btn-new"), "keyboard users continue from + New").toBeFocused();
  await expect(extPage.locator("#toast")).not.toHaveClass(/toast-error/);
  expect(Object.keys((await getStorage("lichessNotes")).categories).sort()).toEqual(["Mates", "Pins"]);
  // the same with the field still focused: two submits in one go send ONE request (the second would be refused as a
  // duplicate, and its error toast is soon covered by the first one's "Created", so count the messages instead)
  await extPage.locator("#btn-new").click();
  await extPage.locator("#new-name").fill("Forks");
  await extPage.evaluate(() => {
    window.__creates = 0;
    const real = browser.runtime.sendMessage.bind(browser.runtime);
    browser.runtime.sendMessage = (message, ...rest) => { if (message && message.type === "CREATE_CATEGORY") window.__creates++; return real(message, ...rest); };
  });
  await extPage.locator("#new-name").evaluate((el) => { const f = el.form; f.requestSubmit(); f.requestSubmit(); });
  await expect(row(extPage, "Forks")).toBeVisible();
  await extPage.waitForTimeout(300);
  expect(await extPage.evaluate(() => window.__creates), "one create request, not two").toBe(1);
});

test("Create is off for an empty or duplicate name, says why, and Enter then does nothing; a good name turns it on", async ({ extPage, getStorage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#btn-new").click();
  const create = extPage.locator("#new-create");
  const name = extPage.locator("#new-name");
  await expect(create, "empty").toBeDisabled();
  await name.press("Enter");
  await expect(form(extPage), "Enter on an empty name does nothing").toBeVisible();
  await name.fill("   ");
  await expect(create, "only spaces").toBeDisabled();

  await name.fill("pins"); // the same as Pins, ignoring case
  await expect(create, "duplicate").toBeDisabled();
  await expect(extPage.locator("#new-hint")).toBeVisible();
  await expect(extPage.locator("#new-hint")).toContainText(/already exists/i);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(extPage.locator("#new-error"), "read out for screen readers").toContainText(/already exists/i);
  // the field turns red, and the hint is readable on it (WCAG 4.5:1)
  const red = await extPage.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const hint = document.querySelector("#new-hint"); const field = document.querySelector(".new-field");
    const [x, y] = [lum(getComputedStyle(hint).color), lum(getComputedStyle(field).backgroundColor)].sort((a, b) => b - a);
    return { border: getComputedStyle(field).borderTopColor, ratio: (x + 0.05) / (y + 0.05) };
  });
  expect(red.border, "a red border").toMatch(/^rgb\(2[0-9]{2}, \d{2,3}, \d{2,3}\)$/);
  expect(red.ratio, "the hint is readable").toBeGreaterThanOrEqual(4.5);
  // the hint sits inside the field: Create and the close button stay inside the bar, and nothing overflows
  const inside = await extPage.evaluate(() => { const f = document.querySelector("#new-category").getBoundingClientRect(); const c = document.querySelector("#new-cancel").getBoundingClientRect(); return { closeRight: c.right, barRight: f.right, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
  expect(inside.closeRight, "the close button is inside the bar").toBeLessThanOrEqual(inside.barRight + 0.5);
  expect(inside.overflow, "no sideways overflow").toBeLessThanOrEqual(0);
  await name.press("Enter");
  await expect(form(extPage), "Enter on a duplicate does nothing").toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Pins"]);

  await name.fill("Pins 2");
  await expect(create).toBeEnabled();
  await expect(extPage.locator("#new-hint")).toBeHidden();
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  const b = await extPage.locator("#new-create").evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(b), "it looks enabled").toBeGreaterThan(0.9);
  await create.click();
  await expect(row(extPage, "Pins 2")).toBeVisible();
});

test("Escape or the close button cancels from anywhere in the bar, keeps what was typed in the search box, and puts focus back on + New", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }), "7BpCV");
  await extPage.locator("#search").fill("fo");
  expect(await names(extPage)).toEqual(["Forks"]);
  for (const how of ["input", "create", "x"]) {
    await extPage.locator("#btn-new").click();
    await extPage.locator("#new-name").fill("Draft");
    if (how === "input") await extPage.locator("#new-name").press("Escape");
    if (how === "create") { await extPage.locator("#new-create").focus(); await extPage.keyboard.press("Escape"); }
    if (how === "x") await extPage.locator("#new-cancel").click();
    await expect(form(extPage), how).toBeHidden();
    await expect(bar(extPage), how).toBeVisible();
    await expect(extPage.locator("#search"), "what was typed in the search box is still there").toHaveValue("fo");
    expect(await names(extPage)).toEqual(["Forks"]);
    await expect(extPage.locator("#btn-new"), how).toBeFocused();
  }
  await extPage.locator("#btn-new").click();
  await expect(extPage.locator("#new-name"), "a new try starts empty").toHaveValue("");
});

test("creating clears the search so the new category is in view, restores the search bar, and a name the background refuses keeps the bar open with a message", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#search").fill("pin");
  await extPage.locator("#btn-new").click();
  await extPage.locator("#new-name").fill("All Categories"); // reserved: the background refuses it
  await extPage.locator("#new-create").click();
  await expect(extPage.locator("#toast")).toHaveText('"All Categories" is reserved and cannot be a category name.');
  await expect(form(extPage), "stays open for another try").toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Pins"]);

  await extPage.locator("#new-name").fill("Mates");
  await extPage.locator("#new-name").press("Enter");
  await expect(bar(extPage)).toBeVisible();
  await expect(extPage.locator("#search")).toHaveValue("");
  await expect(row(extPage, "Mates")).toBeVisible();
});

test("the name field has one subtle blue focus ring, like the search box, and no second outline", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#btn-new").click();
  const ring = await extPage.locator(".new-field").evaluate((el) => { const c = getComputedStyle(el); const i = getComputedStyle(el.querySelector("input")); return { border: c.borderTopColor, shadow: c.boxShadow, outline: i.outlineStyle, inputBorder: i.borderTopStyle }; });
  const searchRing = await extPage.locator("#search").evaluate((el) => getComputedStyle(el.closest(".search")).borderTopColor);
  expect(ring.outline, "no native outline on the input").toBe("none");
  expect(ring.inputBorder, "no border of its own inside the field").toBe("none");
  await extPage.locator("#btn-new").evaluate(() => {}); // (the field is focused: its ring shows)
  const blue = (c) => { const m = c.match(/\d+/g).map(Number); return m[2] > m[0] + 40; };
  expect(blue(ring.border), `a blue border (${ring.border})`).toBe(true);
  expect(searchRing, "the search box's own border is neutral until focused").not.toBe(ring.border);
});
test("category colours are distinct and stay put through reload, save and rename; popup and background agree on the fallback", async ({ extPage, send, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({}));
  const created = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (const n of created) await send({ type: "CREATE_CATEGORY", name: n });
  await extPage.reload();
  const before = {};
  for (const n of created) before[n] = await dotColor(extPage, n);
  expect(new Set(Object.values(before)).size).toBe(8);

  await extPage.evaluate(() => { currentPuzzleId = "7BpCV"; renderAll(); });
  await row(extPage, "D").locator(".btn-save").click(); // a save does not change a colour
  expect(await dotColor(extPage, "D")).toBe(before.D);
  await send({ type: "RENAME_CATEGORY", oldName: "D", newName: "Delta" }); // a rename does not either
  await extPage.reload();
  expect(await dotColor(extPage, "Delta")).toBe(before.D);
  expect(await dotColor(extPage, "A")).toBe(before.A);

  // categories saved before colours existed: the popup shows the hash colour, and the background keeps it on rename
  const legacy = ["Pin", "Fork", "Mates in 2", "Ünï"];
  await openPopup({ extPage, seedStorage }, notes(Object.fromEntries(legacy.map((n) => [n, []]))));
  for (const n of legacy) {
    const shown = await dotColor(extPage, n);
    const index = await extPage.evaluate((name) => hashColor(name), n);
    await send({ type: "RENAME_CATEGORY", oldName: n, newName: `${n} renamed` });
    await extPage.reload();
    expect(await dotColor(extPage, `${n} renamed`), `${n}: colour after rename`).toBe(shown);
    const stored = await extPage.evaluate(async (name) => (await browser.storage.local.get("lichessNotes")).lichessNotes.meta.categoryMeta[name].color, `${n} renamed`);
    expect(stored, `${n}: the background and popup hash agree`).toBe(index);
  }
});

test("hovering or focusing Train swaps the emphasis without moving what is under the pointer", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"], Forks: ["abc12", "def34"] }), "7BpCV");
  await extPage.setViewportSize({ width: 420, height: 640 });
  const r = row(extPage, "Pins");
  const group = r.locator(".row-actions");
  const save = r.locator(".btn-save");
  const train = r.locator(".btn-train");
  const sizes = async () => ({ g: await group.boundingBox(), s: await save.boundingBox(), t: await train.boundingBox() });

  const calm = await sizes();
  expect(calm.s.width).toBeGreaterThan(calm.t.width * 1.8); // Save is the wide, primary control
  await expect(save.locator(".ico-bookmark")).toHaveCSS("opacity", "1");

  const pointer = { x: calm.t.x + calm.t.width / 2, y: calm.t.y + calm.t.height / 2 };
  await extPage.mouse.move(pointer.x, pointer.y);
  await expect(group).toHaveClass(/train-hot/);
  await extPage.waitForTimeout(300); // longer than the animation
  const hot = await sizes();
  expect(hot.g.width).toBeCloseTo(calm.g.width, 0); // the group never changes width
  expect(hot.t.width).toBeGreaterThan(hot.s.width * 1.8); // emphasis swapped
  expect(hot.t.x + hot.t.width).toBeCloseTo(calm.t.x + calm.t.width, 0); // anchored to the right edge
  expect(await extPage.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest(".btn-train"), pointer)).toBe(true); // pointer is still on Train
  await expect(train.locator(".train-label")).toBeVisible();
  await expect(save.locator(".ico-plus")).toHaveCSS("opacity", "1"); // compressed Save shows a plus when unsaved
  await expect(train).toHaveAttribute("title", "Train this category");

  await extPage.mouse.move(5, 5);
  await expect(group).not.toHaveClass(/train-hot/);
  await extPage.waitForTimeout(300);
  expect((await sizes()).s.width).toBeCloseTo(calm.s.width, 0);

  // keyboard focus does the same
  await save.focus();
  await extPage.keyboard.press("Tab");
  await expect(train).toBeFocused();
  await expect(group).toHaveClass(/train-hot/);

  // and once saved, the compressed Save shows a check (the pointer moves off it: hovering the check shows the remove icon)
  await extPage.mouse.move(5, 5);
  await save.click();
  await expect(save).toContainText("Saved");
  await extPage.mouse.move(5, 5);
  await train.focus();
  await extPage.keyboard.press("Shift+Tab");
  await extPage.keyboard.press("Tab");
  await expect(group).toHaveClass(/train-hot/);
  await expect(save.locator(".ico-check")).toHaveCSS("opacity", "1");
  await expect(save.locator(".ico-plus")).toHaveCSS("opacity", "0");
});

// Green is for "already saved" only: an available Save is blue, so the two never look alike, and Train stays neutral.
const paintOf = (loc) => loc.evaluate((node) => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const layers = [];
  for (let el = node; el; el = el.parentElement) { const c = parse(getComputedStyle(el).backgroundColor); layers.push(c); if (c.a === 1) break; }
  let bg = layers[layers.length - 1];
  for (let i = layers.length - 2; i >= 0; i--) bg = over(layers[i], bg); // translucent fills, blended over what is behind them
  const st = getComputedStyle(node);
  return { bg, color: parse(st.color), border: over(parse(st.borderTopColor), bg) };
});
const isBlue = ({ r, g, b }) => b >= 110 && b > r * 1.6 && b > g * 1.25; // the action blue; the popup's dark navy neutrals are not bright enough to count
const isGreen = ({ r, g, b }) => g > r + 40 && g > b + 15;
const ratio = (a, b) => {
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const isRed = ({ r, g, b }) => r > 180 && r > g * 1.6 && r > b * 1.6;

test("a saved puzzle shows a bare green check; hovering or focusing it offers to remove, and clicking does", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: ["old11"], B: [] }), "7BpCV");
  const r = row(extPage, "A");
  const save = r.locator(".btn-save");
  await extPage.setViewportSize({ width: 400, height: 520 });
  const unsaved = await save.boundingBox();
  await save.click(); // saved now
  await expect(save).toContainText("Saved");

  // at rest: only the green check, no container, and the tooltip already says what a click does
  await extPage.mouse.move(5, 5);
  await expect(save.locator(".ico-check")).toHaveCSS("opacity", "1");
  await expect(save.locator(".ico-remove")).toHaveCSS("opacity", "0");
  await expect(save).toHaveAttribute("title", "Remove from this category");
  await expect(save).toHaveAccessibleName("Remove 7BpCV from A");
  expect((await save.boundingBox()).width).toBeCloseTo(unsaved.width, 0); // the same slot: nothing in the row moves
  const calm = await paintOf(save);
  const rowPaint = await paintOf(r);
  expect(isGreen(calm.color)).toBe(true);
  for (const k of ["r", "g", "b"]) expect(Math.abs(calm.bg[k] - rowPaint.bg[k]), "no fill: the check sits straight on the row").toBeLessThanOrEqual(2);
  expect(await save.evaluate((el) => getComputedStyle(el).borderTopColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  // hover: a subtle red remove icon replaces the check
  await save.hover();
  await expect(save.locator(".ico-remove")).toHaveCSS("opacity", "1");
  await expect(save.locator(".ico-check")).toHaveCSS("opacity", "0");
  const hot = await paintOf(save);
  expect(isRed(hot.color), "the remove icon is red").toBe(true);
  expect(ratio(hot.color, hot.bg)).toBeGreaterThanOrEqual(3); // a graphic, so 3:1
  await extPage.mouse.move(5, 5);
  await expect(save.locator(".ico-check")).toHaveCSS("opacity", "1");

  // keyboard focus does the same
  await extPage.keyboard.press("Shift");
  await save.focus();
  await expect(save.locator(".ico-remove")).toHaveCSS("opacity", "1");
  await save.blur();

  // click: the puzzle leaves the category, the blue Save is back, and everything that shows it follows
  await save.click();
  await expect(save).toHaveText("Save");
  await expect(save).toHaveAttribute("title", "Save this puzzle to this category");
  await expect.poll(async () => isBlue((await paintOf(save)).bg)).toBe(true); // the fill fades back in
  expect((await getStorage("lichessNotes")).categories.A).toEqual(["old11"]);
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Not saved");
  await expect(extPage.locator("#puzzle-card")).not.toHaveClass(/is-saved/);
});

test("removing from the popup keeps the rest of it honest: counts, the card and Train all", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: [], B: [] }), "7BpCV");
  const trainAll = extPage.locator("#btn-train-all");
  await expect(trainAll).toHaveAttribute("aria-disabled", "true"); // nothing saved anywhere yet

  await row(extPage, "A").locator(".btn-save").click();
  await row(extPage, "B").locator(".btn-save").click();
  await expect(trainAll).not.toHaveAttribute("aria-disabled", "true"); // the first save enables it without reopening the popup
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Saved in 2 categories");
  await expect(row(extPage, "A").locator(".btn-train")).not.toHaveAttribute("aria-disabled", "true");

  await row(extPage, "A").locator(".btn-save").click(); // remove from A
  await expect(extPage.locator("#puzzle-badge")).toHaveText("Saved in 1 category");
  await expect(row(extPage, "A").locator(".cat-count")).toHaveText("0");
  await expect(row(extPage, "A").locator(".btn-train")).toHaveAttribute("aria-disabled", "true"); // an empty category cannot be trained
  await expect(trainAll).not.toHaveAttribute("aria-disabled", "true"); // B still has it

  await row(extPage, "B").locator(".btn-save").click(); // and from B
  await expect(trainAll).toHaveAttribute("aria-disabled", "true"); // nothing left to train
  expect((await getStorage("lichessNotes")).categories).toEqual({ A: [], B: [] });
});

test("saving and removing show no green confirmation: the row changing is the confirmation, and screen readers still hear it", async ({ extPage, send, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: [], B: ["7BpCV"] }), "7BpCV");
  // read right now, never patiently: a success toast hides itself after a couple of seconds, which would pass a patient check
  const toastShown = () => extPage.locator("#toast").evaluate((el) => !el.classList.contains("hidden"));
  const save = row(extPage, "A").locator(".btn-save");

  await save.click();
  await expect(save).toContainText("Saved"); // the row has changed, and the handler that did it has run to its end
  expect(await toastShown(), "no toast after saving").toBe(false);
  await expect(extPage.locator("#sr-status")).toHaveText("Saved to A");

  await save.click();
  await expect(save).toHaveText("Save");
  expect(await toastShown(), "no toast after removing").toBe(false);
  await expect(extPage.locator("#sr-status")).toHaveText("Removed from A");

  // the visible bar is for news: saving where the puzzle already is still says so
  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "7BpCV" }); // saved elsewhere, behind the popup's back
  await save.click();
  await expect(extPage.locator("#toast")).toHaveClass(/toast-warn/);
  await expect(extPage.locator("#toast")).toHaveText("Already in A");
});

test("removing something already gone, or from a category deleted behind the popup's back, says so without breaking", async ({ extPage, send, getStorage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: [], B: [] }), "7BpCV");
  await row(extPage, "A").locator(".btn-save").click();
  await row(extPage, "B").locator(".btn-save").click();

  await send({ type: "REMOVE_PUZZLE", category: "A", puzzleId: "7BpCV" }); // removed elsewhere (the options page)
  await row(extPage, "A").locator(".btn-save").click(); // the popup still shows it saved
  await expect(row(extPage, "A").locator(".btn-save")).toHaveText("Save"); // it simply catches up
  await expect(extPage.locator("#toast")).not.toHaveClass(/toast-error/);
  await expect(extPage.locator("#toast"), "a warning, not a success: this is news to the user").toHaveClass(/toast-warn/);
  await expect(extPage.locator("#toast")).toHaveText("Not saved in A any more");
  expect((await getStorage("lichessNotes")).categories.B).toEqual(["7BpCV"]); // and B was not touched

  await send({ type: "DELETE_CATEGORY", name: "B" });
  await row(extPage, "B").locator(".btn-save").click();
  await expect(extPage.locator("#toast")).toHaveClass(/toast-error/);
  await expect(extPage.locator("#toast")).toContainText("not found");
});

test("Save is blue, Saved is green and Train is neutral, so green only ever means saved", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Bottom: ["abc12"], Dsfqfk: ["def34"] }), "abc12"); // abc12 is saved in Bottom, not in Dsfqfk (which must be trainable too)
  await extPage.setViewportSize({ width: 420, height: 640 });
  const saved = row(extPage, "Bottom"), open = row(extPage, "Dsfqfk");

  // not saved: the available action, blue, with a bookmark
  const save = open.locator(".btn-save");
  await expect(save).toContainText("Save");
  await expect(save).not.toContainText("Saved");
  await expect(save.locator(".ico-bookmark")).toHaveCSS("opacity", "1");
  const a = await paintOf(save);
  expect(isBlue(a.bg), "Save fill").toBe(true);
  expect(isBlue(a.border), "Save border").toBe(true);
  for (const part of [a.bg, a.border, a.color]) expect(isGreen(part), "an available Save must not look like a success").toBe(false);
  expect(ratio(a.color, a.bg)).toBeGreaterThanOrEqual(4.5);

  // saved: subtle green, with a check
  const done = saved.locator(".btn-save");
  await expect(done).toContainText("Saved");
  await expect(done.locator(".ico-check")).toHaveCSS("opacity", "1");
  const b = await paintOf(done);
  expect(isGreen(b.color), "the saved check").toBe(true);
  const rowPaint = await paintOf(saved);
  for (const k of ["r", "g", "b"]) { // no container: no fill and no border, just the check on the row
    expect(Math.abs(b.bg[k] - rowPaint.bg[k]), "Saved has no fill").toBeLessThanOrEqual(2);
    expect(Math.abs(b.border[k] - rowPaint.bg[k]), "Saved has no border").toBeLessThanOrEqual(2);
  }
  expect(isBlue(b.bg), "Saved is no longer the blue of an available action").toBe(false);
  expect(ratio(b.color, b.bg)).toBeGreaterThanOrEqual(4.5);

  // Train: neutral at rest, and neutral (not green) once it expands
  for (const r of [open, saved]) {
    const train = r.locator(".btn-train");
    await extPage.mouse.move(5, 5);
    await extPage.waitForTimeout(250);
    const calm = await paintOf(train);
    for (const part of [calm.bg, calm.border, calm.color]) expect(isGreen(part) || isBlue(part), "Train at rest").toBe(false);
    await train.hover();
    await expect(r.locator(".row-actions")).toHaveClass(/train-hot/);
    await extPage.waitForTimeout(300);
    const hot = await paintOf(train);
    for (const part of [hot.bg, hot.border, hot.color]) expect(isGreen(part), "an expanded Train must not look like a success").toBe(false);
    expect(JSON.stringify(hot)).not.toBe(JSON.stringify(calm)); // it does stand out
    expect(ratio(hot.color, hot.bg)).toBeGreaterThanOrEqual(4.5);
  }

  // squeezed to an icon while Train is expanded: Save is neutral when unsaved, and keeps its green check when saved
  await open.locator(".btn-train").hover();
  await extPage.waitForTimeout(300);
  const squeezed = await paintOf(open.locator(".btn-save"));
  for (const part of [squeezed.bg, squeezed.border, squeezed.color]) expect(isGreen(part), "squeezed unsaved Save").toBe(false);
  await saved.locator(".btn-train").hover();
  await extPage.waitForTimeout(300);
  expect(isGreen((await paintOf(saved.locator(".btn-save"))).color), "squeezed Saved keeps its check green").toBe(true);
});

test("the popup is compact: tighter header, card, rows and Train all, with long names and paused tags still fitting", async ({ extPage, seedStorage }) => {
  const cats = { ...many(8), "A rather long category name that has to be shortened": ["abc12", "def34"], Pins: ["abc12"] };
  const paused = { Pins: { category: "Pins", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 200, completedInCycle: 87, cycleCount: 1, timerStartedAt: 1, pausedAt: 5, ownerTabId: null },
    "A rather long category name that has to be shortened": { category: "A rather long category name that has to be shortened", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 200, completedInCycle: 87, cycleCount: 1, timerStartedAt: 1, pausedAt: 5, ownerTabId: null } };
  await openPopup({ extPage, seedStorage }, { ...notes(cats), pausedCycles: paused }, "7BpCV");
  await extPage.setViewportSize({ width: 400, height: 520 });
  const size = async (sel, i = 0) => extPage.locator(sel).nth(i).boundingBox();

  const [header, card, search, rowA, rowB, trainAll, save, train] = await Promise.all([
    size(".header"), size("#puzzle-card"), size(".search"), size(".category-row", 0), size(".category-row", 1), size("#btn-train-all"), size(".btn-save"), size(".btn-train"),
  ]);
  expect(header.height).toBeLessThanOrEqual(34);
  expect(card.height).toBeLessThanOrEqual(58);
  expect(search.height).toBeLessThanOrEqual(36);
  expect(Math.abs(rowA.height - 41)).toBeLessThanOrEqual(1);
  expect(rowB.y - (rowA.y + rowA.height)).toBeLessThanOrEqual(5); // a tight gap between rows
  expect(trainAll.height).toBeLessThanOrEqual(38);
  expect(save.height).toBeGreaterThanOrEqual(30); // still comfortable to click
  expect(train.height).toBeGreaterThanOrEqual(30);
  expect(save.width).toBeGreaterThan(train.width * 2); // Save is still the wide one

  // Train all is a filled blue, but a restrained one: blue rather than neon, readable, and never the green of "saved"
  const filled = await paintOf(extPage.locator("#btn-train-all"));
  const blueish = ({ r, g, b }) => b >= 110 && b > r * 1.5 && b > g * 1.2; // bright enough to be a fill, not just the page's own dark navy
  const saturation = ({ r, g, b }) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
  expect(blueish(filled.bg), "Train all is a filled blue").toBe(true);
  expect(saturation(filled.bg), "not a glowing neon blue").toBeLessThanOrEqual(0.85);
  expect(isGreen(filled.bg) || isGreen(filled.color) || isGreen(filled.border)).toBe(false);
  expect(ratio(filled.color, filled.bg)).toBeGreaterThanOrEqual(4.5);

  // nothing overflows sideways, long names are cut short rather than pushing the buttons out, and short ones keep room
  expect(await extPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  for (const r of await extPage.locator(".category-row").all()) {
    const [rb, ab] = await Promise.all([r.boundingBox(), r.locator(".row-actions").boundingBox()]);
    expect(ab.x + ab.width, "buttons stay inside the row").toBeLessThanOrEqual(rb.x + rb.width);
  }
  const longName = row(extPage, "A rather long category name that has to be shortened").locator(".cat-name");
  expect(await longName.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // cut with an ellipsis
  expect((await longName.boundingBox()).width).toBeGreaterThanOrEqual(80); // even beside a count and a paused tag
  await expect(row(extPage, "Pins").locator(".cat-paused")).toBeVisible();
});

test("Train starts that category's session without touching what is saved or its colours, and notes only that category as just used", async ({ context, extPage, extensionUrl, seedStorage }) => {
  const seed = notes({ Pins: ["a1a1a", "b2b2b"], Forks: ["c3c3c"], Empty: [] }, { Forks: { color: 2 } });
  await openPopup({ extPage, seedStorage }, seed);
  const read = await trainingSetup(context, extPage, extensionUrl);
  await row(extPage, "Pins").locator(".btn-train").click();
  await extPage.waitForURL(/\/training\/(a1a1a|b2b2b)$/);
  const session = await read("trainingSession");
  expect(session).toMatchObject({ category: "Pins", totalPuzzles: 2, currentIndex: 0 });
  expect([...session.queue].sort()).toEqual(["https://lichess.org/training/a1a1a", "https://lichess.org/training/b2b2b"]);
  expect(typeof session.ownerTabId).toBe("number");
  const after = await read("lichessNotes");
  expect(after.categories).toEqual(seed.lichessNotes.categories); // saved puzzles untouched
  expect(after.meta.categoryMeta.Forks, "other categories untouched").toEqual({ color: 2 });
  expect(Object.keys(after.meta.categoryMeta).sort(), "only the trained one gained an entry").toEqual(["Forks", "Pins"]);
  expect(Object.keys(after.meta.categoryMeta.Pins), "just the last-used time, no invented colour").toEqual(["lastUsed"]);
});

test("Train all uses every saved puzzle, and empty categories and an empty library cannot start anything", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["a1a1a", "b2b2b"], Forks: ["b2b2b", "c3c3c"], Empty: [] }));
  const read = await trainingSetup(context, extPage, extensionUrl);

  const empty = row(extPage, "Empty").locator(".btn-train");
  await expect(empty).toHaveAttribute("aria-disabled", "true");
  await expect(empty).toHaveAttribute("title", "Save a puzzle before training.");
  await empty.click({ force: true });
  await extPage.waitForTimeout(300);
  expect(await read("trainingSession")).toBeUndefined();

  await extPage.locator("#btn-train-all").click();
  await extPage.waitForURL(/\/training\//);
  expect(await read("trainingSession")).toMatchObject({ category: "All Categories", totalPuzzles: 3 }); // b2b2b counted once

  await extPage.goto(extensionUrl("popup.html")); // the tab was sent to the first puzzle
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }));
  await expect(extPage.locator("#btn-train-all")).toHaveAttribute("aria-disabled", "true");
});

test("the popup can be used by keyboard and screen reader, and Settings opens the options page", async ({ context, extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"], Forks: [] }), "7BpCV");
  await expect(extPage.locator(".summary")).toContainText("2 Categories"); // the totals are plain text now, not a heading
  await expect(extPage.getByRole("list", { name: "Categories" })).toBeVisible(); // the list keeps its name for screen readers
  await expect(extPage.getByRole("searchbox", { name: "Search categories" })).toBeVisible();
  await expect(extPage.getByRole("button", { name: "Train Pins" })).toBeVisible();
  await expect(extPage.getByRole("button", { name: "Train all categories" })).toBeVisible();

  const [options] = await Promise.all([context.waitForEvent("page"), extPage.getByRole("button", { name: "Settings" }).click()]);
  await expect(options).toHaveURL(/options\.html$/);
});

// ---- Paused cycles: one per category, parked in `pausedCycles` ----

const MIN = 60_000;
const PINS = ["a1a1a", "b2b2b", "c3c3c", "d4d4d"];
const oldStats = [{ category: "Pins", timeTaken: 90_000, totalPuzzles: 4, correct: 3, incorrect: 1, skipped: 0, completedAt: 5 }];
const urls = (ids) => ids.map((id) => `https://lichess.org/training/${id}`);
// Pins: paused two of four puzzles in, five minutes of training time (it began ten minutes ago and has sat paused for five).
const pinsCycle = (extra = {}) => {
  const now = Date.now();
  return { ownerTabId: null, category: "Pins", queue: urls(PINS), currentIndex: 2, totalPuzzles: 4, completedInCycle: 2, correctInCycle: 1, incorrectInCycle: 1, skippedInCycle: 0, cycleCount: 3, isMinimized: false, timerStartedAt: now - 10 * MIN, pausedAt: now - 5 * MIN, ...extra };
};
const forksCycle = () => {
  const now = Date.now();
  return { ownerTabId: null, category: "Forks", queue: urls(["e5e5e"]), currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 2, isMinimized: false, timerStartedAt: now - 3 * MIN, pausedAt: now - MIN };
};
const library = (extra = {}) => ({ categories: { Pins: PINS, Forks: ["e5e5e"], Solo: ["solo1"] }, meta: { version: 1, updatedAt: 0, trainingStats: oldStats, ...extra } });
const seedParked = ({ pins = true, forks = false, active } = {}) => ({
  lichessNotes: library(),
  pausedCycles: { ...(pins ? { Pins: pinsCycle() } : {}), ...(forks ? { Forks: forksCycle() } : {}) },
  ...(active ? { trainingSession: active } : {}),
});

test("starting another category leaves a paused cycle alone: it just stays parked", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, seedParked());
  const read = await trainingSetup(context, extPage, extensionUrl);
  const before = await read("pausedCycles");
  await row(extPage, "Forks").locator(".btn-train").click(); // Pins is paused; Forks has no paused cycle
  await extPage.waitForURL(/\/training\/e5e5e$/);
  await expect(extPage.getByRole("dialog")).toHaveCount(0); // nothing to decide
  expect((await read("trainingSession")).category).toBe("Forks");
  expect(await read("pausedCycles")).toEqual(before); // Pins is exactly as it was
});

test("pressing Train on a category with a paused cycle continues it at once: only that category, exactly as saved, without the paused time", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, seedParked({ forks: true }));
  const read = await trainingSetup(context, extPage, extensionUrl);
  const before = await read("pausedCycles");
  let nativeDialogs = 0;
  extPage.on("dialog", (d) => { nativeDialogs++; d.dismiss(); });
  await row(extPage, "Pins").locator(".btn-train").click(); // no question, no second click
  await expect(extPage.getByRole("dialog")).toHaveCount(0);
  await extPage.waitForURL(/\/training\/c3c3c$/); // the unfinished puzzle, not the first
  expect(nativeDialogs).toBe(0);

  const s = await read("trainingSession");
  expect(s.pausedAt).toBeUndefined();
  expect(s).toMatchObject({ category: "Pins", currentIndex: 2, completedInCycle: 2, correctInCycle: 1, incorrectInCycle: 1, cycleCount: 3, totalPuzzles: 4 });
  expect(s.queue).toEqual(before.Pins.queue); // the same order
  expect(typeof s.ownerTabId).toBe("number");
  const elapsed = Date.now() - s.timerStartedAt;
  expect(elapsed).toBeGreaterThan(5 * MIN - 1_000);
  expect(elapsed).toBeLessThan(5 * MIN + 20_000);

  expect(await read("pausedCycles")).toEqual({ Forks: before.Forks }); // Pins left the parked area; Forks is still waiting
  expect((await read("lichessNotes")).meta.trainingStats).toEqual(oldStats);
});

test("Train all continues its own paused cycle too, without a question", async ({ context, extPage, extensionUrl, seedStorage }) => {
  const now = Date.now();
  const all = { ownerTabId: null, category: "All Categories", queue: urls(["a1a1a", "e5e5e"]), currentIndex: 1, totalPuzzles: 2, completedInCycle: 1, correctInCycle: 1, cycleCount: 2, isMinimized: false, timerStartedAt: now - 10 * MIN, pausedAt: now - 8 * MIN };
  await openPopup({ extPage, seedStorage }, { lichessNotes: library(), pausedCycles: { "All Categories": all } });
  const read = await trainingSetup(context, extPage, extensionUrl);
  await extPage.locator("#btn-train-all").click();
  await extPage.waitForURL(/\/training\/e5e5e$/);
  const s = await read("trainingSession");
  expect(s).toMatchObject({ category: "All Categories", currentIndex: 1, completedInCycle: 1, cycleCount: 2 });
  expect(s.pausedAt).toBeUndefined();
  expect(await read("pausedCycles")).toBeFalsy();
  expect(Date.now() - s.timerStartedAt).toBeLessThan(2 * MIN + 20_000); // the eight minutes away are not counted
});

test("each category with a paused cycle shows where it stands on its row", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, seedParked({ forks: true }));
  await expect(row(extPage, "Pins").locator(".cat-paused")).toHaveText("⏸ 2/4");
  await expect(row(extPage, "Pins").locator(".cat-paused")).toHaveAttribute("title", /Paused/);
  await expect(row(extPage, "Forks").locator(".cat-paused")).toHaveText("⏸ 0/1");
  await expect(row(extPage, "Solo").locator(".cat-paused")).toBeHidden(); // nothing paused there
});

test("a cycle stored in the old shape (paused in the active slot) is parked rather than lost", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { lichessNotes: library(), trainingSession: pinsCycle() });
  const read = await trainingSetup(context, extPage, extensionUrl);
  let asked = false;
  extPage.on("dialog", (d) => { asked = true; d.dismiss(); });
  await row(extPage, "Forks").locator(".btn-train").click();
  await extPage.waitForURL(/\/training\/e5e5e$/);
  expect(asked).toBe(false); // it is paused, so it is not "in progress"
  expect((await read("trainingSession")).category).toBe("Forks");
  const parked = await read("pausedCycles");
  expect(parked.Pins).toMatchObject({ category: "Pins", currentIndex: 2, completedInCycle: 2, cycleCount: 3, ownerTabId: null });
  expect(parked.Pins.pausedAt).toBeGreaterThan(0);
});

// Starting a training while another cycle is running used to ask "A training session is already in progress. Start a new
// one?" in a native dialog. There is no question now: the new one just starts and replaces the running one.
const soloParked = () => { const now = Date.now(); return { ownerTabId: null, category: "Solo", queue: urls(["solo1"]), currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: now - 3 * MIN, pausedAt: now - MIN }; };
for (const c of [
  { name: "another category", press: (page) => row(page, "Forks").locator(".btn-train"), url: /\/training\/e5e5e$/, expect: { category: "Forks", totalPuzzles: 1 } },
  { name: "the same category (it starts over)", press: (page) => row(page, "Pins").locator(".btn-train"), url: /\/training\/(a1a1a|b2b2b|c3c3c|d4d4d)$/, expect: { category: "Pins", totalPuzzles: 4 } },
  { name: "Train all categories", press: (page) => page.locator("#btn-train-all"), url: /\/training\/(a1a1a|b2b2b|c3c3c|d4d4d|e5e5e|solo1)$/, expect: { category: "All Categories", totalPuzzles: 6 } },
]) {
  test(`pressing Train for ${c.name} while another cycle is running just starts it: no dialog, nothing to confirm`, async ({ context, extPage, extensionUrl, seedStorage }) => {
    const running = pinsCycle();
    delete running.pausedAt; // running, not paused
    await openPopup({ extPage, seedStorage }, { lichessNotes: library(), trainingSession: running, pausedCycles: { Solo: soloParked() } });
    const read = await trainingSetup(context, extPage, extensionUrl);
    const parkedBefore = await read("pausedCycles");
    const dialogs = [];
    extPage.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

    await c.press(extPage).click();
    await extPage.waitForURL(c.url); // it went straight to the first puzzle of the new cycle
    expect(dialogs, "no native dialog of any kind").toEqual([]);
    await expect(extPage.getByRole("dialog")).toHaveCount(0);
    const s = await read("trainingSession");
    expect(s, "the new cycle replaced the running one").toMatchObject({ ...c.expect, currentIndex: 0, completedInCycle: 0, cycleCount: 1 });
    expect(s.pausedAt).toBeUndefined();
    expect(await read("pausedCycles"), "a cycle parked for another category is exactly as it was").toEqual(parkedBefore);
    expect((await read("lichessNotes")).meta.trainingStats, "the abandoned cycle recorded nothing").toEqual(oldStats);
  });
}

test("finishing a continued cycle uses the normal score screen, leaves nothing parked and records a time without the pause", async ({ context, extPage, extensionUrl, seedStorage }) => {
  const now = Date.now();
  const solo = { ownerTabId: null, category: "Solo", queue: urls(["solo1"]), currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: now - 65 * MIN, pausedAt: now - 60 * MIN };
  await openPopup({ extPage, seedStorage }, { lichessNotes: library(), pausedCycles: { Solo: solo } }); // five minutes of training, then an hour away
  const read = await trainingSetup(context, extPage, extensionUrl);
  await row(extPage, "Solo").locator(".btn-train").click();
  await extPage.waitForURL(/\/training\/solo1$/); // this tab is now the puzzle, with the overlay running

  const overlay = extPage.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-skip").click();
  await expect(overlay.locator(".wpk-result")).toBeVisible(); // the existing completion behaviour
  expect((await read("trainingSession")).pausedAt).toBeUndefined();
  expect(await read("pausedCycles")).toBeFalsy(); // nothing left parked

  const stats = (await read("lichessNotes")).meta.trainingStats;
  expect(stats).toHaveLength(2);
  expect(stats[1]).toEqual(oldStats[0]); // earlier statistics untouched
  expect(stats[0].timeTaken).toBeGreaterThan(5 * MIN - 1_000);
  expect(stats[0].timeTaken).toBeLessThan(5 * MIN + 30_000); // five minutes, not an hour and five
});

test("two categories can each be paused and picked up again, one at a time", async ({ context, extPage, extensionUrl, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { lichessNotes: library() });
  const read = await trainingSetup(context, extPage, extensionUrl);
  const overlay = extPage.locator("#lpn-woodpecker-overlay");
  const fromPopup = async (name) => { // this tab is the popup and then the puzzle; reopen the popup in it
    await extPage.goto(extensionUrl("popup.html"));
    await extPage.evaluate(() => { window.close = () => {}; });
    await row(extPage, name).locator(".btn-train").click();
  };
  const pause = async () => {
    await overlay.locator(".wpk-btn-pause").click();
    await expect(overlay.locator(".wpk-paused")).toBeVisible();
  };

  // Pins: skip one puzzle, then pause
  await row(extPage, "Pins").locator(".btn-train").click();
  await extPage.waitForURL(/\/training\/(a1a1a|b2b2b|c3c3c|d4d4d)$/);
  await overlay.locator(".wpk-btn-skip").click();
  await expect(overlay.locator(".wpk-panel")).toBeVisible();
  await pause();
  const pins = (await read("pausedCycles")).Pins;
  expect(pins).toMatchObject({ category: "Pins", currentIndex: 1, skippedInCycle: 1, completedInCycle: 1 });

  // Forks starts without any prompt and without touching Pins; pause it too
  await fromPopup("Forks");
  await extPage.waitForURL(/\/training\/e5e5e$/);
  await expect(overlay.locator(".wpk-btn-pause")).toBeVisible();
  await pause();
  let parked = await read("pausedCycles");
  expect(Object.keys(parked).sort()).toEqual(["Forks", "Pins"]);
  expect(parked.Pins).toEqual(pins);
  expect(await read("trainingSession")).toBeUndefined(); // nothing is running; both wait

  // Continue Pins: it comes back exactly, and Forks is still waiting
  await fromPopup("Pins");
  await extPage.waitForURL(new RegExp(`/training/${pins.queue[1].split("/").pop()}$`));
  expect(await read("trainingSession")).toMatchObject({ category: "Pins", currentIndex: 1, skippedInCycle: 1, completedInCycle: 1 });
  parked = await read("pausedCycles");
  expect(Object.keys(parked)).toEqual(["Forks"]);

  // Pause Pins again and pick Forks up: now Pins waits and Forks runs
  await pause();
  await fromPopup("Forks");
  await extPage.waitForURL(/\/training\/e5e5e$/);
  expect(Object.keys(await read("pausedCycles"))).toEqual(["Pins"]);
  expect((await read("trainingSession")).category).toBe("Forks");
  expect((await read("lichessNotes")).meta.trainingStats).toEqual(oldStats); // no statistics were touched along the way
});

test("the cycle being trained now has a gold bolt in the popup (its row, or Train all); paused, finished and other rows do not", async ({ extPage, seedStorage }) => {
  const GOLD = "rgb(251, 191, 36)";
  const session = (extra) => ({ trainingSession: { category: "Pins", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, timerStartedAt: 1, ownerTabId: null, ...extra } });
  const bolt = (name) => row(extPage, name).locator(".btn-train svg");
  const colour = (loc) => loc.evaluate((e) => getComputedStyle(e).color);
  const cats = { Pins: ["abc12"], Forks: ["def34"] };

  await openPopup({ extPage, seedStorage }, { ...notes(cats), ...session({}) });
  expect(await colour(bolt("Pins"))).toBe(GOLD);
  expect(await colour(bolt("Forks"))).not.toBe(GOLD);
  await expect(row(extPage, "Pins").locator(".btn-train")).toHaveAttribute("title", "Training this category now");
  await expect(extPage.locator("#btn-train-all")).not.toHaveClass(/is-running/);

  await openPopup({ extPage, seedStorage }, { ...notes(cats), ...session({ category: "All Categories" }) });
  expect(await colour(extPage.locator("#btn-train-all svg"))).toBe(GOLD);
  expect(await colour(bolt("Pins"))).not.toBe(GOLD);

  await openPopup({ extPage, seedStorage }, { ...notes(cats), ...session({ cycleFinishedAt: 5 }) }); // score screen
  expect(await colour(bolt("Pins"))).not.toBe(GOLD);
  await openPopup({ extPage, seedStorage }, { ...notes(cats), ...session({ pausedAt: 5 }) }); // paused (old shape)
  expect(await colour(bolt("Pins"))).not.toBe(GOLD);
});

// ---- shared.js: the one buildSession both the popup and the options page use ----

const PAUSED = (category, extra = {}) => ({ category, queue: ["https://lichess.org/training/aaaaa", "https://lichess.org/training/bbbbb"], currentIndex: 1, totalPuzzles: 2, completedInCycle: 1, cycleCount: 1, isMinimized: false, timerStartedAt: 1_000, pausedAt: 5_000, ownerTabId: 7, ...extra });

test("buildSession: a fresh cycle de-duplicates and shuffles; a parked or old-shape paused cycle continues with its clock shifted", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ A: ["aaaaa"] }));
  const run = (args) => extPage.evaluate((a) => { const r = buildSession(...a); return { ...r, now: Date.now() }; }, args);

  // fresh: every different puzzle once, as lichess URLs, in some order, from the start
  const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(4, "0")}`);
  const fresh = await run(["Pins", [...ids, ...ids.slice(0, 5)], null, null]);
  expect(fresh.park).toBeNull();
  expect(fresh.unpark).toBeNull();
  expect(fresh.session).toMatchObject({ category: "Pins", currentIndex: 0, totalPuzzles: 40, cycleCount: 1, completedInCycle: 0, isMinimized: false });
  expect([...fresh.session.queue].sort()).toEqual(ids.map((id) => `https://lichess.org/training/${id}`));
  expect(fresh.session.queue, "shuffled, not left in order").not.toEqual(ids.map((id) => `https://lichess.org/training/${id}`));
  expect(fresh.session.pausedAt).toBeUndefined();

  // a parked cycle of this category: continued (unpark names it), paused time left out of the clock, pausedAt gone
  const parked = await run(["Pins", ["aaaaa"], null, { Pins: PAUSED("Pins"), Other: PAUSED("Other") }]);
  expect(parked.unpark).toBe("Pins");
  expect(parked.park).toBeNull();
  expect(parked.session.pausedAt).toBeUndefined();
  expect(parked.session.currentIndex).toBe(1);
  expect(Math.abs(parked.session.timerStartedAt - (1_000 + parked.now - 5_000))).toBeLessThan(2_000);

  // an old-shape paused cycle of ANOTHER category is parked (kept), and a fresh cycle starts
  const other = await run(["Pins", ["aaaaa"], PAUSED("Forks"), null]);
  expect(other.park).toMatchObject({ category: "Forks", ownerTabId: null, pausedAt: 5_000 });
  expect(other.session.category).toBe("Pins");
  expect(other.unpark).toBeNull();

  // an old-shape paused cycle of THIS category is continued, not parked
  const same = await run(["Pins", ["aaaaa"], PAUSED("Pins"), null]);
  expect(same.park).toBeNull();
  expect(same.unpark).toBeNull();
  expect(same.session).toMatchObject({ category: "Pins", currentIndex: 1 });
  expect(same.session.pausedAt).toBeUndefined();

  // a category named like an Object.prototype key does not "find" a parked cycle through the prototype
  const proto = await run(["constructor", ["aaaaa"], null, {}]);
  expect(proto.unpark).toBeNull();
  expect(proto.session.category).toBe("constructor");
});

test("both pages load shared.js and neither redefines what it provides", async ({ context, extensionUrl, extPage }) => {
  const has = (p) => p.evaluate(() => ["buildSession", "fisherYatesShuffle", "showToast"].every((n) => typeof window[n] === "function"));
  expect(await has(extPage)).toBe(true);
  const options = await context.newPage();
  await options.goto(extensionUrl("options.html"));
  expect(await has(options)).toBe(true);
  for (const f of ["popup.js", "options.js"]) {
    const src = require("fs").readFileSync(require("path").join(__dirname, "..", f), "utf8");
    for (const n of ["buildSession", "fisherYatesShuffle", "showToast"]) expect(src, `${f} must not define ${n}`).not.toMatch(new RegExp(`function ${n}\\b`));
  }
});

// ---- Rename a category in the popup: double-click it, type, Enter ----

const nameInput = (page) => page.locator(".category-row .rename-input");
const spyRenames = (page) => page.evaluate(() => {
  window.__renames = [];
  const real = browser.runtime.sendMessage.bind(browser.runtime);
  browser.runtime.sendMessage = (message, ...rest) => { if (message && message.type === "RENAME_CATEGORY") window.__renames.push([message.oldName, message.newName]); return real(message, ...rest); };
});
const renamesSent = (page) => page.evaluate(() => window.__renames);

test("double-clicking a category turns its name into a field in place: nothing moves, the name is selected, and the rest of the row stays", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12", "def34"], Forks: [] }), "7BpCV");
  const rows = async () => [await box(row(extPage, "Pins")), await box(row(extPage, "Forks")), await box(extPage.locator("#btn-train-all")), await box(extPage.locator(".popup-container"))];
  const before = await rows();

  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await expect(nameInput(extPage)).toHaveCount(1);
  await expect(nameInput(extPage)).toBeFocused();
  await expect(nameInput(extPage)).toHaveValue("Pins");
  expect(await nameInput(extPage).evaluate((el) => [el.selectionStart, el.selectionEnd]), "the name is selected, ready to be replaced").toEqual([0, 4]);
  await expect(nameInput(extPage)).toHaveAccessibleName(/Rename category Pins/i);
  expect(await rows(), "nothing moves, the row keeps its height").toEqual(before);
  // the count and the buttons are still there beside it
  await expect(row(extPage, "Pins").locator(".cat-count")).toBeVisible();
  await expect(row(extPage, "Pins").locator(".btn-save")).toBeVisible();
  await expect(row(extPage, "Pins").locator(".btn-train")).toBeVisible();
  expect(await extPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no sideways overflow").toBe(true);
});

test("double-clicking the empty part of the row works too, but double-clicking Save or Train does not start a rename", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"] }), "7BpCV");
  await row(extPage, "Pins").locator(".cat-count").dblclick();
  await expect(nameInput(extPage)).toHaveCount(1);
  await nameInput(extPage).press("Escape");
  await expect(nameInput(extPage)).toHaveCount(0);
  await row(extPage, "Pins").locator(".btn-train").dblclick({ trial: true }); // (a trial: the real double-click would start two trainings)
  await row(extPage, "Pins").locator(".btn-save").dblclick();
  await expect(nameInput(extPage), "Save is for saving").toHaveCount(0);
});

test("Enter renames: the new name shows, the puzzles, the colour and a paused cycle stay with it, and the old name is gone", async ({ extPage, seedStorage, getStorage }) => {
  const paused = { ownerTabId: null, category: "Pins", queue: ["https://lichess.org/training/abc12", "https://lichess.org/training/def34"], currentIndex: 1, totalPuzzles: 2, completedInCycle: 1, cycleCount: 1, isMinimized: false, timerStartedAt: 1_000, pausedAt: 2_000 };
  await openPopup({ extPage, seedStorage }, { ...notes({ Pins: ["abc12", "def34"], Forks: [] }, { Pins: { color: 3 }, Forks: { color: 5 } }), pausedCycles: { Pins: paused } }, "7BpCV");
  const dot = (name) => row(extPage, name).locator(".cat-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
  const colour = await dot("Pins");
  await spyRenames(extPage);

  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("Pin tactics");
  await nameInput(extPage).press("Enter");
  await expect(row(extPage, "Pin tactics")).toBeVisible();
  await expect(row(extPage, "Pins")).toHaveCount(0);
  await expect(nameInput(extPage)).toHaveCount(0);
  await expect(row(extPage, "Pin tactics").locator(".cat-count")).toHaveText("2");
  expect(await dot("Pin tactics"), "the colour travels with the category").toBe(colour);
  await expect(row(extPage, "Pin tactics").locator(".cat-paused"), "the paused cycle too").toHaveText("⏸ 1/2");
  const stored = await getStorage("lichessNotes");
  expect(Object.keys(stored.categories).sort()).toEqual(["Forks", "Pin tactics"]);
  expect(stored.categories["Pin tactics"]).toEqual(["abc12", "def34"]);
  expect(Object.keys(await getStorage("pausedCycles"))).toEqual(["Pin tactics"]);
  expect(await renamesSent(extPage)).toEqual([["Pins", "Pin tactics"]]);
});

test("Escape, an unchanged name and an emptied field leave the category alone, and send nothing", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }), "7BpCV");
  await spyRenames(extPage);
  // Escape throws the typing away
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("Something else");
  await nameInput(extPage).press("Escape");
  await expect(nameInput(extPage)).toHaveCount(0);
  await expect(row(extPage, "Pins")).toBeVisible();
  // Enter on the same name just closes it
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).press("Enter");
  await expect(nameInput(extPage)).toHaveCount(0);
  // an empty or blank name is not a name: it is flagged, Enter does nothing, and the field stays for another try
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("   ");
  await expect(nameInput(extPage)).toHaveAttribute("aria-invalid", "true");
  await nameInput(extPage).press("Enter");
  await expect(nameInput(extPage)).toHaveCount(1);
  expect(await renamesSent(extPage), "no request for any of that").toEqual([]);
});

test("a name another category already has (any case) is flagged and not sent; changing only the case of its own name is allowed", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }), "7BpCV");
  await spyRenames(extPage);
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("forks");
  await expect(nameInput(extPage)).toHaveAttribute("aria-invalid", "true");
  await expect(nameInput(extPage)).toHaveAttribute("title", /already exists/i);
  const red = await nameInput(extPage).evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(red, "a red border").toMatch(/^rgb\(2[0-9]{2}, \d{2,3}, \d{2,3}\)$/);
  await nameInput(extPage).press("Enter");
  await expect(nameInput(extPage)).toHaveCount(1);
  expect(await renamesSent(extPage)).toEqual([]);

  await nameInput(extPage).fill("PINS"); // its own name, new case
  await expect(nameInput(extPage)).not.toHaveAttribute("aria-invalid", "true");
  await nameInput(extPage).press("Enter");
  await expect(row(extPage, "PINS")).toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories).sort()).toEqual(["Forks", "PINS"]);
});

test("a name the background refuses shows its message and keeps the field open for another try", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("All Categories");
  await nameInput(extPage).press("Enter");
  await expect(extPage.locator("#toast")).toHaveText('"All Categories" is reserved and cannot be a category name.');
  await expect(nameInput(extPage)).toHaveCount(1);
  await expect(nameInput(extPage)).toBeFocused();
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Pins"]);
  await nameInput(extPage).fill("Mates");
  await nameInput(extPage).press("Enter");
  await expect(row(extPage, "Mates")).toBeVisible();
});

test("clicking away commits a good new name and quietly cancels an unchanged or invalid one", async ({ extPage, seedStorage, getStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }), "7BpCV");
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("Mates");
  await extPage.locator(".summary").click(); // somewhere else
  await expect(row(extPage, "Mates")).toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories).sort()).toEqual(["Forks", "Mates"]);

  await row(extPage, "Forks").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("mates"); // taken
  await extPage.locator(".summary").click();
  await expect(nameInput(extPage)).toHaveCount(0);
  await expect(row(extPage, "Forks")).toBeVisible();
  expect(Object.keys((await getStorage("lichessNotes")).categories).sort()).toEqual(["Forks", "Mates"]);
});

test("F2 renames the category whose row has focus, so a keyboard user can do it too", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"], Forks: [] }), "7BpCV");
  await row(extPage, "Forks").locator(".btn-train").focus();
  await extPage.keyboard.press("F2");
  await expect(nameInput(extPage)).toHaveCount(1);
  await expect(nameInput(extPage)).toHaveValue("Forks");
  await expect(nameInput(extPage)).toBeFocused();
  await nameInput(extPage).press("Escape");
  await expect(row(extPage, "Forks").locator(".btn-train"), "focus goes back to where it was").toBeFocused();
});

test("only one category is renamed at a time, and a double-click in the search box or on the totals does nothing", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [], Forks: [] }), "7BpCV");
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await row(extPage, "Forks").locator(".cat-name").dblclick(); // the first one closes (its field loses focus), the second opens
  await expect(nameInput(extPage)).toHaveCount(1);
  await expect(nameInput(extPage)).toHaveValue("Forks");
  await nameInput(extPage).press("Escape");
  await extPage.locator("#search").dblclick();
  await extPage.locator(".summary").dblclick();
  await expect(nameInput(extPage)).toHaveCount(0);
});

test("the rename field is as readable as the name it replaces and has one soft blue ring", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  const look = await nameInput(extPage).evaluate((el) => {
    const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const c = getComputedStyle(el);
    const [x, y] = [lum(c.color), lum(c.backgroundColor)].sort((a, b) => b - a);
    return { ratio: (x + 0.05) / (y + 0.05), outline: c.outlineStyle, border: c.borderTopColor, height: el.getBoundingClientRect().height };
  });
  expect(look.ratio).toBeGreaterThanOrEqual(4.5);
  expect(look.outline, "no native outline").toBe("none");
  expect(look.height, "fits inside the 41px row").toBeLessThanOrEqual(34);
  const m = look.border.match(/\d+/g).map(Number);
  expect(m[2], "a blue border").toBeGreaterThan(m[0] + 40);
});

test("if the background does not answer a rename, the field says so and still works", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.evaluate(() => {
    const real = browser.runtime.sendMessage.bind(browser.runtime);
    let fail = true;
    browser.runtime.sendMessage = (m, ...r) => (fail && m && m.type === "RENAME_CATEGORY" ? ((fail = false), Promise.reject(new Error("gone"))) : real(m, ...r));
  });
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("Mates");
  await nameInput(extPage).press("Enter");
  await expect(extPage.locator("#toast")).toHaveText("Could not rename the category.");
  await nameInput(extPage).press("Enter"); // the second try goes through
  await expect(row(extPage, "Mates")).toBeVisible();
});

// ---- The toast: dark green card, check icon, a close button, above Train all categories ----

const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test("the toast hovers above Train all categories, dark green with a green border, check icon and soft white text", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: ["abc12"], Forks: [] }), "7BpCV");
  await extPage.evaluate(() => showToast("Created “Pin”", "success"));
  const toast = extPage.locator("#toast");
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText("Created “Pin”"); // the icon and the close button add no text
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toHaveAttribute("aria-live", "polite");
  const look = await toast.evaluate((el) => { const c = getComputedStyle(el); const i = el.querySelector(".toast-icon svg"); return { bg: c.backgroundColor, border: c.borderTopColor, borderW: c.borderTopWidth, color: c.color, radius: parseFloat(c.borderTopLeftRadius), shadow: c.boxShadow, icon: i && getComputedStyle(i).color, iconLeft: i && i.getBoundingClientRect().left < el.querySelector(".toast-msg").getBoundingClientRect().left }; });
  expect(rgb(look.bg)).toEqual(hex("#10291F"));
  expect(rgb(look.border)).toEqual(hex("#256B4A"));
  expect(look.borderW).toBe("1px");
  expect(rgb(look.color)).toEqual(hex("#E6F7ED"));
  expect(rgb(look.icon), "a green icon").toEqual(hex("#34D399"));
  expect(look.iconLeft, "on the left").toBe(true);
  const drawn = await toast.evaluate((el) => [".toast-icon svg", ".toast-close svg"].map((q) => { const r = el.querySelector(q).getBoundingClientRect(); return [r.width, r.height, el.querySelector(q).namespaceURI]; }));
  for (const [w, h, ns] of drawn) { expect(w, "an icon that is really drawn").toBeGreaterThanOrEqual(10); expect(h).toBeGreaterThanOrEqual(10); expect(ns).toBe("http://www.w3.org/2000/svg"); }
  expect(look.radius).toBeGreaterThanOrEqual(8);
  expect(look.shadow).not.toBe("none");
  // above the button, centred, not covering it or any row's buttons below the list's bottom edge
  const t = await box(toast), b = await box(extPage.locator("#btn-train-all")), p = await box(extPage.locator(".popup-container"));
  expect(t.y + t.height, "clear of Train all categories").toBeLessThanOrEqual(b.y);
  expect(Math.abs(t.x + t.width / 2 - (p.x + p.width / 2)), "centred").toBeLessThanOrEqual(2);
  expect(t.x).toBeGreaterThanOrEqual(p.x);
  expect(t.x + t.width).toBeLessThanOrEqual(p.x + p.width);
});

test("the toast has a close button, replaces the previous one instead of stacking, and goes by itself after 2.5 seconds", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.evaluate(() => { showToast("First", "success"); showToast("Second", "warn"); });
  await expect(extPage.locator(".toast")).toHaveCount(1);
  await expect(extPage.locator("#toast")).toHaveText("Second");
  await expect(extPage.locator("#toast")).toHaveClass(/toast-warn/);
  await extPage.locator("#toast .toast-close").click();
  await expect(extPage.locator("#toast")).toBeHidden();
  await extPage.evaluate(() => showToast("Again", "success"));
  await expect(extPage.locator("#toast .toast-close")).toHaveAccessibleName("Dismiss");
  await extPage.waitForTimeout(2300);
  expect(await extPage.locator("#toast").isVisible(), "still there at 2.3s").toBe(true);
  await expect(extPage.locator("#toast")).toBeHidden({ timeout: 1000 }); // gone by about 2.5s
});

test("error and warning toasts are dark too, with their own colour, and stay readable", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  for (const kind of ["error", "warn"]) {
    await extPage.evaluate((k) => showToast("Something to read", k), kind);
    const r = await extPage.locator("#toast").evaluate((el) => {
      const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const c = getComputedStyle(el); const [x, y] = [lum(c.color), lum(c.backgroundColor)].sort((a, b) => b - a);
      return { ratio: (x + 0.05) / (y + 0.05), bg: c.backgroundColor, icon: getComputedStyle(el.querySelector(".toast-icon svg")).color };
    });
    expect(r.ratio, kind).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(...rgb(r.bg)), `${kind} background is dark`).toBeLessThan(80);
    expect(r.icon, `${kind} has its own icon colour`).not.toBe("rgb(52, 211, 153)");
  }
});

test("a new or renamed category name is limited to 45 characters in the field", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, notes({ Pins: [] }), "7BpCV");
  await extPage.locator("#btn-new").click();
  await expect(extPage.locator("#new-name")).toHaveAttribute("maxlength", "45");
  await extPage.locator("#new-name").pressSequentially("a".repeat(60));
  await expect(extPage.locator("#new-name")).toHaveValue("a".repeat(45));
  await extPage.locator("#new-name").press("Escape");
  await row(extPage, "Pins").locator(".cat-name").dblclick();
  await expect(nameInput(extPage)).toHaveAttribute("maxlength", "45");
});

// ---- Category order: Settings says Alphabetical (the default) or Last used; the popup follows it when it opens ----

const used = (stamps) => Object.fromEntries(Object.entries(stamps).map(([name, lastUsed]) => [name, { lastUsed }]));
const fruit = () => ({ Apple: [], Mango: [], Pears: [], Zebra: [], Berry: [] });

test("with Category order set to Last used the popup lists the newest first, then the never-used ones A to Z", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Zebra: 3000, Mango: 2000, Apple: 1000 })), categorySort: "lastUsed" });
  expect(await names(extPage)).toEqual(["Zebra", "Mango", "Apple", "Berry", "Pears"]);
});

test("Alphabetical (the default), an unknown value, or no stamps at all gives A to Z", async ({ extPage, seedStorage }) => {
  const az = ["Apple", "Berry", "Mango", "Pears", "Zebra"];
  await openPopup({ extPage, seedStorage }, notes(fruit(), used({ Zebra: 3000, Mango: 2000 })));
  expect(await names(extPage), "nothing chosen").toEqual(az);
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Zebra: 3000 })), categorySort: "alphabetical" });
  expect(await names(extPage)).toEqual(az);
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Zebra: 3000 })), categorySort: "newest" });
  expect(await names(extPage), "unknown means alphabetical").toEqual(az);
  await openPopup({ extPage, seedStorage }, { ...notes(fruit()), categorySort: "lastUsed" });
  expect(await names(extPage), "Last used with no history yet is A to Z").toEqual(az);
});

test("in Last used the open popup keeps its order (a row never moves under the pointer) and a fresh open shows the new one", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Apple: 3000, Mango: 2000 })), categorySort: "lastUsed" }, "7BpCV");
  expect(await names(extPage)).toEqual(["Apple", "Mango", "Berry", "Pears", "Zebra"]);
  const before = await box(row(extPage, "Zebra"));
  await row(extPage, "Zebra").locator(".btn-save").click(); // using Zebra
  await expect(row(extPage, "Zebra")).toHaveClass(/is-saved/);
  expect(await names(extPage), "the order is frozen while the popup is open").toEqual(["Apple", "Mango", "Berry", "Pears", "Zebra"]);
  expect(await box(row(extPage, "Zebra")), "and the row did not move").toEqual(before);
  await extPage.reload(); // the next time it opens
  await expect(extPage.locator("#category-list")).toBeVisible();
  expect((await names(extPage))[0], "Zebra, just used, is on top").toBe("Zebra");
});

test("a category created in the open popup shows up (and is in view) even though the order is frozen, also after saving into another one", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Apple: 3000 })), categorySort: "lastUsed" }, "7BpCV");
  await row(extPage, "Zebra").locator(".btn-save").click(); // used now, but the open popup does not re-order for it, not even when the list is redrawn
  await expect(row(extPage, "Zebra")).toHaveClass(/is-saved/);
  await extPage.locator("#btn-new").click();
  await extPage.locator("#new-name").fill("Aardvark");
  await extPage.locator("#new-name").press("Enter");
  await expect(row(extPage, "Aardvark")).toBeVisible();
  const order = await names(extPage);
  expect(order[0], "the one used at opening is still first").toBe("Apple");
  expect(order.indexOf("Zebra"), "Zebra, used since, has not jumped up").toBeGreaterThan(order.indexOf("Berry"));
  expect(order).toContain("Aardvark");
  expect(await extPage.evaluate(() => { const l = document.getElementById("category-list").getBoundingClientRect(); const r = document.querySelector('.category-row[data-cat="Aardvark"]').getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }), "scrolled into view").toBe(true);
});

test("searching in Last used keeps the same relative order of what matches", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { ...notes({ "Pin A": [], "Pin B": [], "Pin C": [], Other: [] }, used({ "Pin C": 3000, "Pin A": 2000, Other: 5000 })), categorySort: "lastUsed" });
  await extPage.locator("#search").fill("pin");
  expect(await names(extPage)).toEqual(["Pin C", "Pin A", "Pin B"]);
});

test("renaming a category in an open Last used popup keeps its row where it was", async ({ extPage, seedStorage }) => {
  await openPopup({ extPage, seedStorage }, { ...notes(fruit(), used({ Zebra: 3000, Mango: 2000, Apple: 1000 })), categorySort: "lastUsed" });
  expect(await names(extPage)).toEqual(["Zebra", "Mango", "Apple", "Berry", "Pears"]);
  await row(extPage, "Mango").locator(".cat-name").dblclick();
  await nameInput(extPage).fill("Quince");
  await nameInput(extPage).press("Enter");
  await expect(row(extPage, "Quince")).toBeVisible();
  expect(await names(extPage), "same place, new name").toEqual(["Zebra", "Quince", "Apple", "Berry", "Pears"]);
});
