const { test, expect } = require("./fixtures");

const LICHESS_PUZZLE = "https://lichess.org/training/00008"; // any public puzzle; read-only, no login

// A training page opens "unowned" until its tab claims the session through the Resume chip (what a user's first
// visit after a closed tab or restart looks like). Claiming here keeps that path exercised by every overlay test.
// the [r, g, b] of an element's text colour, for checking which colour a figure or an icon is
const colourTriple = (loc) => loc.evaluate((el) => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number));

async function gotoTraining(page, url, options = { waitUntil: "domcontentloaded" }) {
  await page.goto(url, options);
  const chip = page.locator("#lpn-woodpecker-overlay .wpk-resume");
  const ready = page.locator("#lpn-woodpecker-overlay .wpk-panel, #lpn-woodpecker-overlay .wpk-collapsed");
  await expect(chip.or(ready).first()).toBeVisible({ timeout: 15_000 });
  if (await chip.count()) {
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(ready.first()).toBeVisible({ timeout: 15_000 });
  }
}

// One rule for a category's name, wherever it comes from (create, rename, import): a string of 1-60 characters that is
// not "__proto__" (which would rewrite the object's prototype instead of adding a key) and not "All Categories" (the name
// of the combined training run, which pausedCycles uses as a key).
const BAD_NAMES = ["__proto__", " __proto__ ", "All Categories", "all categories", "  ALL CATEGORIES  ", "x".repeat(61), "   ", ""];

test("the background refuses bad category names on create and on rename, not just on import", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Keep" });
  await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "abc12" });
  const before = (await getStorage("lichessNotes"));

  for (const name of BAD_NAMES) {
    const created = await send({ type: "CREATE_CATEGORY", name });
    expect(created.ok, `create ${JSON.stringify(name)} is refused`).toBe(false);
    expect(created.error, `create ${JSON.stringify(name)} says why`).toBeTruthy();
    const renamed = await send({ type: "RENAME_CATEGORY", oldName: "Keep", newName: name });
    expect(renamed.ok, `rename to ${JSON.stringify(name)} is refused`).toBe(false);
  }
  for (const odd of [null, undefined, 42, {}, ["a"]]) {
    expect((await send({ type: "CREATE_CATEGORY", name: odd })).ok, `create with ${JSON.stringify(odd)}`).toBe(false);
    expect((await send({ type: "RENAME_CATEGORY", oldName: "Keep", newName: odd })).ok, `rename to ${JSON.stringify(odd)}`).toBe(false);
  }
  const after = await getStorage("lichessNotes");
  expect(Object.keys(after.categories), "nothing was added, lost or renamed").toEqual(["Keep"]);
  expect(after.categories.Keep).toEqual(["abc12"]);
  expect(Object.keys(after.meta.categoryMeta || {})).toEqual(Object.keys(before.meta.categoryMeta || {}));

  const longest = "y".repeat(60);
  expect((await send({ type: "CREATE_CATEGORY", name: `  ${longest}  ` })).ok, "60 characters is fine, and is trimmed first").toBe(true);
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Keep", longest]);
  expect((await send({ type: "RENAME_CATEGORY", oldName: "Keep", newName: "Kept" })).ok).toBe(true);
});

// ---- The library is written by one place, one change at a time ----
// Every change used to be read-all, change, write-all, and several could run at once (a Save in the popup while a cycle's
// stats were being recorded, an import while a rename...), so the later write silently threw away the earlier one.

test("changes made at the same moment all survive: the background applies them one at a time", async ({ send, getStorage }) => {
  for (const c of ["A", "B", "C", "D"]) await send({ type: "CREATE_CATEGORY", name: c });
  const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(4, "0")}`.slice(0, 5));
  const unique = [...new Set(ids)];
  const results = await Promise.all(unique.map((id, i) => send({ type: "ADD_PUZZLE", category: ["A", "B", "C", "D"][i % 4], puzzleId: id })));
  expect(results.every((r) => r.ok), JSON.stringify(results.find((r) => !r.ok))).toBe(true);
  const stored = (await getStorage("lichessNotes")).categories;
  const have = Object.values(stored).flat().sort();
  expect(have, "every one of the concurrent saves is in the library").toEqual([...unique].sort());
});

test("recording a cycle's stats, saving puzzles and clearing stats at the same moment lose nothing", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "A" });
  const rec = (n) => ({ category: "A", timeTaken: 1000 * n, totalPuzzles: 5, correct: 3, incorrect: 1, skipped: 1, completedAt: 1_000_000 + n });
  const adds = Array.from({ length: 20 }, (_, i) => send({ type: "ADD_PUZZLE", category: "A", puzzleId: `q${String(i).padStart(2, "0")}aa`.slice(0, 5) }));
  const stats = Array.from({ length: 12 }, (_, i) => send({ type: "RECORD_STATS", stats: rec(i + 1) }));
  const all = await Promise.all([...adds, ...stats]);
  expect(all.every((r) => r.ok), JSON.stringify(all.find((r) => !r.ok))).toBe(true);
  const notes = await getStorage("lichessNotes");
  expect(notes.categories.A.length, "all 20 puzzles").toBe(20);
  expect(notes.meta.trainingStats.length, "all 12 stats records").toBe(12);
  expect(notes.meta.trainingStats[0].completedAt, "newest first").toBeGreaterThan(notes.meta.trainingStats[11].completedAt - 100);

  expect((await send({ type: "CLEAR_STATS" })).ok).toBe(true);
  const cleared = await getStorage("lichessNotes");
  expect(cleared.meta.trainingStats).toEqual([]);
  expect(cleared.categories.A.length, "clearing the statistics leaves the puzzles alone").toBe(20);
});

test("RECORD_STATS keeps only well-formed records, at most 50, newest first", async ({ send, getStorage }) => {
  const good = { category: "Forks", timeTaken: 5000, totalPuzzles: 4, correct: 2, incorrect: 1, skipped: 1, completedAt: 2_000_000 };
  for (const bad of [null, "x", 5, [], { ...good, category: 7 }, { ...good, category: "z".repeat(61) }, { ...good, correct: -1 }, { ...good, timeTaken: NaN }, { ...good, totalPuzzles: "4" }, { ...good, completedAt: Infinity }]) {
    expect((await send({ type: "RECORD_STATS", stats: bad })).ok, `refuses ${JSON.stringify(bad)}`).toBe(false);
  }
  expect((await send({ type: "RECORD_STATS", stats: { ...good, extra: "<img onerror=x>", __proto__: { x: 1 } } })).ok).toBe(true);
  expect(Object.keys((await getStorage("lichessNotes")).meta.trainingStats[0]).sort(), "unknown fields are dropped").toEqual(Object.keys(good).sort());
  await Promise.all(Array.from({ length: 60 }, (_, i) => send({ type: "RECORD_STATS", stats: { ...good, completedAt: 3_000_000 + i } })));
  const kept = (await getStorage("lichessNotes")).meta.trainingStats;
  expect(kept.length, "capped at 50").toBe(50);
});

test("reading never writes: an empty profile stays empty, and an unreadable value is backed up before anything replaces it", async ({ send, getStorage, extPage }) => {
  expect(await getStorage("lichessNotes")).toBeUndefined();
  const first = await send({ type: "GET_ALL_DATA" });
  expect(first.categories).toEqual({}); // defaults, in memory
  expect(await getStorage("lichessNotes"), "reading did not write the defaults").toBeUndefined();

  await extPage.evaluate(() => browser.storage.local.set({ lichessNotes: { junk: true } })); // present but not a library
  expect((await send({ type: "GET_ALL_DATA" })).categories).toEqual({});
  expect(await getStorage("lichessNotes"), "still untouched by a read").toEqual({ junk: true });
  expect(await getStorage("lichessNotesBackup"), "kept aside, so a later save cannot destroy the only copy").toEqual({ junk: true });
  expect((await send({ type: "CREATE_CATEGORY", name: "Fresh" })).ok).toBe(true);
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Fresh"]);
  expect(await getStorage("lichessNotesBackup")).toEqual({ junk: true });
});

test("a storage read that fails does not wipe the library: the change is refused and everything is still there", async ({ context, send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Precious" });
  await send({ type: "ADD_PUZZLE", category: "Precious", puzzleId: "abc12" });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const outcome = await sw.evaluate(async () => {
    const real = browser.storage.local.get;
    browser.storage.local.get = async () => { throw new Error("a transient storage failure"); };
    try { return { result: await createCategory("Another") }; } catch (e) { return { threw: String(e) }; } finally { browser.storage.local.get = real; }
  });
  expect(outcome.threw || outcome.result.ok === false, `the change is refused, not applied over defaults (${JSON.stringify(outcome)})`).toBeTruthy();
  const notes = await getStorage("lichessNotes");
  expect(Object.keys(notes.categories), "the library is untouched").toEqual(["Precious"]);
  expect(notes.categories.Precious).toEqual(["abc12"]);
});

// ---- The background does not trust what it is sent ----

test("names that exist only on every object (constructor, toString...) are not categories, and are not coerced from other types", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Keep" });
  await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "abc12" });
  const before = await getStorage("lichessNotes");
  for (const name of ["constructor", "toString", "hasOwnProperty", "valueOf", "__defineGetter__", "isPrototypeOf"]) {
    for (const [what, msg] of Object.entries({
      rename: { type: "RENAME_CATEGORY", oldName: name, newName: "Zed" },
      delete: { type: "DELETE_CATEGORY", name },
      add: { type: "ADD_PUZZLE", category: name, puzzleId: "zzz99" },
      remove: { type: "REMOVE_PUZZLE", category: name, puzzleId: "abc12" },
    })) expect((await send(msg)).ok, `${what} "${name}" is refused: there is no such category`).toBe(false);
  }
  // a category list or an object is not a name: it would be turned into one by the language (["Keep"] becomes "Keep")
  for (const odd of [["Keep"], { toString: "Keep" }, 5, null]) {
    for (const [what, msg] of Object.entries({
      rename: { type: "RENAME_CATEGORY", oldName: odd, newName: "Zed" },
      delete: { type: "DELETE_CATEGORY", name: odd },
      add: { type: "ADD_PUZZLE", category: odd, puzzleId: "zzz99" },
      remove: { type: "REMOVE_PUZZLE", category: odd, puzzleId: "abc12" },
    })) expect((await send(msg)).ok, `${what} with ${JSON.stringify(odd)} is refused`).toBe(false);
  }
  expect(await getStorage("lichessNotes"), "nothing changed").toEqual(before);

  // but a category that really is called "constructor" is an ordinary one
  expect((await send({ type: "CREATE_CATEGORY", name: "constructor" })).ok).toBe(true);
  expect((await send({ type: "ADD_PUZZLE", category: "constructor", puzzleId: "abc12" })).ok).toBe(true);
  expect((await send({ type: "RENAME_CATEGORY", oldName: "constructor", newName: "Plain" })).ok).toBe(true);
  expect((await send({ type: "DELETE_CATEGORY", name: "Plain" })).ok).toBe(true);
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Keep"]);
});

test("the background checks a puzzle ID itself: five letters or digits, as a string", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Keep" });
  for (const bad of ["", "abc1", "abc123", "abc 1", "../../", "ab<>1", 12345, null, undefined, {}, ["abc12"], true]) {
    const added = await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: bad });
    const removed = await send({ type: "REMOVE_PUZZLE", category: "Keep", puzzleId: bad });
    expect(added.ok, `add ${JSON.stringify(bad)} is refused`).toBe(false);
    expect(added.error, `add ${JSON.stringify(bad)} says the ID is wrong`).toContain("valid puzzle ID");
    expect(removed.ok, `remove ${JSON.stringify(bad)} is refused`).toBe(false);
    expect(removed.error, `remove ${JSON.stringify(bad)} says the ID is wrong, not that it was "not found"`).toContain("valid puzzle ID");
  }
  expect((await getStorage("lichessNotes")).categories.Keep, "nothing got in").toEqual([]);
  expect((await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "7BpCV" })).ok).toBe(true);
  expect((await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "7BpCV" })).duplicate, "a repeat is still reported as a duplicate").toBe(true);
  expect((await send({ type: "REMOVE_PUZZLE", category: "Keep", puzzleId: "7BpCV" })).ok).toBe(true);
});

test("the overlay (a content script on a web page) can record stats and ask about its session, but cannot change the library", async ({ context, send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Keep" });
  await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "abc12" });
  const before = await getStorage("lichessNotes");
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const asOverlay = (message) => sw.evaluate((m) => handleMessage(m, { url: "https://lichess.org/training/abc12", tab: { id: 7 } }), message);
  const asPage = (message) => sw.evaluate((m) => handleMessage(m, { url: `${browser.runtime.getURL("")}popup.html` }), message);

  const changes = [
    { type: "CREATE_CATEGORY", name: "Mine" }, { type: "RENAME_CATEGORY", oldName: "Keep", newName: "Gone" }, { type: "DELETE_CATEGORY", name: "Keep" },
    { type: "ADD_PUZZLE", category: "Keep", puzzleId: "zzz99" }, { type: "REMOVE_PUZZLE", category: "Keep", puzzleId: "abc12" }, { type: "CLEAR_STATS" },
    { type: "IMPORT_APPLY", payload: { app: "lichess-puzzle-saver", exportVersion: 1, data: { categories: { Evil: ["evil1"] } } } },
  ];
  for (const m of changes) expect((await asOverlay(m)).ok, `${m.type} from a web page's content script is refused`).toBe(false);
  expect(await getStorage("lichessNotes"), "the library is exactly as it was").toEqual(before);

  const record = { category: "Keep", timeTaken: 1000, totalPuzzles: 1, correct: 1, incorrect: 0, skipped: 0, completedAt: 5_000_000 };
  expect((await asOverlay({ type: "RECORD_STATS", stats: record })).ok, "it may record a finished cycle").toBe(true);
  expect(await asOverlay({ type: "GET_SESSION_ROLE" })).toHaveProperty("role");

  expect((await asPage({ type: "CREATE_CATEGORY", name: "Mine" })).ok, "the extension's own pages still can").toBe(true);
  expect((await asPage({ type: "CLEAR_STATS" })).ok).toBe(true);
});

test("opening the settings page reports it when that fails", async ({ context }) => {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const r = await sw.evaluate(async () => {
    const real = browser.runtime.openOptionsPage;
    browser.runtime.openOptionsPage = async () => { throw new Error("no window"); };
    try { return await handleMessage({ type: "OPEN_OPTIONS_PAGE" }, { url: `${browser.runtime.getURL("")}popup.html` }); }
    catch (e) { return { threw: String(e) }; } // the message listener turns a rejection into { ok: false, error }
    finally { browser.runtime.openOptionsPage = real; }
  });
  expect(r.ok === true, `not reported as a success (${JSON.stringify(r)})`).toBe(false);
});

test("the overlay runs on https://lichess.org/training only, not on a subdomain of it", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  await context.route("https://www.lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><main class=\"puzzle\"><div class=\"puzzle__moves\"></div></main></body></html>" }));
  await seedStorage(trainingSeed(["lightpage", "darkpage"], { currentIndex: 0 }));

  // The subdomain goes first: once a tab has claimed the session, every other tab is told "someone else owns it" and shows
  // nothing, which would make this pass whatever the address. An unclaimed session shows the Resume chip wherever the overlay runs.
  const sub = await context.newPage();
  await sub.goto("https://www.lichess.org/training/lightpage", { waitUntil: "domcontentloaded" });
  await sub.waitForTimeout(2000); // far longer than the overlay needs on the real address
  expect(await sub.locator("#lpn-woodpecker-overlay").count(), "no overlay, and so no Resume chip, on a subdomain").toBe(0);

  const home = await context.newPage();
  await gotoTraining(home, "https://lichess.org/training/lightpage"); // the real address: the overlay is there
  await expect(home.locator("#lpn-woodpecker-overlay")).toBeVisible();
});

