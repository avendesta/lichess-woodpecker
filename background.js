/**
 * Background service worker for Lichess Woodpecker.
 * Handles storage operations via message passing from popup/options pages.
 * Uses browser.storage.local for persistence.
 */

// Import polyfill for Chrome compatibility.
// In Chrome (service worker), use importScripts. In Firefox (background script), the
// polyfill is loaded via the manifest "scripts" array, but we still try importScripts
// as a fallback in case it's available.
if (typeof importScripts === "function") {
  try {
    importScripts("browser-polyfill.js");
  } catch (e) {
    console.warn("[lichess-woodpecker] Could not load browser-polyfill.js:", e); // Firefox has no importScripts and loads it from the manifest
  }
}

/* ============================================================
 * Default data schema
 * ============================================================ */
const DEFAULT_DATA = {
  categories: {},
  meta: {
    version: 1,
    updatedAt: Date.now(),
  },
};

/* ============================================================
 * Storage helpers — always read-modify-write with latest snapshot
 * ============================================================ */

/**
 * Retrieve the stored library. Reading never writes the library:
 * - a failed read throws, so the change that wanted it is refused (it used to carry on from defaults and save them over
 *   everything, so one transient storage failure could wipe a library);
 * - nothing stored yet is just the defaults, in memory (the first save writes them);
 * - something stored that is not a library is kept aside in `lichessNotesBackup` first, so a later save cannot destroy the
 *   only copy of it, and the defaults are returned.
 */
async function getAllData() {
  const result = await browser.storage.local.get("lichessNotes");
  const stored = result.lichessNotes;
  if (stored && typeof stored === "object" && stored.categories) return stored;
  if (stored !== undefined && stored !== null) {
    console.warn("[lichess-woodpecker] Stored data is not a library; keeping a copy in lichessNotesBackup:", stored);
    await browser.storage.local.set({ lichessNotesBackup: stored });
  }
  return structuredClone(DEFAULT_DATA);
}

/**
 * Library changes run one at a time. Each one reads the whole library, changes it and writes it all back, so two at once
 * (a Save in the popup while a cycle's stats are recorded, an import during a rename) would let the later write throw away
 * the earlier one. Everything that writes `lichessNotes` goes through here: this background is the only writer.
 */
let writeQueue = Promise.resolve();
function serialized(change) {
  const run = writeQueue.then(change);
  writeQueue = run.catch(() => {}); // a failed change must not stop the ones behind it
  return run;
}

/** Persist the full dataset, updating the meta timestamp. */
async function saveAllData(data) {
  data.meta.updatedAt = Date.now();
  await browser.storage.local.set({ lichessNotes: data });
}

/* ============================================================
 * Per-category metadata: meta.categoryMeta[name] = { color }, optional
 * ============================================================
 * color is an index into the popup's palette (the colours live in popup.js). Categories that predate this have none
 * and show hashColor(name); keep hashColor identical to popup.js (a test compares them).
 */
const PALETTE_SIZE = 8;

function hashColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % PALETTE_SIZE;
}

function categoryMeta(data) {
  return (data.meta.categoryMeta ||= {});
}

function colorOf(data, name) {
  const stored = categoryMeta(data)[name]?.color;
  return stored === undefined ? hashColor(name) : stored;
}

/** The palette index used by the fewest existing categories, so the first eight all look different. */
function leastUsedColor(data) {
  const used = new Array(PALETTE_SIZE).fill(0);
  for (const name of Object.keys(data.categories)) used[colorOf(data, name)]++;
  return used.indexOf(Math.min(...used));
}

/**
 * Paused cycles are parked per category in the `pausedCycles` storage key ({ [category]: cycle }), apart from the
 * running cycle (trainingSession) that a training tab keeps writing. Nothing writes a parked cycle but its own actions,
 * so a rename or delete can safely move or drop it. The key is removed when none are left.
 */
async function updateParked(change) {
  const parked = await readParked();
  change(parked);
  await writeParked(parked);
}

const MAX_NAME_LENGTH = 60;

/**
 * The one rule for a category's name, used by create, rename and import. Returns {ok, name} (trimmed) or {ok: false, error}.
 * "__proto__" would rewrite an object's prototype instead of adding a key, and "All Categories" is the name of the combined
 * training run (pausedCycles uses it as a key), so neither can be a category.
 */