// ---- Paused cycles: the background applies every change to the parked map, one at a time, to the latest map ----
// The popup and the overlay used to read the whole map, change it and write it all back, so a stale copy in one of them could
// drop another category's paused cycle.

const cyc = (category, extra = {}) => ({
  ownerTabId: null, category, queue: ["https://lichess.org/training/abc12", "https://lichess.org/training/def34"], currentIndex: 1,
  totalPuzzles: 2, completedInCycle: 1, correctInCycle: 1, incorrectInCycle: 0, skippedInCycle: 0, cycleCount: 1, isMinimized: false,
  timerStartedAt: 1_000_000, pausedAt: 2_000_000, ...extra,
});

test("paused cycles parked, taken out and renamed at the same moment all end up where they should", async ({ send, getStorage }) => {
  const names = ["C0", "C1", "C2", "C3", "C4", "C5"];
  for (const n of names) await send({ type: "CREATE_CATEGORY", name: n });
  const first = await Promise.all(names.map((n) => send({ type: "PARK_CYCLE", cycle: cyc(n) })));
  expect(first.every((r) => r.ok), JSON.stringify(first.find((r) => !r.ok))).toBe(true);
  expect(Object.keys((await getStorage("pausedCycles")) || {}).sort(), "six parked at once, none lost").toEqual(names);

  const burst = await Promise.all([
    send({ type: "UNPARK_CYCLE", category: "C0" }), send({ type: "UNPARK_CYCLE", category: "C1" }), send({ type: "UNPARK_CYCLE", category: "C2" }),
    send({ type: "PARK_CYCLE", cycle: cyc("All Categories") }), send({ type: "PARK_CYCLE", cycle: cyc("Late") }),
    send({ type: "RENAME_CATEGORY", oldName: "C4", newName: "C4x" }),
  ]);
  expect(burst.every((r) => r.ok), JSON.stringify(burst.find((r) => !r.ok))).toBe(true);
  expect(Object.keys((await getStorage("pausedCycles")) || {}).sort(), "every one of those changes landed").toEqual(["All Categories", "C3", "C4x", "C5", "Late"]);

  await Promise.all(["C3", "C4x", "C5", "Late", "All Categories"].map((c) => send({ type: "UNPARK_CYCLE", category: c })));
  expect(await getStorage("pausedCycles"), "the key goes away when none are left").toBeUndefined();
});

test("START_SESSION sets the running cycle and parks or unparks in one step, on top of whatever is parked now", async ({ send, getStorage }) => {
  await send({ type: "PARK_CYCLE", cycle: cyc("Keep") });
  await send({ type: "PARK_CYCLE", cycle: cyc("Resumed") });
  const session = (extra = {}) => ({ ownerTabId: 4, category: "Resumed", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 2, isMinimized: false, timerStartedAt: 1_500_000, ...extra });
  const r = await send({ type: "START_SESSION", session: session(), park: cyc("OldShape"), unpark: "Resumed" });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect((await getStorage("trainingSession")).category).toBe("Resumed");
  expect(Object.keys(await getStorage("pausedCycles")).sort(), "Keep untouched, OldShape parked, Resumed taken out").toEqual(["Keep", "OldShape"]);

  await send({ type: "UNPARK_CYCLE", category: "Keep" });
  await send({ type: "START_SESSION", session: session({ category: "Next" }), park: null, unpark: "OldShape" });
  expect(await getStorage("pausedCycles"), "nothing parked: the key is gone").toBeUndefined();
  expect((await getStorage("trainingSession")).category).toBe("Next");
});

test("the background checks a cycle before keeping it: sane numbers, and a queue that only leads to lichess.org/training", async ({ send, getStorage }) => {
  const bad = {
    "not an object": "x", "an array": [], "no category": cyc(""), "__proto__": cyc("__proto__"), "61 characters": cyc("z".repeat(61)), "a number as category": cyc(5),
    "queue off-site": cyc("A", { queue: ["https://evil.example/x"] }), "queue over http": cyc("A", { queue: ["http://lichess.org/training/abc12"] }),
    "queue with a path": cyc("A", { queue: ["https://lichess.org/training/abc12/../../settings"] }), "queue with another host": cyc("A", { queue: ["https://lichess.org.evil.example/training/abc12"] }),
    "queue not a list": cyc("A", { queue: "https://lichess.org/training/abc12" }), "empty queue": cyc("A", { queue: [] }), "a non-string in the queue": cyc("A", { queue: [5] }),
    "position past the end": cyc("A", { currentIndex: 9 }), "negative position": cyc("A", { currentIndex: -1 }), "fractional position": cyc("A", { currentIndex: 0.5 }),
    "NaN time": cyc("A", { timerStartedAt: NaN }), "no paused time": cyc("A", { pausedAt: undefined }), "owner not a tab id": cyc("A", { ownerTabId: "7" }),
  };
  for (const [what, cycle] of Object.entries(bad)) expect((await send({ type: "PARK_CYCLE", cycle })).ok, `PARK_CYCLE refuses ${what}`).toBe(false);
  expect(await getStorage("pausedCycles"), "nothing got in").toBeUndefined();

  const running = { ownerTabId: 4, category: "A", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: 1 };
  expect((await send({ type: "START_SESSION", session: { ...running, pausedAt: 5 }, park: null, unpark: null })).ok, "a running session is not paused").toBe(false);
  expect((await send({ type: "START_SESSION", session: running, park: cyc("B", { queue: ["https://evil.example/x"] }), unpark: null })).ok, "the cycle to park is checked too").toBe(false);
  expect((await send({ type: "START_SESSION", session: running, park: null, unpark: 7 })).ok, "unpark must name a category").toBe(false);
  expect(await getStorage("trainingSession"), "a refused start changes nothing").toBeUndefined();
  expect((await send({ type: "UNPARK_CYCLE", category: ["A"] })).ok).toBe(false);
  expect((await send({ type: "PARK_CYCLE", cycle: cyc("All Categories") })).ok, "the combined run is a fine key here").toBe(true);
});

test("the overlay may park and unpark a cycle, but only the extension's own pages may start a session", async ({ context, send, getStorage }) => {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const asOverlay = (message) => sw.evaluate((m) => handleMessage(m, { url: "https://lichess.org/training/abc12", tab: { id: 7 } }), message);
  expect((await asOverlay({ type: "PARK_CYCLE", cycle: cyc("Mine") })).ok).toBe(true);
  expect((await asOverlay({ type: "UNPARK_CYCLE", category: "Mine" })).ok).toBe(true);
  const running = { ownerTabId: 7, category: "A", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: 1 };
  expect((await asOverlay({ type: "START_SESSION", session: running, park: null, unpark: null })).ok, "starting a session is the popup's job").toBe(false);
  expect(await getStorage("trainingSession")).toBeUndefined();
});

// ---- The overlay cleans up after itself ----
// Counts the listeners the overlay (a content script, which lives in its own JavaScript world) has on window and document,
// through the DevTools protocol, which the page's own scripts cannot see.
async function overlayListeners(context, page, worlds) {
  const cdp = worlds.cdp;
  const mine = worlds.list.filter((w) => w.name === "Lichess Woodpecker").pop();
  const count = async (expression, type) => {
    const { result } = await cdp.send("Runtime.evaluate", { expression, contextId: mine.id });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
    return listeners.filter((l) => l.type === type).length;
  };
  return { resize: await count("window", "resize"), click: await count("document", "click"), keydown: await count("document", "keydown") };
}
async function watchWorlds(context, page) {
  const cdp = await context.newCDPSession(page);
  const list = [];
  cdp.on("Runtime.executionContextCreated", (e) => list.push(e.context));
  cdp.on("Runtime.executionContextDestroyed", (e) => { const i = list.findIndex((w) => w.id === e.executionContextId); if (i >= 0) list.splice(i, 1); });
  cdp.on("Runtime.executionContextsCleared", () => { list.length = 0; });
  await cdp.send("Runtime.enable");
  await page.reload({ waitUntil: "domcontentloaded" }); // so every world announces itself to this session
  return { cdp, list };
}

test("a detached overlay leaves no listeners behind, whether its session ended elsewhere or its Resume chip was dismissed", async ({ context, extPage, seedStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"]));
  const page = await context.newPage();
  await page.goto("https://lichess.org/training/lightpage", { waitUntil: "domcontentloaded" });
  const worlds = await watchWorlds(context, page);
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-resume").waitFor();

  const chip = await overlayListeners(context, page, worlds);
  expect(chip.resize + chip.keydown, "the probe can see the overlay's listeners at all").toBeGreaterThan(0);
  await overlay.locator(".wpk-resume-dismiss").click(); // dismissing the chip
  await expect(overlay).toHaveCount(0);
  expect(await overlayListeners(context, page, worlds), "dismissed chip: nothing left").toEqual({ resize: 0, click: 0, keydown: 0 });

  await page.reload({ waitUntil: "domcontentloaded" }); // the chip is back; this time claim and run
  await overlay.locator(".wpk-resume").click();
  await overlay.locator(".wpk-panel").waitFor();
  await page.waitForTimeout(300);
  const running = await overlayListeners(context, page, worlds);
  expect(running.click, "while running it listens for Lichess's Continue").toBeGreaterThan(0);
  await extPage.evaluate(() => browser.storage.local.remove("trainingSession")); // the session ends elsewhere, so this overlay detaches
  await expect(overlay).toHaveCount(0);
  expect(await overlayListeners(context, page, worlds), "detached overlay: nothing left").toEqual({ resize: 0, click: 0, keydown: 0 });
});

test("options page: confirming a rename without changing the name keeps the category and its puzzles", async ({ context, extensionUrl, send }) => {
  await send({ type: "CREATE_CATEGORY", name: "Mates" });
  await send({ type: "ADD_PUZZLE", category: "Mates", puzzleId: "abc12" });
  const page = await context.newPage();
  await page.goto(extensionUrl("options.html"));
  await page.click(".btn-rename");
  await page.click("#modal-confirm"); // the field is pre-filled with the current name; the user changes nothing
  await page.waitForTimeout(500);
  expect((await send({ type: "GET_ALL_DATA" })).categories).toEqual({ Mates: ["abc12"] });
});

test("category metadata: each category gets a distinct colour that survives rename, and saving never touches it", async ({ send, getStorage }) => {
  const meta = async () => (await getStorage("lichessNotes")).meta.categoryMeta || {};
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (const n of names) await send({ type: "CREATE_CATEGORY", name: n });

  // the first eight categories get eight different colours, and that is all that is stored for them
  let m = await meta();
  expect(new Set(names.map((n) => m[n].color)).size).toBe(8);
  expect(names.every((n) => Object.keys(m[n]).join() === "color")).toBe(true);

  // saving (even twice, or into a category that does not exist) writes nothing to the metadata
  const color = m.A.color;
  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "abc12" });
  await send({ type: "ADD_PUZZLE", category: "A", puzzleId: "abc12" });
  await send({ type: "ADD_PUZZLE", category: "Nope", puzzleId: "abc12" });
  m = await meta();
  expect(m.A).toEqual({ color });
  expect(m.Nope).toBeUndefined();

  // rename carries the colour; delete removes the entry
  expect(await send({ type: "RENAME_CATEGORY", oldName: "A", newName: "Z" })).toEqual({ ok: true });
  m = await meta();
  expect(m.Z).toEqual({ color });
  expect(m.A).toBeUndefined();
  await send({ type: "DELETE_CATEGORY", name: "Z" });
  expect((await meta()).Z).toBeUndefined();
});

test("renaming a category to the name it already has changes nothing", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Mates" });
  await send({ type: "ADD_PUZZLE", category: "Mates", puzzleId: "abc12" });
  expect(await send({ type: "RENAME_CATEGORY", oldName: "Mates", newName: "Mates" })).toEqual({ ok: true });
  expect(await send({ type: "RENAME_CATEGORY", oldName: "Mates", newName: "  Mates  " })).toEqual({ ok: true });
  const data = await getStorage("lichessNotes");
  expect(data.categories).toEqual({ Mates: ["abc12"] });
  expect(Number.isInteger(data.meta.categoryMeta.Mates.color)).toBe(true); // and its colour
});

test("a category from before colours existed keeps one colour through renames, and old data needs no metadata", async ({ send, extPage, seedStorage, getStorage }) => {
  await seedStorage({ lichessNotes: { categories: { Legacy: ["abc12"], Other: [] }, meta: { version: 1, updatedAt: 0 } } });
  // reading and saving never require the metadata to exist
  expect((await send({ type: "GET_ALL_DATA" })).categories.Legacy).toEqual(["abc12"]);
  expect(await send({ type: "RENAME_CATEGORY", oldName: "Legacy", newName: "Renamed" })).toEqual({ ok: true });
  const first = (await getStorage("lichessNotes")).meta.categoryMeta.Renamed.color;
  expect(Number.isInteger(first) && first >= 0 && first < 8).toBe(true);
  await send({ type: "RENAME_CATEGORY", oldName: "Renamed", newName: "Again" });
  expect((await getStorage("lichessNotes")).meta.categoryMeta.Again.color).toBe(first);
  // and the untouched legacy category was not given metadata just by being read or listed
  expect((await getStorage("lichessNotes")).meta.categoryMeta.Other).toBeUndefined();
});

test("service worker boots and returns default data", async ({ send }) => {
  const data = await send({ type: "GET_ALL_DATA" });
  expect(data.categories).toEqual({});
});

test("message API: categories and puzzles", async ({ send }) => {
  expect(await send({ type: "CREATE_CATEGORY", name: "Forks" })).toEqual({ ok: true });
  expect((await send({ type: "CREATE_CATEGORY", name: "forks" })).ok).toBe(false); // case-insensitive dup
  expect(await send({ type: "ADD_PUZZLE", category: "Forks", puzzleId: "abc12" })).toEqual({ ok: true });
  expect(await send({ type: "ADD_PUZZLE", category: "Forks", puzzleId: "abc12" })).toMatchObject({ ok: false, duplicate: true });
  expect(await send({ type: "REMOVE_PUZZLE", category: "Forks", puzzleId: "abc12" })).toEqual({ ok: true });
  expect(await send({ type: "DELETE_CATEGORY", name: "Forks" })).toEqual({ ok: true });
  expect((await send({ type: "GET_ALL_DATA" })).categories).toEqual({});
});

test("the puzzle ID is read from the page's DOM, never from its URL", async ({ context, extPage }) => {
  const src = await extPage.evaluate(() => extractPuzzleIdFromPage.toString());
  const run = (page) => page.evaluate(`(${src})()`);
  const link = (href, text) => `<a href="${href}">${text}</a>`;
  const page = await context.newPage();

  // no URL at all (about:blank): the markup alone is enough
  await page.setContent(`<p>Puzzle ${link("/training/abcDE", "#abcDE")}</p>`);
  expect(await run(page)).toBe("abcDE");

  // the URL names one puzzle, the page shows another: the page wins
  await context.route("https://lichess.org/training/zzzzz", (r) => r.fulfill({ contentType: "text/html", body: `<p>Puzzle ${link("/training/abcDE", "#abcDE")}</p>` }));
  await page.goto("https://lichess.org/training/zzzzz");
  expect(await run(page)).toBe("abcDE");

  // a URL that looks like a puzzle is not enough: no matching link in the page, no ID
  await context.route("https://lichess.org/training/qqqqq", (r) => r.fulfill({ contentType: "text/html", body: "<p>Something else</p>" }));
  await page.goto("https://lichess.org/training/qqqqq");
  expect(await run(page)).toBeNull();

  // Lichess's navigation links are on every page and must never read as a puzzle (note /training/daily is five letters)
  await page.setContent([link("/training/themes", "Puzzle Themes"), link("/training/dashboard/30", "Puzzle Dashboard"),
    link("/training/coordinate", "Coordinates"), link("/training/daily", "Puzzle of the day")].join(""));
  expect(await run(page)).toBeNull();

  // a link whose text disagrees with its href is rejected
  await page.setContent(link("/training/abcDE", "#abcDF"));
  expect(await run(page)).toBeNull();
});

test("puzzle ID extraction works against the live Lichess DOM", async ({ context, extPage }) => {
  // The popup normally injects this via chrome.scripting on a toolbar click, which
  // automation cannot trigger (activeTab is only granted by a real click). Pull the
  // shipped function out of the loaded extension and run it against the real markup,
  // so a Lichess DOM change still fails here.
  const page = await context.newPage();
  await page.goto(LICHESS_PUZZLE, { waitUntil: "domcontentloaded" });
  const src = await extPage.evaluate(() => extractPuzzleIdFromPage.toString());
  expect(await page.evaluate(`(${src})()`)).toBe("00008");
  // Correct/incorrect scoring falls back to this move list (a fresh profile has no session strip), so a
  // rename of it would silently degrade scoring.
  await expect(page.locator(".puzzle__moves move").first()).toBeVisible({ timeout: 15_000 });
  // With no URL gate, the DOM rule alone must reject every non-puzzle page, including ones that carry puzzle links.
  for (const url of ["https://lichess.org/analysis", "https://lichess.org/", "https://lichess.org/training/themes"]) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(`(${src})()`), url).toBeNull();
  }
});

test("options page: create, rename, delete category", async ({ context, extensionUrl, getStorage }) => {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(extensionUrl("options.html"));

  await page.click("#btn-new-category");
  await page.fill("#modal-input", "Mates");
  await page.click("#modal-confirm");
  await expect(page.locator(".category-card")).toHaveCount(1);
  await expect(page.locator("#toast")).toHaveText('Created "Mates"');
  expect(Object.keys((await getStorage("lichessNotes")).categories)).toEqual(["Mates"]);

  await page.click(".btn-rename");
  await page.fill("#modal-input", "Mates in 2");
  await page.click("#modal-confirm");
  await expect(page.locator(".category-card")).toContainText("Mates in 2");
  await expect(page.locator("#toast")).toHaveText('Renamed to "Mates in 2"');

  await page.click(".btn-delete-cat"); // two clicks: the first arms the bin (red), the second deletes
  await expect(page.locator(".btn-delete-cat")).toHaveClass(/armed/);
  await page.waitForTimeout(450);
  await page.click(".btn-delete-cat");
  await expect(page.locator(".category-card")).toHaveCount(0);
  await expect(page.locator("#toast")).toHaveText('Deleted "Mates in 2"');
  expect(errors).toEqual([]);
});

test("popup renders without errors", async ({ extPage }) => {
  const errors = [];
  extPage.on("pageerror", (e) => errors.push(e.message));
  await extPage.reload();
  await expect(extPage.locator("body")).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test("training overlay appears on a live lichess puzzle and can be closed", async ({ context, seedStorage, getStorage }) => {
  await seedStorage({
    lichessNotes: { categories: { Mates: ["00008", "00017"] }, meta: { version: 1, updatedAt: 0 } },
    trainingSession: {
      ownerTabId: null,
      category: "Mates", queue: [LICHESS_PUZZLE, "https://lichess.org/training/00017"],
      currentIndex: 0, completedInCycle: 0, totalPuzzles: 2, solvedInCycle: 0, skippedInCycle: 0,
      cycleCount: 1, timerStartedAt: Date.now() - 5000, isMinimized: false,
    },
  });
  const page = await context.newPage();
  await gotoTraining(page, LICHESS_PUZZLE, { waitUntil: "domcontentloaded" });

  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-panel")).toBeVisible({ timeout: 15_000 });
  await expect(overlay).toContainText("Mates");
  await expect(overlay.locator("[data-timer]")).toHaveText(/^0\d:\d\d$/);

  await overlay.locator(".wpk-btn-minimize").click();
  await expect(overlay.locator(".wpk-collapsed")).toBeVisible();
  await overlay.locator(".wpk-collapsed").click();

  await overlay.locator(".wpk-btn-close").click();
  await expect(overlay).toHaveCount(0);
  expect(await getStorage("trainingSession")).toBeUndefined();
});

test("overlay leaves Lichess's controls clickable, drags, and remembers where it was put", async ({ context, seedStorage, getStorage }) => {
  await seedStorage({
    lichessNotes: { categories: { Mates: ["00008", "00017"] }, meta: { version: 1, updatedAt: 0 } },
    trainingSession: {
      ownerTabId: null,
      category: "Mates", queue: [LICHESS_PUZZLE, "https://lichess.org/training/00017"],
      currentIndex: 0, completedInCycle: 0, totalPuzzles: 2, solvedInCycle: 0, skippedInCycle: 0,
      cycleCount: 1, timerStartedAt: Date.now() - 5000, isMinimized: false,
    },
  });
  const page = await context.newPage();
  await gotoTraining(page, LICHESS_PUZZLE, { waitUntil: "domcontentloaded" });

  const overlay = page.locator("#lpn-woodpecker-overlay");
  const panel = overlay.locator(".wpk-panel");
  const pill = overlay.locator(".wpk-collapsed");
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const covered = (locator) => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && !!top.closest("#lpn-woodpecker-overlay");
  });
  const viewportHeight = () => page.evaluate(() => document.documentElement.clientHeight);
  const near = (a, b) => expect(a).toBeCloseTo(b, 0);

  // Default corner: the controls the overlay used to sit on top of are the topmost element again.
  for (const target of [
    page.locator(".puzzle__controls"),
    page.locator(".puzzle__feedback"),
    page.getByRole("button", { name: "Get a hint" }),
  ]) {
    await target.waitFor({ timeout: 15_000 });
    expect(await covered(target)).toBe(false);
  }
  const home = await panel.boundingBox();
  near(home.x, 20);
  near(home.y + home.height, await viewportHeight() - 20);

  // Drag by the title bar. The box follows the pointer and the position is persisted.
  const bar = await overlay.locator(".wpk-titlebar").boundingBox();
  await page.mouse.move(bar.x + 30, bar.y + 10);
  await page.mouse.down();
  await page.mouse.move(bar.x + 30 + 400, bar.y + 10 - 150, { steps: 10 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  near(moved.x, home.x + 400);
  near(moved.y, home.y - 150);
  await expect.poll(() => getStorage("overlayPos")).toBeTruthy();
  const saved = await getStorage("overlayPos");
  near(saved.left, moved.x);
  near(saved.bottom, (await viewportHeight()) - (moved.y + moved.height));

  // Remembered across a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const reloaded = await panel.boundingBox();
  near(reloaded.x, moved.x);
  near(reloaded.y, moved.y);

  // A small window pulls it back on screen; restoring the window puts it back where the user left it.
  await page.setViewportSize({ width: 600, height: 400 });
  await expect.poll(async () => {
    const b = await panel.boundingBox();
    return b.x >= 0 && b.y >= 0 && b.x + b.width <= 600 && b.y + b.height <= 400;
  }).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await panel.boundingBox()).x).toBeCloseTo(moved.x, 0);

  // The minimized pill drags too, stays collapsed afterwards, and still expands on a plain click.
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(pill).toBeVisible();
  const p0 = await pill.boundingBox();
  await page.mouse.move(p0.x + p0.width / 2, p0.y + p0.height / 2);
  await page.mouse.down();
  await page.mouse.move(p0.x + p0.width / 2 + 100, p0.y + p0.height / 2 - 50, { steps: 10 });
  await page.mouse.up();
  await expect(pill).toBeVisible();
  const p1 = await pill.boundingBox();
  near(p1.x, p0.x + 100);
  near(p1.y, p0.y - 50);
  await pill.click();
  await expect(panel).toBeVisible();
});

// Lichess's end-of-puzzle markup as recorded live: the session strip's current entry gets result-true/false,
// a wrong move stays in the move list as move.fail, and only a puzzle the player finished gets a move.win.
const FINISHED = {
  clean: { strip: "result-true current", moves: ["good", "win"] },
  miss: { strip: "result-false current", moves: ["good", "fail", "good", "win"] },
  viewed: { strip: "result-false current", moves: ["good", "good"] },
  nostripClean: { strip: null, moves: ["good", "win"] },
  nostripMiss: { strip: null, moves: ["fail", "good", "win"] },
  nostripViewed: { strip: null, moves: ["good", "good"] },
  skipme: { strip: "result-cursor current", moves: [] },
  stale: { strip: "result-true current", moves: ["good", "win"] }, // a previous attempt's mark, about to be corrected
  lightpage: { strip: null, moves: [], bg: "#e8e5e2" }, // roughly Lichess's light theme
  darkpage: { strip: null, moves: [], bg: "#161512" }, // roughly Lichess's dark theme
};

// Serve fixture puzzle pages at the real URLs so the real content script injects into them.
async function serveFinishedPuzzles(context) {
  await context.route("https://lichess.org/training/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const { strip, moves, bg } = FINISHED[id] || FINISHED.skipme;
    const body = `<!doctype html><html><body${bg ? ` style="background:${bg}"` : ""}><main class="puzzle">
      <div class="puzzle__moves">${moves.map((c) => `<move class="${c}">x</move>`).join("")}</div>
      <div class="puzzle__feedback play">Your turn</div>
      ${strip ? `<div class="puzzle__session"><a class="${strip}" href="/training/mix/${id}"></a></div>` : ""}
    </main></body></html>`;
    return route.fulfill({ contentType: "text/html", body });
  });
}

// What Lichess does when the puzzle ends: the feedback panel is swapped for an "after" one with a Continue button.
const finishPuzzle = (page) => page.evaluate(() => {
  const after = document.createElement("div");
  after.className = "puzzle__feedback after";
  after.innerHTML = '<div class="complete">Success!</div><button class="continue">Continue training</button>';
  document.querySelector(".puzzle__feedback").replaceWith(after);
});

const trainingSeed = (ids, extra = {}) => ({
  autoNext: false, // these tests press Continue themselves; the auto-next tests turn it on
  lichessNotes: { categories: { Drill: ids }, meta: { version: 1, updatedAt: 0 } },
  trainingSession: {
    ownerTabId: null, // unowned until a tab claims it (see gotoTraining)
    category: "Drill", queue: ids.map((id) => `https://lichess.org/training/${id}`),
    currentIndex: 0, completedInCycle: 0, totalPuzzles: ids.length, cycleCount: 1,
    timerStartedAt: Date.now() - 60_000, isMinimized: false, ...extra,
  },
});

test("Continue advances one puzzle and records correct / incorrect / skipped", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "viewed", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-panel")).toBeVisible();

  // Re-render the overlay twice first: this used to stack one Continue handler per render.
  await overlay.locator(".wpk-btn-minimize").click();
  await overlay.locator(".wpk-collapsed").click();
  await expect(overlay.locator(".wpk-panel")).toBeVisible();

  for (const [from, to] of [["clean", "miss"], ["miss", "viewed"], ["viewed", "skipme"]]) {
    await finishPuzzle(page);
    await page.locator(".continue").click();
    await page.waitForURL(`**/training/${to}`, { timeout: 5_000 }).catch(() => {
      throw new Error(`Continue on "${from}" should advance exactly one puzzle to "${to}", landed on ${page.url()}`);
    });
    await expect(overlay.locator(".wpk-panel")).toBeVisible();
  }
  await expect(overlay.locator("[data-correct]")).toHaveText("1");
  await expect(overlay.locator("[data-incorrect]")).toHaveText("2");

  // Last puzzle: the overlay's own Skip ends the cycle and writes the stats record.
  await overlay.locator(".wpk-btn-skip").click();
  await expect.poll(async () => (await getStorage("lichessNotes")).meta.trainingStats?.length ?? 0).toBe(1);
  const [cycle] = (await getStorage("lichessNotes")).meta.trainingStats;
  expect(cycle).toMatchObject({ category: "Drill", totalPuzzles: 4, correct: 1, incorrect: 2, skipped: 1 });
  expect(cycle).not.toHaveProperty("solved");

  // The cycle ends on a score screen, not an instant rollover. Stats are already saved above.
  const results = overlay.locator(".wpk-result");
  await expect(results).toBeVisible();
  await expect(results.locator(".wpk-result-score")).toHaveText("25%");
  await expect(results.locator("[data-correct]")).toHaveText("1");
  await expect(results.locator("[data-incorrect]")).toHaveText("2");
  await expect(results.locator("[data-skipped]")).toHaveText("1");
  await expect(results.locator("[data-result-time]")).toHaveText(/^\d\d:\d\d$/);
  await expect(results.locator(".wpk-btn-next")).toHaveText("Repeat");
  expect(page.url()).toContain("/training/skipme");
  const done = await getStorage("trainingSession");
  expect(done).toMatchObject({ cycleCount: 1, completedInCycle: 4, correctInCycle: 1, incorrectInCycle: 2, skippedInCycle: 1 });
  expect(done.cycleFinishedAt).toBeGreaterThan(0);

  // Lichess's own Continue must not move past the score screen or change the counts.
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await page.waitForTimeout(300);
  expect(page.url()).toContain("/training/skipme");
  expect(await getStorage("trainingSession")).toMatchObject({ completedInCycle: 4, correctInCycle: 1, incorrectInCycle: 2 });

  // A reload on the score screen comes back to the score screen.
  await page.reload();
  await expect(overlay.locator(".wpk-result")).toBeVisible();

  // Options page: first-try accuracy is correct / total; rows saved before tracking show dashes.
  const lichessNotes = await getStorage("lichessNotes");
  lichessNotes.meta.trainingStats.push({ category: "Old", timeTaken: 1000, totalPuzzles: 5, solved: 4, skipped: 1, completedAt: 0 });
  await seedStorage({ lichessNotes });
  const options = await context.newPage();
  await options.goto(extensionUrl("options.html"));
  const [fresh, legacy] = [options.locator("#stats-tbody tr").nth(0), options.locator("#stats-tbody tr").nth(1)];
  await expect(fresh.locator(".correct")).toHaveText("1");
  await expect(fresh.locator(".incorrect")).toHaveText("2");
  await expect(fresh.locator(".skipped")).toHaveText("1");
  await expect(fresh.locator(".success-rate")).toHaveText("25%");
  for (const cell of [".correct", ".incorrect", ".success-rate"]) await expect(legacy.locator(cell)).toHaveText("—");
  await expect(legacy.locator(".skipped")).toHaveText("1");

  // Repeat (the next cycle): shuffled queue, zeroed counts, back to the training view.
  await overlay.locator(".wpk-btn-next").click();
  await expect(overlay.locator(".wpk-panel")).toBeVisible();
  await expect(overlay.locator(".wpk-result")).toHaveCount(0);
  const next = await getStorage("trainingSession");
  expect(next).toMatchObject({ cycleCount: 2, currentIndex: 0, completedInCycle: 0, correctInCycle: 0, incorrectInCycle: 0, skippedInCycle: 0 });
  expect(next).not.toHaveProperty("cycleFinishedAt");
  expect([...next.queue].sort()).toEqual(["clean", "miss", "viewed", "skipme"].map((id) => `https://lichess.org/training/${id}`).sort());
  expect(page.url()).toBe(next.queue[0]);
});