function validCategoryName(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Category name must be text." };
  const name = raw.trim();
  if (!name) return { ok: false, error: "Category name cannot be empty." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Category name cannot be longer than ${MAX_NAME_LENGTH} characters.` };
  if (name === "__proto__" || name.toLowerCase() === "all categories") return { ok: false, error: `"${name}" is reserved and cannot be a category name.` };
  return { ok: true, name };
}

/** True only for a category that really is in the library: a string that is an own key (not "constructor", not a list that coerces to one). */
function hasCategory(data, name) {
  return typeof name === "string" && Object.hasOwn(data.categories, name);
}

/** Create a new category. Returns {ok, error}. */
async function createCategory(name) {
  const check = validCategoryName(name);
  if (!check.ok) return check;
  const trimmed = check.name;

  const data = await getAllData();
  // Case-insensitive duplicate check
  const existing = Object.keys(data.categories).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) return { ok: false, error: `Category "${existing}" already exists.` };

  const color = leastUsedColor(data); // before the new category counts toward the usage
  data.categories[trimmed] = [];
  categoryMeta(data)[trimmed] = { color };
  await saveAllData(data);
  return { ok: true };
}

/** Rename a category. Returns {ok, error}. */
async function renameCategory(oldName, newName) {
  const check = validCategoryName(newName);
  if (!check.ok) return check;
  const trimmedNew = check.name;

  const data = await getAllData();
  if (!hasCategory(data, oldName))
    return { ok: false, error: `Category "${oldName}" not found.` };

  if (oldName === trimmedNew) return { ok: true }; // nothing to change (assigning then deleting the same key lost the category)

  const clash = Object.keys(data.categories).find(
    (k) => k.toLowerCase() === trimmedNew.toLowerCase() && k !== oldName
  );
  if (clash) return { ok: false, error: `Category "${clash}" already exists.` };

  const meta = categoryMeta(data);
  meta[trimmedNew] = { color: colorOf(data, oldName) }; // keeps the colour even if it was only the hash
  delete meta[oldName];
  data.categories[trimmedNew] = data.categories[oldName];
  delete data.categories[oldName];
  await saveAllData(data);
  await updateParked((parked) => {
    if (!parked[oldName]) return;
    parked[trimmedNew] = { ...parked[oldName], category: trimmedNew }; // a paused cycle keeps its place through a rename
    delete parked[oldName];
  });
  return { ok: true };
}

/** Delete a category and all its puzzle IDs. Returns {ok, error}. */
async function deleteCategory(name) {
  const data = await getAllData();
  if (!hasCategory(data, name))
    return { ok: false, error: `Category "${name}" not found.` };

  delete data.categories[name];
  delete categoryMeta(data)[name];
  await saveAllData(data);
  await updateParked((parked) => { delete parked[name]; });
  return { ok: true };
}

/** Add a puzzle ID to a category. Prevents duplicates. Returns {ok, duplicate, error}. */
async function addPuzzleToCategory(category, puzzleId) {
  if (!isPuzzleId(puzzleId)) return { ok: false, error: "That is not a valid puzzle ID." };
  const data = await getAllData();
  if (!hasCategory(data, category))
    return { ok: false, error: `Category "${category}" not found.` };

  if (data.categories[category].includes(puzzleId))
    return { ok: false, duplicate: true, error: "Already saved." };

  data.categories[category].push(puzzleId);
  await saveAllData(data);
  return { ok: true };
}

/* ============================================================
 * Import: merge a file written by Export (categories and puzzle IDs only) into what is stored
 * ============================================================
 * planImport() works out what a file would change without changing anything, so the preview and the real import
 * agree. It is strict about the file and forgiving about its contents: a wrong file is refused with a reason, while
 * individual bad names or puzzle IDs are skipped and counted. Existing categories are matched case-insensitively (as
 * when creating one), nothing is ever removed or overwritten, and importing the same file twice adds nothing.
 */
const IMPORT_MAX_CATEGORIES = 2000;
const IMPORT_MAX_PUZZLES = 200000;
const PUZZLE_ID_PATTERN = /^[A-Za-z0-9]{5}$/;
const isPuzzleId = (id) => typeof id === "string" && PUZZLE_ID_PATTERN.test(id);

function planImport(data, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.app !== "lichess-puzzle-saver"
      || !Number.isInteger(payload.exportVersion) || payload.exportVersion < 1) {
    return { ok: false, error: "That doesn't look like a Lichess Woodpecker export file." };
  }
  if (payload.exportVersion > 1) {
    return { ok: false, error: "That file was made by a newer version of the extension. Update the extension and try again." };
  }
  const incoming = payload.data && payload.data.categories;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { ok: false, error: "That export file has no categories in it." };
  }
  const entries = Object.entries(incoming);
  if (entries.length > IMPORT_MAX_CATEGORIES) {
    return { ok: false, error: `That file has too many categories (more than ${IMPORT_MAX_CATEGORIES}).` };
  }

  const existing = new Map(Object.keys(data.categories).map((n) => [n.toLowerCase(), n])); // own keys only
  const additions = new Map(); // lower-cased name -> { name, isNew, ids }
  let duplicates = 0, invalidIds = 0, skippedNames = 0, total = 0;

  for (const [rawName, rawIds] of entries) {
    const checked = validCategoryName(String(rawName));
    const name = checked.name;
    const key = checked.ok ? name.toLowerCase() : "";
    if (!checked.ok || !Array.isArray(rawIds)) { // a bad name (see validCategoryName) or a value that is not a list: skipped and counted
      skippedNames++;
      continue;
    }
    if (!additions.has(key)) additions.set(key, { name: existing.get(key) || name, isNew: !existing.has(key), ids: [] });
    const target = additions.get(key);
    const have = new Set(existing.has(key) ? data.categories[existing.get(key)] : []);
    for (const id of target.ids) have.add(id);
    for (const id of rawIds) {
      if (typeof id !== "string" || !PUZZLE_ID_PATTERN.test(id)) invalidIds++;
      else if (have.has(id)) duplicates++;
      else {
        have.add(id);
        target.ids.push(id);
        if (++total > IMPORT_MAX_PUZZLES) return { ok: false, error: "That file has too many puzzles." };
      }
    }
  }
  if (additions.size === 0) return { ok: false, error: "Nothing to import: the file has no usable categories or puzzle IDs." };

  const list = [...additions.values()];
  return {
    ok: true,
    additions: list,
    summary: {
      newCategories: list.filter((a) => a.isNew).map((a) => ({ name: a.name, added: a.ids.length })),
      mergedCategories: list.filter((a) => !a.isNew && a.ids.length > 0).map((a) => ({ name: a.name, added: a.ids.length })),
      added: total, duplicates, invalidIds, skippedNames,
    },
  };
}

/** Merge an export file into the stored data. Returns {ok, summary} or {ok: false, error}. */
async function importCategories(payload) {
  const data = await getAllData();
  const plan = planImport(data, payload);
  if (!plan.ok) return plan;
  if (plan.summary.added === 0 && plan.summary.newCategories.length === 0) return { ok: true, summary: plan.summary }; // nothing to write
  for (const a of plan.additions) {
    if (a.isNew) {
      const color = leastUsedColor(data); // before the new category counts toward the usage, like createCategory
      data.categories[a.name] = a.ids;
      categoryMeta(data)[a.name] = { color };
    } else {
      data.categories[a.name].push(...a.ids);
    }
  }
  try {
    await saveAllData(data);
  } catch (e) {
    return { ok: false, error: "There is not enough storage space to import that file." };
  }
  return { ok: true, summary: plan.summary };
}

/** Remove a puzzle ID from a category. Returns {ok, error}. */
async function removePuzzleFromCategory(category, puzzleId) {
  if (!isPuzzleId(puzzleId)) return { ok: false, error: "That is not a valid puzzle ID." };
  const data = await getAllData();
  if (!hasCategory(data, category))
    return { ok: false, error: `Category "${category}" not found.` };

  const idx = data.categories[category].indexOf(puzzleId);
  if (idx === -1) return { ok: false, error: "Puzzle not found in category." };

  data.categories[category].splice(idx, 1);
  await saveAllData(data);
  return { ok: true };
}

/* ============================================================
 * Training session ownership
 * ============================================================
 * A training session belongs to one tab (session.ownerTabId), so other Lichess tabs neither show the overlay nor
 * overwrite it. Only this script can tell whether the owner tab is still alive.
 */
async function readSession() {
  return (await browser.storage.local.get("trainingSession")).trainingSession || null;
}

async function setOwner(session, tabId) {
  await browser.storage.local.set({ trainingSession: { ...session, ownerTabId: tabId } });
}

// "none" (no session) | "owner" | "other" (a live tab owns it) | "resumable" (no live owner)
async function sessionRole(tabId) {
  const session = await readSession();
  if (!session || tabId == null) return { role: "none" };
  if (session.ownerTabId === tabId) return { role: "owner", tabId };
  if (session.ownerTabId == null) return { role: "resumable", tabId }; // also sessions saved before ownership existed
  try {
    await browser.tabs.get(session.ownerTabId);
    return { role: "other", tabId };
  } catch (_) {
    // The owner is gone (closed, or a stale id after a restart). Re-read first: the popup may have just started a new session.
    const fresh = await readSession();
    if (fresh && fresh.ownerTabId === session.ownerTabId) await setOwner(fresh, null);
    return { role: "resumable", tabId };
  }
}

async function claimSession(tabId) {
  const { role } = await sessionRole(tabId);
  if (role === "none") return { ok: false, error: "No training session." };
  if (role === "other") return { ok: false, error: "Another tab owns this session." };
  const session = await readSession();
  if (role === "resumable") await setOwner(session, tabId);
  return { ok: true, session: { ...session, ownerTabId: tabId } };
}

// Release the session when its tab goes away, and at startup (tab ids restart, so an old id could match a new tab).
browser.tabs.onRemoved.addListener(async (tabId) => {
  const session = await readSession();
  if (session && session.ownerTabId === tabId) await setOwner(session, null);
});
browser.runtime.onStartup.addListener(async () => {
  const session = await readSession();
  if (session && session.ownerTabId != null) await setOwner(session, null);
});

/* ============================================================
 * Paused cycles: the parked map (`pausedCycles`, { [category]: cycle }) is changed here, one operation at a time
 * ============================================================
 * The popup and the overlay used to read the whole map, change it and write it all back, so a stale copy in one of them
 * could drop another category's paused cycle. They now send an operation (park one, unpark one, or start a session that does
 * either), which is applied to the map as it is now. `trainingSession` (the running cycle) is still written by the tab that
 * owns it; the ownership model is what keeps that one straight.
 */
const TRAINING_URL = /^https:\/\/lichess\.org\/training\/[A-Za-z0-9]{1,20}$/; // the overlay navigates to these: nothing else is a place to go

/** A cycle worth keeping. A paused one has `pausedAt`; a running one must not. Returns {ok} or {ok: false, error}. */
function checkCycle(c, { paused }) {
  const bad = (why) => ({ ok: false, error: `Invalid training cycle (${why}).` });
  if (!c || typeof c !== "object" || Array.isArray(c)) return bad("not an object");
  if (typeof c.category !== "string" || !c.category || c.category.length > MAX_NAME_LENGTH || c.category === "__proto__") return bad("category");
  if (!Array.isArray(c.queue) || c.queue.length === 0 || c.queue.length > 200000 || !c.queue.every((u) => typeof u === "string" && TRAINING_URL.test(u))) return bad("queue");
  if (!Number.isInteger(c.currentIndex) || c.currentIndex < 0 || c.currentIndex > c.queue.length) return bad("position");
  for (const k of ["totalPuzzles", "cycleCount", "timerStartedAt"]) if (!Number.isFinite(c[k]) || c[k] < 0) return bad(k);
  if (paused ? !(Number.isFinite(c.pausedAt) && c.pausedAt > 0) : c.pausedAt !== undefined) return bad("pausedAt");
  if (c.ownerTabId !== null && c.ownerTabId !== undefined && !Number.isInteger(c.ownerTabId)) return bad("owner");
  return { ok: true };
}

/** The parked map as stored, or an empty one when nothing (or something that is not a plain map) is stored. */
async function readParked() {
  const { pausedCycles } = await browser.storage.local.get("pausedCycles");
  return pausedCycles && typeof pausedCycles === "object" && !Array.isArray(pausedCycles) ? pausedCycles : {};
}
/** Store the parked map (the key goes away when none are left), together with `extra` keys in the same write. */
async function writeParked(parked, extra = {}) {
  if (Object.keys(parked).length) await browser.storage.local.set({ ...extra, pausedCycles: parked });
  else {
    if (Object.keys(extra).length) await browser.storage.local.set(extra);
    await browser.storage.local.remove("pausedCycles");
  }
}
const validCategoryKey = (c) => typeof c === "string" && c !== "" && c !== "__proto__";

async function parkCycle(cycle) {
  const check = checkCycle(cycle, { paused: true });
  if (!check.ok) return check;
  const parked = await readParked();
  parked[cycle.category] = cycle;
  await writeParked(parked);
  return { ok: true };
}

async function unparkCycle(category) {
  if (!validCategoryKey(category)) return { ok: false, error: "Invalid category." };
  const parked = await readParked();
  delete parked[category];
  await writeParked(parked);
  return { ok: true };
}

/** The popup starting (or continuing) a cycle: set it as the running one, park an old-shape paused one and/or take a resumed one out, in one write. */
async function startSession({ session, park, unpark }) {
  const check = checkCycle(session, { paused: false });
  if (!check.ok) return check;
  if (park) { const c = checkCycle(park, { paused: true }); if (!c.ok) return c; }
  if (unpark != null && !validCategoryKey(unpark)) return { ok: false, error: "Invalid category." };
  const parked = await readParked();
  if (park) parked[park.category] = park;
  if (unpark) delete parked[unpark];
  await writeParked(parked, { trainingSession: session });
  return { ok: true };
}

/* ============================================================
 * Training statistics (meta.trainingStats): recorded by the overlay, cleared by the options page
 * ============================================================ */
const MAX_STATS = 50; // the newest ones; older ones are dropped so storage does not grow without end

/** One finished cycle. Only these fields are kept, and every one must be a sensible value. Returns {ok, error}. */
async function recordStats(raw) {
  const isCount = (v) => Number.isFinite(v) && v >= 0;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Invalid statistics record." };
  if (typeof raw.category !== "string" || !raw.category || raw.category.length > MAX_NAME_LENGTH) return { ok: false, error: "Invalid statistics record." };
  for (const k of ["timeTaken", "totalPuzzles", "correct", "incorrect", "skipped", "completedAt"]) {
    if (!isCount(raw[k])) return { ok: false, error: "Invalid statistics record." };
  }
  const record = { category: raw.category, timeTaken: raw.timeTaken, totalPuzzles: raw.totalPuzzles, correct: raw.correct, incorrect: raw.incorrect, skipped: raw.skipped, completedAt: raw.completedAt };
  const data = await getAllData();
  if (!data.meta) data.meta = {};
  data.meta.trainingStats = [record, ...(data.meta.trainingStats || [])].slice(0, MAX_STATS);
  await saveAllData(data);
  return { ok: true };
}

async function clearStats() {
  const data = await getAllData();
  if (!data.meta) data.meta = {};
  data.meta.trainingStats = [];
  await saveAllData(data);
  return { ok: true };
}

/* ============================================================
 * Message handler — popup & options communicate via messages
 * ============================================================ */
// A content script lives in a web page's process and so is the part most exposed to what that page does. It may record a
// finished cycle, ask about its session and open the settings page; changing the library is for the extension's own pages.
const OVERLAY_MAY = new Set(["RECORD_STATS", "PARK_CYCLE", "UNPARK_CYCLE", "GET_SESSION_ROLE", "CLAIM_SESSION", "OPEN_OPTIONS_PAGE"]);
const fromExtensionPage = (sender) => typeof sender.url === "string" && sender.url.startsWith(browser.runtime.getURL(""));

async function handleMessage(message, sender) {
    if (!OVERLAY_MAY.has(message.type) && !fromExtensionPage(sender)) return { ok: false, error: "Not allowed from here." };
    switch (message.type) {
      case "GET_ALL_DATA":
        return await getAllData();

      case "CREATE_CATEGORY":
        return await serialized(() => createCategory(message.name));

      case "RENAME_CATEGORY":
        return await serialized(() => renameCategory(message.oldName, message.newName));

      case "DELETE_CATEGORY":
        return await serialized(() => deleteCategory(message.name));

      case "ADD_PUZZLE":
        return await serialized(() => addPuzzleToCategory(message.category, message.puzzleId));

      case "PARK_CYCLE":
        return await serialized(() => parkCycle(message.cycle));

      case "UNPARK_CYCLE":
        return await serialized(() => unparkCycle(message.category));

      case "START_SESSION":
        return await serialized(() => startSession(message));

      case "RECORD_STATS":
        return await serialized(() => recordStats(message.stats));

      case "CLEAR_STATS":
        return await serialized(() => clearStats());

      case "IMPORT_PREVIEW": {
        const plan = planImport(await getAllData(), message.payload);
        return plan.ok ? { ok: true, summary: plan.summary } : plan;
      }

      case "IMPORT_APPLY":
        return await serialized(() => importCategories(message.payload));

      case "REMOVE_PUZZLE":
        return await serialized(() => removePuzzleFromCategory(message.category, message.puzzleId));

      case "GET_SESSION_ROLE":
        return await sessionRole(sender.tab && sender.tab.id);

      case "CLAIM_SESSION":
        return await claimSession(sender.tab && sender.tab.id);

      case "OPEN_OPTIONS_PAGE":
        await browser.runtime.openOptionsPage();
        return { ok: true };

      default:
        return { ok: false, error: "Unknown message type." };
    }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return true to indicate async response (Chrome requirement)
  handleMessage(message, sender).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