test("Exit on the score screen ends the session and frees Lichess's Continue", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/skipme");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-skip").click();
  await expect(overlay.locator(".wpk-result")).toBeVisible();

  // A listener on the button itself only hears the click if nothing upstream swallowed it.
  await finishPuzzle(page);
  await page.evaluate(() => { window.__clicks = 0; document.querySelector(".continue").addEventListener("click", () => window.__clicks++); });
  await page.locator(".continue").click();
  expect(await page.evaluate(() => window.__clicks)).toBe(0);

  await overlay.locator(".wpk-btn-exit").click();
  await expect(overlay).toHaveCount(0);
  expect(await getStorage("trainingSession")).toBeUndefined();
  expect((await getStorage("lichessNotes")).meta.trainingStats).toHaveLength(1);
  await page.locator(".continue").click();
  expect(await page.evaluate(() => window.__clicks)).toBe(1);
});

test("a minimized overlay pops open on the score screen when the cycle ends", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean"], { isMinimized: true }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-collapsed")).toBeVisible();
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await expect(overlay.locator(".wpk-result")).toBeVisible();
  await expect(overlay.locator(".wpk-result-score")).toHaveText("100%");
  expect(await getStorage("trainingSession")).toMatchObject({ isMinimized: false });
});

test("without Lichess's session strip, the move list decides correct vs incorrect", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["nostripClean", "nostripMiss", "nostripViewed"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/nostripClean");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await page.waitForURL("**/training/nostripMiss");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await page.waitForURL("**/training/nostripViewed");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await expect.poll(async () => (await getStorage("lichessNotes")).meta.trainingStats?.length ?? 0).toBe(1);
  expect((await getStorage("lichessNotes")).meta.trainingStats[0]).toMatchObject({ correct: 1, incorrect: 2, skipped: 0 });
});

test("the score screen keeps the overlay's frame and control positions, with the new content and Exit / Repeat in Restart / Skip's places", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  const ids = ["clean", "miss", "viewed", "skipme"];
  const box = (loc) => loc.boundingBox();
  const near = (a, b, what, tol = 1.5) => expect(Math.abs(a - b), what).toBeLessThanOrEqual(tol);

  // the training view: the reference for the frame and the control positions
  await seedStorage(trainingSeed(ids));
  let page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  let overlay = page.locator("#lpn-woodpecker-overlay");
  const t = {
    panel: await box(overlay.locator(".wpk-panel")), bar: await box(overlay.locator(".wpk-titlebar")), min: await box(overlay.locator(".wpk-btn-minimize")),
    close: await box(overlay.locator(".wpk-btn-close")), gear: await box(overlay.locator(".wpk-btn-settings")), skip: await box(overlay.locator(".wpk-btn-skip")), restart: await box(overlay.locator(".wpk-btn-restart")),
  };
  await page.close();

  // the finished cycle
  await seedStorage(trainingSeed(ids, { cycleFinishedAt: Date.now() - 1000, completedInCycle: 4, correctInCycle: 1, incorrectInCycle: 2, skippedInCycle: 1, timerStartedAt: Date.now() - 76_000 }));
  page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  overlay = page.locator("#lpn-woodpecker-overlay");
  const result = overlay.locator(".wpk-result");
  await expect(result).toBeVisible();

  // the frame is unchanged: same width, same title bar, and the same minimize and close buttons in the same places
  const r = { panel: await box(overlay.locator(".wpk-panel")), bar: await box(overlay.locator(".wpk-titlebar")), min: await box(overlay.locator(".wpk-btn-minimize")), close: await box(overlay.locator(".wpk-btn-close")) };
  near(r.panel.x, t.panel.x, "panel x"); near(r.panel.width, t.panel.width, "panel width");
  near(r.bar.x, t.bar.x, "title bar x"); near(r.bar.width, t.bar.width, "title bar width"); near(r.bar.height, t.bar.height, "title bar height");
  near(r.min.x - r.panel.x, t.min.x - t.panel.x, "minimize sits where it did"); near(r.close.x - r.panel.x, t.close.x - t.panel.x, "close sits where it did");
  await expect(overlay.locator(".wpk-titlebar .wpk-logo svg")).toBeVisible();

  // the new header: a green check, "Cycle 1 Complete", and the category with how many puzzles were processed
  const head = result.locator(".wpk-result-head");
  await expect(head.locator(".wpk-result-check svg")).toBeVisible();
  await expect(head.locator(".wpk-result-title")).toHaveText("Cycle 1 Complete");
  await expect(head.locator(".wpk-result-sub")).toHaveText("Drill · 4 puzzles processed");
  const [g1, g2, g3] = await colourTriple(head.locator(".wpk-result-check"));
  expect(g2 > g1 + 50 && g2 > g3 + 30, "the check is green").toBe(true);

  // three figures side by side, centred, each with its label beneath, in the colour system: green, red, amber
  const stats = result.locator(".wpk-stat");
  await expect(stats).toHaveCount(3);
  const boxes = await Promise.all([0, 1, 2].map((i) => box(stats.nth(i))));
  near(boxes[0].y, boxes[1].y, "figures share a row", 2); near(boxes[1].y, boxes[2].y, "figures share a row", 2);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 2); expect(boxes[2].x).toBeGreaterThan(boxes[1].x + boxes[1].width - 2);
  for (const [i, [label, key]] of [["Correct", "[data-correct]"], ["Incorrect", "[data-incorrect]"], ["Skipped", "[data-skipped]"]].entries()) {
    const stat = stats.nth(i);
    await expect(stat.locator(".wpk-stat-label")).toHaveText(label);
    const [n, l] = await Promise.all([box(stat.locator(key)), box(stat.locator(".wpk-stat-label"))]);
    expect(l.y, `${label} label is beneath its figure`).toBeGreaterThan(n.y + n.height - 2);
    near(n.x + n.width / 2, l.x + l.width / 2, `${label} is centred over its label`, 2);
  }
  const [cr, cg, cb] = await colourTriple(result.locator("[data-correct]")); expect(cg > cr + 50 && cg > cb + 30, "Correct is green").toBe(true);
  const [ir, ig, ib] = await colourTriple(result.locator("[data-incorrect]")); expect(ir > ig * 2 && ir > ib * 2, "Incorrect is red").toBe(true);
  const [sr, sg, sb] = await colourTriple(result.locator("[data-skipped]")); expect(sr > sg * 1.2 && sg > sb * 3 && sg > 60, "Skipped is amber").toBe(true);

  // two result rows: the label (with its icon) on the left, the value on the right
  const rows = result.locator(".wpk-result-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator(".wpk-result-label")).toHaveText("First-try accuracy");
  await expect(rows.nth(1).locator(".wpk-result-label")).toHaveText("Time taken");
  for (const i of [0, 1]) {
    await expect(rows.nth(i).locator(".wpk-result-label svg")).toBeVisible();
    const [lab, val, row] = await Promise.all([box(rows.nth(i).locator(".wpk-result-label")), box(rows.nth(i).locator("strong")), box(rows.nth(i))]);
    expect(val.x).toBeGreaterThan(lab.x + lab.width);
    near(val.x + val.width, row.x + row.width, "the value ends at the row's right edge", 2);
  }
  await expect(result.locator(".wpk-result-score")).toHaveText("25%");
  await expect(result.locator("[data-result-time]")).toHaveText("01:15"); // started 76s ago, frozen when the cycle finished 1s ago

  // the bottom row: the settings gear stays on the left; Exit and Repeat take Restart and Skip's places on the right
  const b = { gear: await box(overlay.locator(".wpk-btn-settings")), exit: await box(overlay.locator(".wpk-btn-exit")), next: await box(overlay.locator(".wpk-btn-next")) };
  near(b.gear.x, t.gear.x, "the gear stays where it was"); near(b.gear.width, t.gear.width, "gear width"); near(b.gear.height, t.gear.height, "gear height");
  near(b.next.x + b.next.width, t.skip.x + t.skip.width, "Repeat ends where Skip ended");
  expect(b.exit.x + b.exit.width).toBeLessThan(b.next.x);
  expect(b.exit.x).toBeGreaterThan(b.gear.x + b.gear.width);
  for (const [name, el] of [["Exit", b.exit], ["Repeat", b.next]]) near(el.height, t.skip.height, `${name} is as tall as Skip was`);
  await expect(overlay.locator(".wpk-btn-exit")).toHaveText("Exit");
  await expect(overlay.locator(".wpk-btn-exit svg")).toBeVisible(); // an icon before the word
  expect((await box(overlay.locator(".wpk-btn-exit svg"))).x).toBeLessThan((await box(overlay.locator(".wpk-btn-exit span"))).x);
  await expect(overlay.locator(".wpk-btn-next")).toHaveText("Repeat");
  await expect(overlay.locator(".wpk-btn-next svg")).toBeVisible();
  await expect(overlay.locator(".wpk-btn-restart, .wpk-btn-skip, .wpk-btn-pause")).toHaveCount(0); // replaced, not added to

  // the gear still opens the options page
  const [options] = await Promise.all([context.waitForEvent("page"), overlay.locator(".wpk-btn-settings").click()]);
  await expect(options).toHaveURL(/options\.html$/);
  await options.close();

  // minimize still works here: the pill shows, and the score screen comes back from it with the clock still frozen
  const shown = await result.locator("[data-result-time]").textContent();
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(overlay.locator(".wpk-collapsed")).toBeVisible();
  await page.waitForTimeout(1_200);
  await overlay.locator(".wpk-collapsed").click();
  await expect(result).toBeVisible();
  await expect(result.locator("[data-result-time]")).toHaveText(shown);
  expect((await getStorage("trainingSession")).cycleFinishedAt).toBeGreaterThan(0);

  // and the title-bar close ends the session
  await overlay.locator(".wpk-btn-close").click();
  await expect(overlay).toHaveCount(0);
  expect(await getStorage("trainingSession")).toBeUndefined();
});

test("the score screen follows the Lichess theme: its background is the training view's, light on a light page and dark on a dark one", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  const brightness = (loc) => loc.evaluate((el) => Math.min(...getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number)));
  for (const [id, light] of [["lightpage", true], ["darkpage", false]]) {
    await seedStorage(trainingSeed([id, "clean"]));
    let page = await context.newPage();
    await gotoTraining(page, `https://lichess.org/training/${id}`);
    const training = await brightness(page.locator("#lpn-woodpecker-overlay .wpk-panel"));
    await page.close();

    await seedStorage(trainingSeed([id, "clean"], { cycleFinishedAt: Date.now() - 1000, completedInCycle: 2, correctInCycle: 1 }));
    page = await context.newPage();
    await gotoTraining(page, `https://lichess.org/training/${id}`);
    const finished = await brightness(page.locator("#lpn-woodpecker-overlay .wpk-panel"));
    expect(finished, `${id}: the same background as the training view`).toBe(training);
    expect(light ? finished > 200 : finished < 60, `${id}: follows the page's theme`).toBe(true);
    await page.close();
  }
});

// ---- The finished-cycle celebration: a quiet decoration behind the score screen ----

// A finished cycle of 100 puzzles with `correct` of them right, so the accuracy is exactly `correct`%.
const finishedWith = (correct) => trainingSeed(["clean", "miss"], { cycleFinishedAt: Date.now() - 500, completedInCycle: 100, totalPuzzles: 100, correctInCycle: correct, incorrectInCycle: 100 - correct, skippedInCycle: 0, timerStartedAt: Date.now() - 60_000 });

test("the score screen celebrates by accuracy: confetti at 100%, sparkles from 70%, nothing from 50%, gentle rain below", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  const expected = { 100: "confetti", 99: "sparkles", 85: "sparkles", 70: "sparkles", 69: null, 60: null, 50: null, 49: "rain", 20: "rain", 0: "rain" };
  for (const [accuracy, kind] of Object.entries(expected)) {
    await seedStorage(finishedWith(Number(accuracy)));
    const page = await context.newPage();
    await gotoTraining(page, "https://lichess.org/training/clean");
    const overlay = page.locator("#lpn-woodpecker-overlay");
    await expect(overlay.locator(".wpk-result")).toBeVisible();
    await expect(overlay.locator(".wpk-result-score")).toHaveText(`${accuracy}%`);
    const fx = overlay.locator(".wpk-fx");
    if (kind) {
      await expect(fx, `${accuracy}% gets ${kind}`).toHaveAttribute("data-fx", kind);
      const bits = await fx.locator("span").count();
      expect(bits, `${kind} has enough pieces to be seen`).toBeGreaterThanOrEqual({ confetti: 24, sparkles: 18, rain: 16 }[kind]);
      expect(bits, `${kind} stays light`).toBeLessThanOrEqual(60);
    } else {
      await expect(fx, `${accuracy}% gets no animation`).toHaveCount(0);
    }
    await page.close();
  }
});

test("the celebration is only decoration: behind the content, never takes a click, kept faint, and it fades away by itself", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  for (const [accuracy, kind] of [[100, "confetti"], [85, "sparkles"], [20, "rain"]]) {
    await seedStorage(finishedWith(accuracy));
    const page = await context.newPage();
    await gotoTraining(page, "https://lichess.org/training/clean");
    const overlay = page.locator("#lpn-woodpecker-overlay");
    const fx = overlay.locator(".wpk-fx");
    await expect(fx).toHaveAttribute("data-fx", kind);

    // hidden from assistive technology, and behind everything that is read or pressed
    await expect(fx).toHaveAttribute("aria-hidden", "true");
    const layers = await overlay.evaluate((root) => {
      const fxEl = root.querySelector(".wpk-fx");
      const content = root.querySelector(".wpk-result-title");
      const z = (el) => { for (let n = el; n && n !== fxEl.parentElement.parentElement; n = n.parentElement) { const v = getComputedStyle(n).zIndex; if (v !== "auto") return Number(v); } return 0; };
      return { fx: Number(getComputedStyle(fxEl).zIndex), content: z(content), events: getComputedStyle(fxEl).pointerEvents, pieceOpacity: Math.max(...[...fxEl.children].map((c) => Number(getComputedStyle(c).opacity))) };
    });
    expect(layers.events, `${kind} takes no clicks`).toBe("none");
    expect(layers.fx, `${kind} sits behind the content`).toBeLessThan(layers.content);
    expect(layers.pieceOpacity, `${kind} is kept faint`).toBeLessThanOrEqual(0.9);

    // the buttons are really what is under the pointer, while the animation plays
    for (const sel of [".wpk-btn-next", ".wpk-btn-exit", ".wpk-btn-settings"]) {
      const reached = await overlay.locator(sel).evaluate((el, selector) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && !!hit.closest(selector); }, sel);
      expect(reached, `${sel} is not covered by the ${kind}`).toBe(true);
    }

    // it plays for roughly three to five seconds, then fades and is gone
    const seconds = parseFloat(await fx.evaluate((el) => getComputedStyle(el).animationDuration));
    expect(seconds, `${kind} lasts a few seconds`).toBeGreaterThanOrEqual(3);
    expect(seconds).toBeLessThanOrEqual(5);
    if (kind === "confetti") await expect(fx).toHaveCount(0, { timeout: 9_000 });
    await page.close();
  }
});

test("the sparkles are gentle but really visible: big enough, bright enough, and many at once, on both a dark and a light page", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  for (const id of ["darkpage", "lightpage"]) {
    await seedStorage({ ...finishedWith(85), ...trainingSeed([id, "clean"], { cycleFinishedAt: Date.now() - 300, completedInCycle: 100, totalPuzzles: 100, correctInCycle: 85, incorrectInCycle: 15, skippedInCycle: 0, timerStartedAt: Date.now() - 60_000 }) });
    const page = await context.newPage();
    await gotoTraining(page, `https://lichess.org/training/${id}`);
    const fx = page.locator("#lpn-woodpecker-overlay .wpk-fx");
    await expect(fx).toHaveAttribute("data-fx", "sparkles");

    // each star is big enough to notice (a speck of 10px dust is not), and drawn in a colour that stands out from the panel
    const stars = await fx.locator("span > i").evaluateAll((els) => els.map((el) => Math.min(el.offsetWidth, el.offsetHeight))); // layout size: the grow-in scale does not skew it
    expect(Math.min(...stars), `${id}: smallest star`).toBeGreaterThanOrEqual(13);
    expect(Math.max(...stars), `${id}: largest star`).toBeLessThanOrEqual(24); // gentle, not gaudy
    const look = await fx.locator("span").first().evaluate((el) => ({ glow: getComputedStyle(el).filter, star: getComputedStyle(el.querySelector("i")).backgroundColor }));
    expect(look.glow, `${id}: a soft glow lifts them off the panel`).toMatch(/drop-shadow/);

    // and at any moment several are clearly showing, not just one or two faint ones
    await expect.poll(
      () => fx.locator("span").evaluateAll((els) => els.filter((el) => Number(getComputedStyle(el).opacity) > 0.5).length),
      { message: `${id}: sparkles clearly showing at once`, timeout: 4_000, intervals: [200] },
    ).toBeGreaterThanOrEqual(6);
    await page.close();
  }
});

test("the celebration respects reduced motion, and does not replay when the overlay is minimized and reopened", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(finishedWith(100));

  const calm = await context.newPage();
  await calm.emulateMedia({ reducedMotion: "reduce" });
  await gotoTraining(calm, "https://lichess.org/training/clean");
  await expect(calm.locator("#lpn-woodpecker-overlay .wpk-result")).toBeVisible();
  await calm.waitForTimeout(500);
  await expect(calm.locator("#lpn-woodpecker-overlay .wpk-fx"), "no animation for people who asked for none").toHaveCount(0);
  await calm.close();

  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-fx")).toHaveAttribute("data-fx", "confetti");
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(overlay.locator(".wpk-collapsed")).toBeVisible();
  await overlay.locator(".wpk-collapsed").click();
  await expect(overlay.locator(".wpk-result")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await overlay.locator(".wpk-fx").count(), "reopening does not start it again").toBe(0); // checked right now: a replay would fade out and make a patient check pass
});

test("score screen buttons have their labels centered under Lichess's own button styles", async ({ context, seedStorage }) => {
  await seedStorage(trainingSeed(["00008"]));
  const page = await context.newPage();
  await gotoTraining(page, LICHESS_PUZZLE, { waitUntil: "domcontentloaded" });
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-skip").click({ timeout: 15_000 });
  await expect(overlay.locator(".wpk-result")).toBeVisible();

  // Offset of the label's middle from the button's middle, in px. A fixture page has no Lichess CSS, so this needs the live page.
  for (const sel of [".wpk-btn-next", ".wpk-btn-exit"]) {
    const off = await overlay.locator(sel).evaluate((btn) => {
      const range = document.createRange();
      range.selectNodeContents(btn);
      const text = range.getBoundingClientRect();
      const box = btn.getBoundingClientRect();
      return text.left + text.width / 2 - (box.left + box.width / 2);
    });
    expect(Math.abs(off), `${sel} label is ${off.toFixed(1)}px off center`).toBeLessThan(2);
  }
});

const autoSeed = (ids, extra) => ({ ...trainingSeed(ids, extra), autoNext: true });
// Counters only exist once they've been incremented, so absent means zero.
const sessionOf = async (getStorage) => {
  const s = await getStorage("trainingSession");
  return { ...s, correctInCycle: s.correctInCycle || 0, incorrectInCycle: s.incorrectInCycle || 0, skippedInCycle: s.skippedInCycle || 0 };
};

test("a correct solve moves on by itself; an incorrect one waits for Continue", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean", "miss", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();

  await finishPuzzle(page); // no click
  await page.waitForURL("**/training/miss", { timeout: 5_000 });
  expect(await sessionOf(getStorage)).toMatchObject({ correctInCycle: 1, incorrectInCycle: 0, currentIndex: 1 });

  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await page.waitForTimeout(2_500);
  expect(page.url()).toContain("/training/miss");
  expect(await sessionOf(getStorage)).toMatchObject({ incorrectInCycle: 0, currentIndex: 1 });
  await page.locator(".continue").click();
  await page.waitForURL("**/training/skipme", { timeout: 5_000 });
  expect(await sessionOf(getStorage)).toMatchObject({ correctInCycle: 1, incorrectInCycle: 1, currentIndex: 2 });
});

test("the Auto-next switch turns it off and the choice is remembered", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const box = page.locator("#lpn-woodpecker-overlay [data-autonext]");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => getStorage("autoNext")).toBe(false);

  await finishPuzzle(page);
  await page.waitForTimeout(2_500);
  expect(page.url()).toContain("/training/clean");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0 });

  await page.reload();
  await expect(box).not.toBeChecked();
  await finishPuzzle(page);
  await page.locator(".continue").click(); // the manual path still works with the switch off
  await page.waitForURL("**/training/skipme", { timeout: 5_000 });
});

test("a correct final puzzle goes straight to the score screen", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await expect(overlay.locator(".wpk-result-score")).toHaveText("100%", { timeout: 5_000 });
  expect((await getStorage("lichessNotes")).meta.trainingStats).toHaveLength(1);
});

test("pressing Continue during the pause counts once, and the pending jump does not count again", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean"])); // one puzzle: the click ends the cycle on this page, so a stray timer would still fire here
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-panel")).toBeVisible();
  await finishPuzzle(page);
  await page.locator(".continue").click();
  await expect(overlay.locator(".wpk-result")).toBeVisible();
  await page.waitForTimeout(2_000); // well past the 1s pause
  expect(await sessionOf(getStorage)).toMatchObject({ correctInCycle: 1, completedInCycle: 1, currentIndex: 1 });
  expect((await getStorage("lichessNotes")).meta.trainingStats).toHaveLength(1);
});

test("a verdict that turns out incorrect during the pause does not advance", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["stale", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/stale");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await finishPuzzle(page); // the strip still shows the previous attempt's result-true here
  await page.evaluate(() => setTimeout(() => { document.querySelector(".puzzle__session a").className = "result-false current"; }, 300));
  await page.waitForTimeout(2_500);
  expect(page.url()).toContain("/training/stale");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0 });
});

// Lichess's own "Jump to next puzzle immediately" swaps in a random puzzle ~0.3s after a finish, in the same
// page (the URL changes by pushState), so the content script keeps running on a puzzle that isn't in the session.
const lichessJumps = (page) => page.evaluate(() => {
  history.pushState({}, "", "/training/mix");
  const next = document.createElement("div");
  next.className = "puzzle__feedback play";
  next.textContent = "Your turn";
  document.querySelector(".puzzle__feedback").replaceWith(next);
});

for (const [name, from, counter] of [["correct", "clean", "correctInCycle"], ["incorrect", "miss", "incorrectInCycle"]]) {
  test(`when Lichess jumps off a ${name} puzzle by itself, it is counted and we go to the session's next puzzle`, async ({ context, seedStorage, getStorage }) => {
    await serveFinishedPuzzles(context);
    await seedStorage(trainingSeed([from, "skipme"])); // our Auto-next is off here: this must not depend on it
    const page = await context.newPage();
    await gotoTraining(page, `https://lichess.org/training/${from}`);
    await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
    await finishPuzzle(page);
    await page.waitForTimeout(100); // Lichess shows the finished panel briefly before it jumps
    await lichessJumps(page);
    await page.waitForURL("**/training/skipme", { timeout: 5_000 });
    expect(await sessionOf(getStorage)).toMatchObject({ [counter]: 1, currentIndex: 1 });
  });
}

test("leaving an unfinished puzzle is not counted as finishing it", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  await lichessJumps(page); // same page change, but the puzzle was never finished
  await page.waitForTimeout(1_500);
  expect(new URL(page.url()).pathname).toBe("/training/mix");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0, correctInCycle: 0, incorrectInCycle: 0 });
});

// ---- Theme and accessibility ----

test("the overlay follows the page's own light or dark look, including when it changes", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  for (const [id, light] of [["lightpage", true], ["darkpage", false], ["skipme", false]]) { // skipme: transparent page, so the dark fallback
    await seedStorage(trainingSeed([id]));
    const page = await context.newPage();
    await gotoTraining(page, `https://lichess.org/training/${id}`);
    const overlay = page.locator("#lpn-woodpecker-overlay");
    await expect(overlay.locator(".wpk-panel")).toBeVisible();
    if (light) await expect(overlay).toHaveClass(/wpk-light/); else await expect(overlay).not.toHaveClass(/wpk-light/);
    await page.close();
  }

  await seedStorage(trainingSeed(["lightpage"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/lightpage");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay).toHaveClass(/wpk-light/);
  await page.evaluate(() => { document.body.style.background = "#161512"; });
  await expect(overlay).not.toHaveClass(/wpk-light/);
  await page.evaluate(() => { document.body.style.background = "#e8e5e2"; });
  await expect(overlay).toHaveClass(/wpk-light/);
});

// WCAG contrast from the live computed colours: [text selector, background selector, minimum ratio]
const CONTRAST_PAIRS = {
  training: [
    [".wpk-info-label", ".wpk-panel", 4.5], [".wpk-info-value", ".wpk-panel", 4.5],
    ["[data-correct]", ".wpk-panel", 4.5], ["[data-incorrect]", ".wpk-panel", 4.5], ["[data-skipped]", ".wpk-panel", 4.5],
    [".wpk-titlebar-left span:last-child", ".wpk-titlebar", 4.5], [".wpk-timer-display", ".wpk-panel", 4.5],
    [".wpk-btn-restart", ".wpk-panel", 4.5], [".wpk-btn-pause", ".wpk-panel", 4.5], [".wpk-btn-skip", ".wpk-btn-skip", 4.5],
    [".wpk-tooltip", ".wpk-tooltip", 4.5],
  ],
  paused: [
    [".wpk-info-label", ".wpk-panel", 4.5], [".wpk-info-value", ".wpk-panel", 4.5], ["[data-correct]", ".wpk-panel", 4.5],
    ["[data-incorrect]", ".wpk-panel", 4.5], ["[data-skipped]", ".wpk-panel", 4.5],
    [".wpk-btn-play", ".wpk-panel", 4.5], [".wpk-paused-tag", ".wpk-panel", 4.5], [".wpk-titlebar-left span:last-child", ".wpk-titlebar", 4.5],
    [".wpk-timer-display", ".wpk-panel", 4.5], [".wpk-btn-skip", ".wpk-btn-skip", 4.5],
  ],
  results: [
    [".wpk-result-title", ".wpk-panel", 4.5], [".wpk-result-sub", ".wpk-panel", 4.5], [".wpk-stat-label", ".wpk-panel", 4.5],
    ["[data-correct]", ".wpk-panel", 4.5], ["[data-incorrect]", ".wpk-panel", 4.5], ["[data-skipped]", ".wpk-panel", 4.5],
    [".wpk-result-label", ".wpk-panel", 4.5], [".wpk-result-score", ".wpk-panel", 4.5], ["[data-result-time]", ".wpk-panel", 4.5],
    [".wpk-btn-next", ".wpk-btn-next", 4.5], [".wpk-btn-exit", ".wpk-btn-exit", 4.5],
  ],
  pill: [[".wpk-collapsed-progress", ".wpk-collapsed", 4.5], [".wpk-collapsed-timer", ".wpk-collapsed", 4.5]],
  question: [
    [".wpk-confirm-text", ".wpk-confirm", 4.5], [".wpk-confirm-cancel", ".wpk-confirm", 4.5], [".wpk-confirm-yes", ".wpk-confirm-yes", 4.5],
  ],
};

for (const [theme, id] of [["dark", "darkpage"], ["light", "lightpage"]]) {
  test(`every piece of text on the overlay is readable in the ${theme} look`, async ({ context, seedStorage }) => {
    await serveFinishedPuzzles(context);
    const page = await context.newPage();
    const overlay = page.locator("#lpn-woodpecker-overlay");
    const failures = [];
    for (const [view, extra] of [["training", {}], ["results", { cycleFinishedAt: Date.now() - 1000, completedInCycle: 1, correctInCycle: 1 }], ["pill", { isMinimized: true }], ["paused", {}], ["question", {}]]) {
      await seedStorage(trainingSeed([id], extra));
      await gotoTraining(page, `https://lichess.org/training/${id}`);
      await expect(overlay.locator(view === "pill" ? ".wpk-collapsed" : ".wpk-panel")).toBeVisible();
      if (view === "question") {
        await overlay.locator(".wpk-btn-restart").click();
        await expect(overlay.locator(".wpk-confirm")).toBeVisible();
      }
      if (view === "paused") {
        await overlay.locator(".wpk-btn-pause").click();
        await expect(overlay.locator(".wpk-paused")).toBeVisible();
      }
      const ratios = await overlay.evaluate((root, pairs) => {
        const rgba = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
        return pairs.map(([text, bg, min]) => {
          const t = root.querySelector(text), b = root.querySelector(bg);
          if (!t || !b) return { text, missing: true, min };
          return { text, ratio: ratio(rgba(getComputedStyle(t).color), rgba(getComputedStyle(b).backgroundColor)), min };
        });
      }, CONTRAST_PAIRS[view]);
      for (const r of ratios) if (r.missing || r.ratio < r.min) failures.push(`${theme}/${view} ${r.text}: ${r.missing ? "not found" : r.ratio.toFixed(2)} (needs ${r.min})`);
    }
    expect(failures).toEqual([]);
  });
}

test("the overlay is usable and understandable without a mouse", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/lightpage");
  await expect(page.getByRole("region", { name: "Woodpecker training" })).toBeVisible();
  for (const name of ["Minimize", "End session", "Open options"]) await expect(page.getByRole("button", { name })).toBeVisible();

  // keyboard focus is visible
  const minimize = page.getByRole("button", { name: "Minimize" });
  await minimize.focus();
  expect(await minimize.evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0; })).toBe(true);

  // collapse and expand with the keyboard only
  await page.keyboard.press("Enter");
  const pill = page.getByRole("button", { name: /Show training panel, 0 of 2/ });
  await expect(pill).toBeVisible();
  await pill.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible();
});

// ---- Timer row: icon-only Pause, a roomy Restart, and tooltips ----

async function timerRowSetup({ context, seedStorage }, extraSeed = {}) {
  await serveFinishedPuzzles(context);
  await seedStorage({ ...trainingSeed(["lightpage", "darkpage"]), ...extraSeed });
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/lightpage");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-btn-restart")).toBeVisible();
  return { page, overlay, tip: overlay.locator(".wpk-tooltip") };
}

test("the controls are two compact rows: timer and Pause, then Settings with Restart and Skip", async ({ context, seedStorage }) => {
  const { overlay } = await timerRowSetup({ context, seedStorage });
  const pause = overlay.locator(".wpk-btn-pause"), restart = overlay.locator(".wpk-btn-restart");
  const skip = overlay.locator(".wpk-btn-skip"), settings = overlay.locator(".wpk-btn-settings");

  expect((await pause.innerText()).trim()).toBe(""); // an icon, not a word
  await expect(pause.locator("svg")).toBeVisible();
  await expect(pause).toHaveAccessibleName(/^Pause/);
  await expect(restart).toHaveText("Restart");
  await expect(restart.locator("svg")).toBeVisible();
  await expect(restart).toHaveAccessibleName(/^Restart/);
  await expect(skip).toHaveText("Skip");
  await expect(skip.locator("svg polygon")).toHaveCount(1); // skip-forward (a triangle and a bar), no longer the circled play
  await expect(skip.locator("svg circle")).toHaveCount(0);
  await expect(overlay.locator(".wpk-btn-reset")).toHaveCount(0); // "Reset" is gone

  const [t, p, st, r, k] = await Promise.all([overlay.locator("[data-timer]"), pause, settings, restart, skip].map((l) => l.boundingBox()));
  const mid = (b) => b.y + b.height / 2;
  // row one: the timer on the left, Pause on the right
  expect(Math.abs(mid(p) - mid(t))).toBeLessThan(4);
  expect(p.x).toBeGreaterThan(t.x + t.width);
  // row two, below it: Settings on the left, then Restart, then Skip on the right
  expect(st.y).toBeGreaterThan(p.y + p.height - 1);
  for (const b of [r, k]) expect(Math.abs(mid(b) - mid(st))).toBeLessThan(2);
  expect(st.x + st.width).toBeLessThan(r.x);
  expect(r.x + r.width).toBeLessThan(k.x);
  expect(Math.abs(k.x + k.width - (p.x + p.width))).toBeLessThan(2); // Skip and Pause end on the same right edge
  // compact: every button the same height, and Skip is no longer a full-width bar
  for (const b of [p, st, r, k]) expect(Math.abs(b.height - 34)).toBeLessThan(1.5);
  expect(k.width).toBeLessThan(100);
  expect(r.width).toBeLessThan(120);

  // Skip is a muted blue, not red
  const [red, green, blue] = (await skip.evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g).map(Number);
  expect(blue).toBeGreaterThan(red + 30);
  expect(blue).toBeGreaterThan(green);
  await expect(settings.locator("svg")).toBeVisible();
});

test("pausing a Train all cycle keeps it: it is parked as All Categories, and the popup's Train all carries on from the same puzzle", async ({ context, extensionUrl, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"], { category: "All Categories", currentIndex: 1, completedInCycle: 1, correctInCycle: 1, timerStartedAt: Date.now() - 120_000 }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/darkpage");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await expect(overlay.locator(".wpk-btn-pause"), "Train all has Pause, like any category").toBeVisible();
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-btn-play")).toBeVisible();
  await expect.poll(async () => ((await getStorage("pausedCycles")) || {})["All Categories"]?.pausedAt ?? 0, { message: "parked under All Categories" }).toBeGreaterThan(0);
  expect(await getStorage("trainingSession"), "and nothing left running").toBeFalsy();
  expect((await getStorage("pausedCycles"))["All Categories"]).toMatchObject({ category: "All Categories", currentIndex: 1, completedInCycle: 1, correctInCycle: 1, ownerTabId: null });

  // the popup's Train all picks it up where it was
  const popup = await context.newPage();
  await popup.goto(extensionUrl("popup.html"));
  await popup.evaluate(() => { window.close = () => {}; });
  await expect(popup.locator("#btn-train-all")).toHaveAttribute("title", /paused cycle is waiting/);
  await popup.locator("#btn-train-all").click();
  await popup.waitForURL(/\/training\/darkpage$/);
  const resumed = await getStorage("trainingSession");
  expect(resumed).toMatchObject({ category: "All Categories", currentIndex: 1, completedInCycle: 1, correctInCycle: 1 });
  expect(resumed.pausedAt).toBeUndefined();
  expect(await getStorage("pausedCycles"), "nothing left parked").toBeFalsy();
});

test("Restart asks first, in the overlay itself, and only then starts the cycle over", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1, timerStartedAt: Date.now() - 120_000 }));
  const page = await context.newPage();
  let nativeDialogs = 0; // a native confirm() can be suppressed (background tab, "prevent more dialogs", automation) and then reads as "no"
  page.on("dialog", (d) => { nativeDialogs++; d.dismiss(); });
  await gotoTraining(page, "https://lichess.org/training/darkpage");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  const restart = overlay.locator(".wpk-btn-restart"), ask = overlay.locator(".wpk-confirm");
  const before = await getStorage("trainingSession");

  // Cancel: nothing changes, and focus goes back to Restart
  await restart.click();
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAccessibleName(/restart/i);
  await expect(ask).toContainText("Restart this cycle from puzzle 1");
  await expect(ask.locator(".wpk-confirm-cancel")).toBeFocused(); // the safe answer is the default
  await ask.locator(".wpk-confirm-cancel").click();
  await expect(ask).toHaveCount(0);
  await expect(restart).toBeFocused();
  // Escape cancels as well
  await restart.click();
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await page.waitForTimeout(600); // long enough for a wrongly-unconditional restart to have saved and navigated
  expect(await getStorage("trainingSession")).toEqual(before);
  await expect(page).toHaveURL(/\/training\/darkpage/);

  // Confirm: the cycle starts over
  await restart.click();
  await ask.locator(".wpk-confirm-yes").click();
  await expect(page).toHaveURL(/\/training\/lightpage/);
  const s = await getStorage("trainingSession");
  expect(s).toMatchObject({ currentIndex: 0, completedInCycle: 0, correctInCycle: 0, incorrectInCycle: 0, skippedInCycle: 0 });
  expect(Date.now() - s.timerStartedAt).toBeLessThan(10_000);
  expect(nativeDialogs).toBe(0);
});

test("hovering a button shows a tooltip and makes the button look different", async ({ context, seedStorage }) => {
  const { page, overlay, tip } = await timerRowSetup({ context, seedStorage });
  const look = (l) => l.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopColor, s.color].join("|"); });
  const vp = page.viewportSize();

  for (const [selector, words] of [
    [".wpk-btn-pause", /pause/i], [".wpk-btn-restart", /puzzle 1/i], [".wpk-btn-settings", /options/i],
    [".wpk-btn-skip", /skipped/i], [".wpk-btn-minimize", /minimize/i], [".wpk-btn-close", /end session/i],
  ]) {
    const btn = overlay.locator(selector);
    await page.mouse.move(2, 2); // pointer away from everything
    await expect(tip, `${selector} at rest`).toBeHidden();
    const rest = await look(btn);
    await btn.hover();
    await expect(tip, `${selector} hovered`).toBeVisible();
    await expect(tip).toHaveText(words);
    await expect.poll(() => look(btn), { message: `${selector} looks different on hover` }).not.toBe(rest);
    const [b, t] = await Promise.all([btn.boundingBox(), tip.boundingBox()]);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x + t.width).toBeLessThanOrEqual(vp.width);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y + t.height <= b.y || t.y >= b.y + b.height, `${selector}: the tooltip must not cover its button`).toBe(true);
  }
  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden();
  await expect(overlay.locator("[title]")).toHaveCount(0); // no second, native tooltip on top of ours
});

test("the tooltip shows on keyboard focus and Escape dismisses it", async ({ context, seedStorage }) => {
  const { page, overlay, tip } = await timerRowSetup({ context, seedStorage });
  await expect(tip).toBeHidden();
  await overlay.locator(".wpk-btn-pause").focus();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(/pause/i);
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await overlay.locator(".wpk-btn-restart").focus();
  await expect(tip).toHaveText(/puzzle 1/i);
  await overlay.locator(".wpk-btn-skip").focus();
  await expect(tip).toHaveText(/skipped/i);
  await overlay.locator(".wpk-btn-skip").blur();
  await expect(tip).toBeHidden();
});

test("a tooltip does not linger after the button it described has gone", async ({ context, seedStorage }) => {
  const { page, overlay, tip } = await timerRowSetup({ context, seedStorage });
  // By keyboard: removing a focused button fires no blur, so nothing else would hide the tooltip.
  await overlay.locator(".wpk-btn-pause").focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Enter"); // the whole overlay is rebuilt as the paused view
  await expect(overlay.locator(".wpk-paused")).toBeVisible();
  await expect(tip).toBeHidden();
  await expect(tip).toHaveCount(1); // and the one tooltip element is still there for the next hover
});

test("tooltips stay on screen when the overlay is dragged to the right edge or to the top", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  const probe = await context.newPage();
  const vp = probe.viewportSize();
  await probe.close();

  // far right: a centred tooltip would hang off the screen, so it is nudged back in
  let { page, overlay, tip } = await timerRowSetup({ context, seedStorage }, { overlayPos: { left: vp.width - 304, bottom: 20 } });
  const panelRight = (await overlay.locator(".wpk-panel").boundingBox());
  expect(panelRight.x + panelRight.width).toBeGreaterThan(vp.width - 12); // really at the edge
  await overlay.locator(".wpk-btn-skip").hover();
  await expect(tip).toBeVisible();
  let t = await tip.boundingBox();
  expect(t.x + t.width).toBeLessThanOrEqual(vp.width - 4);
  const r = await overlay.locator(".wpk-btn-skip").boundingBox();
  expect(t.x).toBeLessThan(r.x + r.width); // still next to the button it describes
  await page.close();

  // top of the screen: no room above the title bar buttons, so the tooltip goes below
  ({ page, overlay, tip } = await timerRowSetup({ context, seedStorage }, { overlayPos: { left: 20, bottom: 10_000 } }));
  expect((await overlay.locator(".wpk-panel").boundingBox()).y).toBeLessThan(40);
  const min = overlay.locator(".wpk-btn-minimize");
  await min.hover();
  await expect(tip).toBeVisible();
  t = await tip.boundingBox();
  const m = await min.boundingBox();
  expect(t.y).toBeGreaterThanOrEqual(m.y + m.height);
  expect(t.y).toBeGreaterThanOrEqual(0);
});

// ---- The paused look: the same panel in the same places, with clear signs that it is paused ----

const STAYS_PUT = [".wpk-panel", ".wpk-titlebar", ".wpk-progress-bar", ".wpk-progress-text", "[data-correct]", ".wpk-auto-row", "[data-timer]", ".wpk-btn-settings", ".wpk-btn-restart", ".wpk-btn-skip"];
const parked = async (getStorage) => (await getStorage("pausedCycles")) || {};

test("pausing changes how the overlay looks, but nothing moves", async ({ context, seedStorage }) => {
  const { page, overlay } = await timerRowSetup({ context, seedStorage });
  const measure = async (toggle) => {
    const out = {};
    for (const sel of [...STAYS_PUT, toggle]) out[sel] = await overlay.locator(sel).first().boundingBox();
    return out;
  };
  const running = await measure(".wpk-btn-pause");

  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-btn-play")).toBeVisible();
  await page.mouse.move(2, 2); // the pointer is still over where Pause was; Play grows when hovered
  await expect.poll(async () => (await overlay.locator(".wpk-btn-play").boundingBox()).width).toBeLessThan(40);
  const paused = await measure(".wpk-btn-play");

  const pairs = [...STAYS_PUT.map((s) => [s, s]), [".wpk-btn-pause", ".wpk-btn-play"]];
  for (const [before, after] of pairs) {
    for (const k of ["x", "y", "width", "height"]) {
      expect(Math.abs(paused[after][k] - running[before][k]), `${before} → ${after}: ${k}`).toBeLessThanOrEqual(1);
    }
  }
});

test("a paused overlay says so: title, progress tag and bar, green Play, greyed Skip and Auto-next", async ({ context, seedStorage }) => {
  const { overlay } = await timerRowSetup({ context, seedStorage });
  const bar = overlay.locator(".wpk-progress-fill");
  const barRunning = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect(overlay.locator("[data-title]")).not.toHaveText("Paused");
  await expect(overlay.locator(".wpk-paused-tag")).toHaveCount(0);
  await expect(overlay.locator(".wpk-btn-skip")).not.toHaveAttribute("aria-disabled", "true");
  await expect(overlay.locator("[data-autonext]")).toBeEnabled();

  await overlay.locator(".wpk-btn-pause").click();
  const play = overlay.locator(".wpk-btn-play");
  await expect(play).toBeVisible();
  await expect(overlay.locator("[data-title]")).toHaveText("Paused");
  await expect(overlay.locator(".wpk-progress-text .wpk-paused-tag")).toHaveText("Paused");
  expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(barRunning); // the bar changes colour too
  await expect(overlay.locator(".wpk-btn-skip")).toHaveAttribute("aria-disabled", "true");
  await expect(overlay.locator("[data-autonext]")).toBeDisabled();
  await expect(play).toHaveAccessibleName(/^Continue/);
  const [r, g, b] = (await play.evaluate((el) => getComputedStyle(el).color)).match(/\d+/g).map(Number);
  expect(g).toBeGreaterThan(r + 40); // green
  expect(g).toBeGreaterThan(b);

  await play.click(); // Continue: the page reloads on the unfinished puzzle, running again
  await expect(overlay.locator(".wpk-btn-pause")).toBeVisible();
  await expect(overlay.locator(".wpk-paused-tag")).toHaveCount(0);
  await expect(overlay.locator("[data-title]")).not.toHaveText("Paused");
  await expect(overlay.locator(".wpk-btn-skip")).not.toHaveAttribute("aria-disabled", "true");
  await expect(overlay.locator("[data-autonext]")).toBeEnabled();
});

test("the Play button grows to say Continue on hover and on keyboard focus, to the left", async ({ context, seedStorage }) => {
  const { page, overlay } = await timerRowSetup({ context, seedStorage });
  await overlay.locator(".wpk-btn-pause").click();
  const play = overlay.locator(".wpk-btn-play"), label = overlay.locator(".wpk-play-label");
  const width = async () => (await play.boundingBox()).width;
  const labelOpacity = () => label.evaluate((el) => getComputedStyle(el).opacity);

  await page.mouse.move(2, 2);
  await expect.poll(width).toBeLessThan(40);
  expect(await labelOpacity()).toBe("0"); // an icon at rest
  const rest = await play.boundingBox();

  await play.hover();
  await expect.poll(width).toBeGreaterThan(90);
  await expect.poll(labelOpacity).toBe("1");
  await expect(label).toHaveText("Continue");
  const hot = await play.boundingBox();
  expect(Math.abs(hot.x + hot.width - (rest.x + rest.width))).toBeLessThan(1.5); // the right edge stays put
  const timer = await overlay.locator("[data-timer]").boundingBox();
  expect(hot.x).toBeGreaterThan(timer.x + timer.width); // and it never runs into the clock

  await page.mouse.move(2, 2);
  await expect.poll(width).toBeLessThan(40);
  await page.keyboard.press("Shift"); // a keyboard user: focus now counts as :focus-visible
  await play.focus();
  await expect.poll(width).toBeGreaterThan(90);
  await play.blur();
  await expect.poll(width).toBeLessThan(40);
});

test("Skip does nothing while paused, by mouse or keyboard", async ({ context, seedStorage, getStorage }) => {
  const { page, overlay } = await timerRowSetup({ context, seedStorage });
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-btn-play")).toBeVisible();
  const saved = await parked(getStorage);
  const skip = overlay.locator(".wpk-btn-skip");

  await skip.click({ force: true }); // aria-disabled, so a real click is still possible
  await skip.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  expect(await parked(getStorage)).toEqual(saved); // no skipped count, no new position
  expect(await getStorage("trainingSession")).toBeUndefined();
  await expect(page).toHaveURL(/\/training\/lightpage/);
  await skip.hover();
  await expect(overlay.locator(".wpk-tooltip")).toHaveText(/paused/i); // and it says why
});

test("Restart while paused asks first, then starts the cycle over and running", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1, timerStartedAt: Date.now() - 120_000 }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/darkpage");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  const ask = overlay.locator(".wpk-confirm");
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-btn-play")).toBeVisible();
  const saved = await parked(getStorage);

  await overlay.locator(".wpk-btn-restart").click();
  await ask.locator(".wpk-confirm-cancel").click();
  await page.waitForTimeout(600);
  expect(await parked(getStorage)).toEqual(saved); // declined: still parked, still paused
  await expect(overlay.locator(".wpk-btn-play")).toBeVisible();
  await expect(page).toHaveURL(/\/training\/darkpage/);

  await overlay.locator(".wpk-btn-restart").click();
  await ask.locator(".wpk-confirm-yes").click();
  await expect(page).toHaveURL(/\/training\/lightpage/);
  await expect(overlay.locator(".wpk-btn-pause")).toBeVisible(); // running again, not paused
  const s = await getStorage("trainingSession");
  expect(s).toMatchObject({ currentIndex: 0, completedInCycle: 0, correctInCycle: 0 });
  expect(s.pausedAt).toBeUndefined();
  expect(s.ownerTabId).not.toBeNull();
  expect(Date.now() - s.timerStartedAt).toBeLessThan(10_000);
  expect(await parked(getStorage)).toEqual({}); // nothing left parked for this category
});

test("the minimized pill shows when training is paused", async ({ context, seedStorage }) => {
  const { overlay } = await timerRowSetup({ context, seedStorage });
  const pill = overlay.locator(".wpk-collapsed");
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(pill).toBeVisible();
  await expect(pill).not.toHaveAccessibleName(/paused/i);
  await overlay.locator(".wpk-collapsed").click();
  await overlay.locator(".wpk-btn-pause").click();
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(pill).toHaveAccessibleName(/paused/i);
  await expect(pill.locator(".wpk-icon")).toHaveText(/⏸/);
});

// ---- Branding: the logo, not an emoji ----

test("the overlay wears the logo on a light tile (title bar, minimized pill, resume chip) instead of an emoji", async ({ context, seedStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["lightpage", "darkpage"]));
  const page = await context.newPage();
  await page.goto("https://lichess.org/training/lightpage", { waitUntil: "domcontentloaded" });
  const overlay = page.locator("#lpn-woodpecker-overlay");

  // the resume chip, before the session is claimed
  await expect(overlay.locator(".wpk-resume-wrap .wpk-logo svg")).toBeVisible();
  await overlay.locator(".wpk-resume").click();

  // the title bar
  const bar = overlay.locator(".wpk-titlebar .wpk-logo");
  await expect(bar.locator("svg")).toBeVisible();
  const tile = await bar.evaluate((el) => { const s = getComputedStyle(el); return { min: Math.min(...s.backgroundColor.match(/\d+/g).slice(0, 3).map(Number)), radius: parseFloat(s.borderTopLeftRadius) }; });
  expect(tile.min, "a light tile, so the navy base shows on the dark overlay").toBeGreaterThan(200);
  expect(tile.radius).toBeGreaterThanOrEqual(4);

  // exactly the shipped logo: the same paths as icons/logo.svg, with ids that cannot clash with Lichess's page
  const shipped = [...require("fs").readFileSync(require("path").join(__dirname, "..", "icons", "logo.svg"), "utf8").matchAll(/\sd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  const svg = bar.locator("svg");
  expect(await svg.locator("path").evaluateAll((els) => els.map((e) => e.getAttribute("d").replace(/\s+/g, " ").trim()))).toEqual(shipped);
  const ids = await svg.evaluate((el) => ({ own: [...el.querySelectorAll("[id]")].map((e) => e.id), used: [...el.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]) }));
  expect(ids.own.length).toBeGreaterThan(0);
  for (const id of ids.own) expect(id.startsWith("wpk-"), `${id} is namespaced`).toBe(true);
  for (const id of ids.used) expect(ids.own, `${id} resolves inside the logo`).toContain(id);
  expect(await svg.getAttribute("aria-hidden")).toBe("true"); // decorative: the title next to it names the extension
  expect(await svg.locator("title, desc").count()).toBe(0);

  // the minimized pill
  await overlay.locator(".wpk-btn-minimize").click();
  await expect(overlay.locator(".wpk-collapsed .wpk-logo svg")).toBeVisible();

  // and no emoji anywhere in it
  expect(await overlay.innerText()).not.toMatch(/\u{1F3CB}/u);
});

// ---- Tab ownership ----

test("a tab that does not own the session shows nothing and cannot touch it", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "skipme"]));
  const A = await context.newPage();
  await gotoTraining(A, "https://lichess.org/training/clean"); // A owns the session

  // B never started training: just another Lichess page that happens to match /training/*.
  const B = await context.newPage();
  await B.goto("https://lichess.org/training/themes");
  await B.waitForTimeout(800);
  await expect(B.locator("#lpn-woodpecker-overlay")).toHaveCount(0);
  await finishPuzzle(B);
  await B.evaluate(() => { window.__clicks = 0; document.querySelector(".continue").addEventListener("click", () => window.__clicks++); });
  await B.locator(".continue").click();
  expect(await B.evaluate(() => window.__clicks)).toBe(1); // Lichess's own Continue was left alone
  expect(new URL(B.url()).pathname).toBe("/training/themes");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0, correctInCycle: 0, skippedInCycle: 0 });

  // and A, working alone, keeps exact count
  await A.locator(".wpk-btn-skip").click();
  await A.waitForURL("**/training/miss");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 1, skippedInCycle: 1 });
});

test("when the owner tab is closed, another training tab offers to resume and keeps the progress", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "skipme"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1 }));
  const A = await context.newPage();
  await gotoTraining(A, "https://lichess.org/training/miss");
  expect(typeof (await getStorage("trainingSession")).ownerTabId).toBe("number");
  await A.close();
  await expect.poll(async () => (await getStorage("trainingSession")).ownerTabId).toBeNull();

  const C = await context.newPage();
  await C.goto("https://lichess.org/training/themes"); // somewhere else on Lichess
  const chip = C.locator("#lpn-woodpecker-overlay .wpk-resume");
  await expect(chip).toContainText("Drill");
  await expect(chip).toContainText("1/3");
  await expect(C.locator("#lpn-woodpecker-overlay .wpk-panel")).toHaveCount(0);
  await chip.click();
  await C.waitForURL("**/training/miss"); // taken to the current puzzle, not left where it was
  await expect(C.locator("#lpn-woodpecker-overlay .wpk-panel")).toBeVisible();
  const s = await sessionOf(getStorage);
  expect(s).toMatchObject({ currentIndex: 1, completedInCycle: 1, correctInCycle: 1 });
  expect(typeof s.ownerTabId).toBe("number");
});

for (const [label, owner] of [["a tab id that no longer exists", 987654321], ["a session saved before ownership existed", undefined]]) {
  test(`${label} counts as having no owner`, async ({ context, seedStorage }) => {
    await serveFinishedPuzzles(context);
    const seed = trainingSeed(["clean"]);
    if (owner === undefined) delete seed.trainingSession.ownerTabId; else seed.trainingSession.ownerTabId = owner;
    await seedStorage(seed);
    const page = await context.newPage();
    await page.goto("https://lichess.org/training/clean");
    await expect(page.locator("#lpn-woodpecker-overlay .wpk-resume")).toBeVisible();
    await expect(page.locator("#lpn-woodpecker-overlay .wpk-panel")).toHaveCount(0);
  });
}

test("an owner tab lets go when the session is handed to another tab or ended elsewhere", async ({ context, extPage, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss"]));
  const A = await context.newPage();
  await gotoTraining(A, "https://lichess.org/training/clean");

  // another tab takes over (what Play in the popup does)
  await extPage.evaluate(async () => {
    const { trainingSession } = await browser.storage.local.get("trainingSession");
    await browser.storage.local.set({ trainingSession: { ...trainingSession, ownerTabId: 424242 } });
  });
  await expect(A.locator("#lpn-woodpecker-overlay")).toHaveCount(0);
  expect(await sessionOf(getStorage)).toMatchObject({ ownerTabId: 424242, currentIndex: 0 }); // letting go does not erase it

  // ended elsewhere
  await seedStorage(trainingSeed(["clean", "miss"]));
  const A2 = await context.newPage();
  await gotoTraining(A2, "https://lichess.org/training/clean");
  await extPage.evaluate(() => browser.storage.local.remove("trainingSession"));
  await expect(A2.locator("#lpn-woodpecker-overlay")).toHaveCount(0);
});

test("a pending auto-next jump is cancelled when the tab loses the session", async ({ context, extPage, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean", "skipme"]));
  const A = await context.newPage();
  await gotoTraining(A, "https://lichess.org/training/clean");
  await finishPuzzle(A); // the one-second jump is now pending
  await extPage.evaluate(async () => {
    const { trainingSession } = await browser.storage.local.get("trainingSession");
    await browser.storage.local.set({ trainingSession: { ...trainingSession, ownerTabId: 424242 } }); // handed to another tab
  });
  await expect(A.locator("#lpn-woodpecker-overlay")).toHaveCount(0);
  await A.waitForTimeout(1_500); // well past the pause
  expect(A.url()).toContain("/training/clean");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0, correctInCycle: 0, ownerTabId: 424242 });
});

test("the tab calls the extension makes work without the tabs permission, and no tab URLs are exposed", async ({ context, extPage }) => {
  await serveFinishedPuzzles(context);
  const page = await context.newPage();
  await page.goto("https://lichess.org/training/aaaaa");
  await page.bringToFront();

  // Holding "tabs" would hand the extension every tab's URL (Chrome words it "read your browsing history"). Nothing
  // here reads one, so the permission is not requested; if it comes back this fails and someone has to say why.
  // (an extension can always see the URL of its own pages; it is the other tabs that must stay opaque)
  const { count, leaked } = await extPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return { count: tabs.length, leaked: tabs.filter((t) => t.url !== undefined && !t.url.startsWith(chrome.runtime.getURL(""))).map((t) => t.url) };
  });
  expect(count).toBeGreaterThan(1);
  expect(leaked).toEqual([]);

  // what the popup does when Play is pressed: find the active tab, send it to the first puzzle
  const [active] = await extPage.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
  await extPage.evaluate((id) => chrome.tabs.update(id, { url: "https://lichess.org/training/bbbbb" }), active.id);
  await page.waitForURL("**/training/bbbbb");

  // and what "open puzzle" does
  const [opened] = await Promise.all([
    context.waitForEvent("page"),
    extPage.evaluate(() => chrome.tabs.create({ url: "https://lichess.org/training/ccccc" })),
  ]);
  await opened.waitForURL("**/training/ccccc");
});

// ---- Pause and resume ----
// A paused cycle is parked under its category in `pausedCycles`; the active slot (`trainingSession`) holds only a cycle that is running.

const MIN = 60_000;
const parkedOf = async (getStorage) => (await getStorage("pausedCycles")) || {};
const timerText = (scope) => scope.locator("[data-timer]").first().textContent();

test("Pause parks the cycle under its category, empties the active slot and freezes the clock", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "skipme"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1, cycleCount: 3, timerStartedAt: Date.now() - 125_000 }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/miss");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  const before = await getStorage("trainingSession");

  await overlay.locator(".wpk-btn-pause").click();
  const paused = overlay.locator(".wpk-paused");
  await expect(paused).toBeVisible();
  await expect(overlay.locator("[data-title]")).toHaveText("Paused");
  await expect(paused.locator(".wpk-btn-play")).toBeVisible();
  await expect(paused.locator(".wpk-btn-pause")).toHaveCount(0); // Pause has turned into Play
  const shown = await timerText(paused);
  expect(shown).toMatch(/^02:0\d$/);

  await page.waitForTimeout(2_200);
  await overlay.locator(".wpk-btn-minimize").click(); // re-rendering reads the clock again: it must still be frozen
  await expect(overlay.locator(".wpk-collapsed-timer")).toHaveText(shown);
  await overlay.locator(".wpk-collapsed").click();
  expect(await timerText(overlay.locator(".wpk-paused"))).toBe(shown);

  expect(await getStorage("trainingSession")).toBeUndefined(); // nothing is running
  const saved = (await parkedOf(getStorage)).Drill;
  expect(saved.pausedAt).toBeGreaterThan(0);
  expect(saved).toMatchObject({ category: "Drill", currentIndex: 1, completedInCycle: 1, correctInCycle: 1, cycleCount: 3, timerStartedAt: before.timerStartedAt, ownerTabId: null });
  expect(saved.queue).toEqual(before.queue); // the same order
});

test("while paused nothing counts or advances, even if the puzzle gets finished on the page", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(autoSeed(["clean", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-paused")).toBeVisible();
  const saved = (await parkedOf(getStorage)).Drill;

  await finishPuzzle(page); // Lichess shows "Success!" with a Continue button
  await page.evaluate(() => { window.__clicks = 0; document.querySelector(".continue").addEventListener("click", () => window.__clicks++); });
  await page.locator(".continue").click();
  expect(await page.evaluate(() => window.__clicks)).toBe(0); // swallowed, so real Lichess would not move on either
  await page.waitForTimeout(2_000); // longer than the auto-next pause
  expect(page.url()).toContain("/training/clean");
  expect((await parkedOf(getStorage)).Drill).toEqual(saved); // not a single count changed
  expect(await getStorage("trainingSession")).toBeUndefined();

  // Continue Training reloads the puzzle fresh instead of treating the stale finished board as an answer
  await overlay.locator(".wpk-btn-play").click();
  await expect(overlay.locator(".wpk-btn-pause")).toBeVisible();
  await expect(page.locator(".puzzle__feedback")).toHaveClass(/play/);
  await page.waitForTimeout(1_500);
  expect(page.url()).toContain("/training/clean");
  expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: 0, correctInCycle: 0 });
});

test("Continue Training puts the cycle back, keeps the counts and leaves out the time spent paused", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "viewed"], { currentIndex: 2, completedInCycle: 2, correctInCycle: 1, incorrectInCycle: 1, cycleCount: 2, timerStartedAt: Date.now() - 125_000 }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/viewed");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-paused")).toBeVisible();
  await page.waitForTimeout(3_000); // three seconds spent paused

  await overlay.locator(".wpk-btn-play").click();
  await expect(overlay.locator(".wpk-btn-pause")).toBeVisible(); // reloaded onto the unfinished puzzle, running again
  expect(page.url()).toContain("/training/viewed");
  const s = await getStorage("trainingSession");
  expect(s.pausedAt).toBeUndefined();
  expect(s).toMatchObject({ category: "Drill", currentIndex: 2, completedInCycle: 2, correctInCycle: 1, incorrectInCycle: 1, cycleCount: 2 });
  expect(typeof s.ownerTabId).toBe("number");
  expect(await parkedOf(getStorage)).toEqual({}); // taken out of the parked area

  const elapsed = Date.now() - s.timerStartedAt;
  expect(elapsed).toBeGreaterThan(124_000);
  expect(elapsed).toBeLessThan(127_000); // it would read 128s or more if the three paused seconds counted

  const first = await overlay.locator("[data-timer]").first().textContent();
  expect(first).toMatch(/^02:0\d$/);
  await expect.poll(() => overlay.locator("[data-timer]").first().textContent()).not.toBe(first); // ticking again
});

test("closing the paused overlay leaves the parked cycle alone, and a reload brings no overlay back", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "skipme"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1, cycleCount: 2, timerStartedAt: Date.now() - 4 * MIN }));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/miss");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-paused")).toBeVisible();
  const saved = await parkedOf(getStorage);

  await overlay.locator(".wpk-btn-close").click(); // the title-bar X is "Close (progress kept)" while paused
  await expect(overlay).toHaveCount(0);
  expect(await parkedOf(getStorage)).toEqual(saved);
  expect(await getStorage("trainingSession")).toBeUndefined();

  await page.reload(); // reloading Lichess keeps it, and nothing is running, so there is nothing to show
  await page.waitForTimeout(800);
  await expect(page.locator("#lpn-woodpecker-overlay")).toHaveCount(0);
  expect(await parkedOf(getStorage)).toEqual(saved);
});

test("progress is saved after every puzzle advance, so a pause at any point loses nothing", async ({ context, seedStorage, getStorage }) => {
  await serveFinishedPuzzles(context);
  await seedStorage(trainingSeed(["clean", "miss", "viewed", "skipme"]));
  const page = await context.newPage();
  await gotoTraining(page, "https://lichess.org/training/clean");
  const overlay = page.locator("#lpn-woodpecker-overlay");
  const queue = (await getStorage("trainingSession")).queue;
  for (const [index, url] of [[1, "miss"], [2, "viewed"]]) {
    await overlay.locator(".wpk-btn-skip").click();
    await page.waitForURL(`**/training/${url}`);
    // already in storage the moment the next puzzle is on screen
    expect(await sessionOf(getStorage)).toMatchObject({ currentIndex: index, skippedInCycle: index, completedInCycle: index });
  }
  await expect(overlay.locator(".wpk-panel")).toBeVisible();
  await overlay.locator(".wpk-btn-pause").click();
  await expect(overlay.locator(".wpk-paused")).toBeVisible();
  const s = (await parkedOf(getStorage)).Drill;
  expect(s).toMatchObject({ currentIndex: 2, skippedInCycle: 2, completedInCycle: 2 });
  expect(s.queue).toEqual(queue);
});

test("a paused cycle survives closing and reopening the browser, and continues from the popup", async () => {
  const { chromium } = require("@playwright/test");
  const fs = require("fs"), os = require("os"), path = require("path");
  const ext = path.resolve(__dirname, "..");
  const launch = (dir) => chromium.launchPersistentContext(dir, { headless: false, args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-restart-"));
  const route = (ctx) => ctx.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>puzzle</title><main class='puzzle'><div class='puzzle__feedback play'>x</div></main>" }));
  const extension = async (ctx, file) => {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${new URL(sw.url()).host}/${file}`);
    return page;
  };
  const read = (page, key) => page.evaluate(async (k) => (await browser.storage.local.get(k))[k], key);
  try {
    let ctx = await launch(dir);
    await route(ctx);
    const first = await extension(ctx, "options.html");
    const seed = trainingSeed(["clean", "miss", "skipme"], { currentIndex: 1, completedInCycle: 1, correctInCycle: 1, cycleCount: 2, timerStartedAt: Date.now() - 3 * MIN });
    await first.evaluate(async (o) => { await browser.runtime.sendMessage({ type: "GET_ALL_DATA" }); await browser.storage.local.set(o); }, seed);
    const page = await ctx.newPage();
    await gotoTraining(page, "https://lichess.org/training/miss");
    await page.locator("#lpn-woodpecker-overlay .wpk-btn-pause").click();
    await expect(page.locator("#lpn-woodpecker-overlay .wpk-paused")).toBeVisible();
    const before = await read(first, "pausedCycles");
    expect(before.Drill.pausedAt).toBeGreaterThan(0);
    await ctx.close(); // closing the browser

    ctx = await launch(dir); // and reopening it on the same profile
    await route(ctx);
    const admin = await extension(ctx, "options.html");
    expect(await read(admin, "pausedCycles")).toEqual(before); // nothing lost
    expect(await read(admin, "trainingSession")).toBeUndefined();

    // starting training again picks it straight back up
    const popup = await extension(ctx, "popup.html");
    await popup.bringToFront();
    await popup.evaluate(() => { window.close = () => {}; });
    await popup.locator('.category-row[data-cat="Drill"] .btn-train').click();
    await popup.waitForURL("**/training/miss");
    const resumed = await read(admin, "trainingSession");
    expect(resumed).toMatchObject({ category: "Drill", currentIndex: 1, completedInCycle: 1, correctInCycle: 1, cycleCount: 2 });
    expect(resumed.pausedAt).toBeUndefined();
    expect(await read(admin, "pausedCycles")).toBeFalsy(); // no longer parked
    await ctx.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renaming or deleting a category carries or drops its paused cycle", async ({ send, extPage, getStorage }) => {
  const cycle = (category) => ({ category, queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 2, timerStartedAt: 1, pausedAt: 5, ownerTabId: null });
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  await send({ type: "CREATE_CATEGORY", name: "Forks" });
  await extPage.evaluate((c) => browser.storage.local.set({ pausedCycles: c }), { Pins: cycle("Pins"), Forks: cycle("Forks"), "All Categories": cycle("All Categories") });

  expect(await send({ type: "RENAME_CATEGORY", oldName: "Pins", newName: "Pins renamed" })).toEqual({ ok: true });
  let parked = await parkedOf(getStorage);
  expect(Object.keys(parked).sort()).toEqual(["All Categories", "Forks", "Pins renamed"]);
  expect(parked["Pins renamed"]).toEqual(cycle("Pins renamed")); // moved, and it knows its new name
  expect(parked.Forks).toEqual(cycle("Forks")); // the others were not touched

  await send({ type: "RENAME_CATEGORY", oldName: "Forks", newName: "Forks" }); // an unchanged name is a no-op
  expect((await parkedOf(getStorage)).Forks).toEqual(cycle("Forks"));

  await send({ type: "DELETE_CATEGORY", name: "Pins renamed" });
  parked = await parkedOf(getStorage);
  expect(Object.keys(parked).sort()).toEqual(["All Categories", "Forks"]);
});

// ---- Import ----
// Import merges a file written by Export (categories and puzzle IDs only) into what is already stored.

const exportFile = (categories, over = {}) => ({
  app: "lichess-puzzle-saver", exportVersion: 1, exportedAt: "2026-01-01T00:00:00.000Z",
  source: { extension: "chrome", extensionVersion: "1.1.0" }, data: { categories }, ...over,
});
const importPreview = (send, payload) => send({ type: "IMPORT_PREVIEW", payload });
const importApply = (send, payload) => send({ type: "IMPORT_APPLY", payload });

test("import merges: new categories and puzzles are added, and nothing is removed or duplicated", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  await send({ type: "ADD_PUZZLE", category: "Pins", puzzleId: "abc12" });
  await send({ type: "CREATE_CATEGORY", name: "Keep" });
  await send({ type: "ADD_PUZZLE", category: "Keep", puzzleId: "kee11" });
  const before = await getStorage("lichessNotes");

  // "pins" matches the existing Pins whatever its case; def34 appears twice; abc12 is already saved
  const file = exportFile({ pins: ["abc12", "def34", "def34", "ghi56"], Forks: ["jkl78"], Empty: [] });
  const preview = await importPreview(send, file);
  expect(preview).toEqual({ ok: true, summary: {
    newCategories: [{ name: "Forks", added: 1 }, { name: "Empty", added: 0 }],
    mergedCategories: [{ name: "Pins", added: 2 }],
    added: 3, duplicates: 2, invalidIds: 0, skippedNames: 0,
  } });
  expect(await getStorage("lichessNotes")).toEqual(before); // a preview changes nothing

  expect(await importApply(send, file)).toEqual(preview);
  const after = (await getStorage("lichessNotes")).categories;
  expect(after).toEqual({ Pins: ["abc12", "def34", "ghi56"], Keep: ["kee11"], Forks: ["jkl78"], Empty: [] }); // existing spelling kept, order kept, Keep untouched
});

test("import is idempotent and leaves statistics, paused cycles and existing colours alone", async ({ send, extPage, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  const stats = [{ category: "Pins", timeTaken: 5, totalPuzzles: 1, correct: 1, incorrect: 0, skipped: 0, completedAt: 1 }];
  await extPage.evaluate(async (st) => {
    const { lichessNotes } = await browser.storage.local.get("lichessNotes");
    lichessNotes.meta.trainingStats = st;
    await browser.storage.local.set({ lichessNotes, pausedCycles: { Pins: { category: "Pins", pausedAt: 5 } } });
  }, stats);
  const pinsColor = (await getStorage("lichessNotes")).meta.categoryMeta.Pins.color;

  const file = exportFile({ Pins: ["abc12"], Forks: ["def34"], Mates: ["ghi56"] });
  await importApply(send, file);
  const once = await getStorage("lichessNotes");
  const second = await importApply(send, file);
  expect(second.summary).toMatchObject({ added: 0, duplicates: 3, newCategories: [], mergedCategories: [] }); // nothing new the second time
  expect((await getStorage("lichessNotes")).categories).toEqual(once.categories);

  const notes = await getStorage("lichessNotes");
  expect(notes.meta.trainingStats).toEqual(stats);
  expect(notes.meta.categoryMeta.Pins.color).toBe(pinsColor);
  const colors = ["Pins", "Forks", "Mates"].map((n) => notes.meta.categoryMeta[n].color);
  expect(new Set(colors).size).toBe(3); // new categories get distinct colours like any other new category
  expect((await getStorage("pausedCycles")).Pins.pausedAt).toBe(5);
});

test("import refuses files that are not a usable export, and says why", async ({ send, getStorage }) => {
  await send({ type: "CREATE_CATEGORY", name: "Pins" });
  const before = await getStorage("lichessNotes");
  const cases = [
    [null, /export/i], ["text", /export/i], [[], /export/i],
    [{ ...exportFile({ A: ["abc12"] }), app: "something-else" }, /export/i],
    [{ app: "lichess-puzzle-saver", exportVersion: 1 }, /categories/i],
    [exportFile([]), /categories/i],
    [exportFile({ A: ["abc12"] }, { exportVersion: 2 }), /newer version/i],
    [exportFile({ A: ["abc12"] }, { exportVersion: "1" }), /export/i],
    [exportFile({ Bad: "abc12", Worse: { x: 1 } }), /nothing to import/i], // not lists of puzzle IDs
    [exportFile({}), /nothing to import/i],
  ];
  for (const [payload, message] of cases) {
    for (const type of ["IMPORT_PREVIEW", "IMPORT_APPLY"]) {
      const r = await send({ type, payload });
      expect(r.ok, JSON.stringify(payload)).toBe(false);
      expect(r.error).toMatch(message);
    }
  }
  const tooMany = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`C${i}`, []]));
  expect((await importApply(send, exportFile(tooMany))).error).toMatch(/too many categories/i);
  expect(await getStorage("lichessNotes")).toEqual(before); // every refusal left the data alone
});

test("import skips what it cannot use and reports it, instead of failing or polluting the data", async ({ extPage, getStorage }) => {
  const file = `{
    "app": "lichess-puzzle-saver", "exportVersion": 1, "data": { "categories": {
      "Good": ["abc12", "abc", "abc123", 12345, null, "ab c1", "<b>x1", "ok_99", "Z9z9Z"],
      "  Padded  ": ["pad11"],
      "All Categories": ["res11"],
      "": ["emp11"],
      "   ": ["spc11"],
      "${"x".repeat(61)}": ["lng11"],
      "__proto__": ["pro11"],
      "constructor": ["con11"]
    } } }`;
  const r = await extPage.evaluate((text) => browser.runtime.sendMessage({ type: "IMPORT_APPLY", payload: JSON.parse(text) }), file);
  expect(r.ok).toBe(true);
  expect(r.summary).toMatchObject({ added: 4, invalidIds: 7, skippedNames: 5 }); // abc12, Z9z9Z, pad11, con11 in; 7 bad ids; 5 bad names
  const cats = (await getStorage("lichessNotes")).categories;
  expect(Object.keys(cats).sort()).toEqual(["Good", "Padded", "constructor"]);
  expect(cats.Good).toEqual(["abc12", "Z9z9Z"]);
  expect(cats.Padded).toEqual(["pad11"]); // whitespace trimmed
  expect(await extPage.evaluate(() => ({}).pro11 === undefined && Object.getPrototypeOf({}) === Object.prototype)).toBe(true);
});

// ---- one reader and one writer for the parked map: every path treats a malformed stored value the same way ----

test("a malformed pausedCycles value is never carried along: rename, delete, park, unpark and START_SESSION all end with a plain map or none", async ({ send, getStorage, seedStorage }) => {
  const plain = (v) => v === undefined || (v !== null && typeof v === "object" && !Array.isArray(v));
  const session = { ownerTabId: 4, category: "0", queue: ["https://lichess.org/training/abc12"], currentIndex: 0, totalPuzzles: 1, completedInCycle: 0, cycleCount: 1, isMinimized: false, timerStartedAt: 1_500_000 };
  const actions = {
    rename: () => send({ type: "RENAME_CATEGORY", oldName: "0", newName: "zero" }),
    delete: () => send({ type: "DELETE_CATEGORY", name: "0" }),
    park: () => send({ type: "PARK_CYCLE", cycle: cyc("0") }),
    unpark: () => send({ type: "UNPARK_CYCLE", category: "0" }),
    start: () => send({ type: "START_SESSION", session, park: null, unpark: "0" }),
  };
  for (const bad of ["oops", ["x"], 5, true]) {
    for (const [name, act] of Object.entries(actions)) {
      await seedStorage({ lichessNotes: { categories: { 0: ["abc12"] }, meta: { version: 1, updatedAt: 0 } }, pausedCycles: bad });
      const r = await act();
      expect(r.ok, `${name} with pausedCycles ${JSON.stringify(bad)}: ${JSON.stringify(r)}`).toBe(true);
      const after = await getStorage("pausedCycles");
      expect(plain(after), `${name} with pausedCycles ${JSON.stringify(bad)} left ${JSON.stringify(after)}`).toBe(true);
    }
  }
  // and a proper map still keeps what it holds through a rename of another category
  await seedStorage({ lichessNotes: { categories: { A: ["abc12"], B: ["abc12"] }, meta: { version: 1, updatedAt: 0 } }, pausedCycles: { A: cyc("A") } });
  expect((await send({ type: "RENAME_CATEGORY", oldName: "B", newName: "Bx" })).ok).toBe(true);
  expect(Object.keys(await getStorage("pausedCycles"))).toEqual(["A"]);
});
