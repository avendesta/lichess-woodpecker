/**
 * Lichess Woodpecker — Popup UI Logic
 * Saving the current puzzle into a category is the main action; training a category is secondary.
 * State lives in `data` (the stored categories + metadata), `currentPuzzleId` and the search box; every render
 * function reads from those, and event handlers only change them.
 */

/* ============================================================
 * DOM references and state
 * ============================================================ */
const puzzleCard = document.getElementById("puzzle-card");
const puzzleIdDisplay = document.getElementById("puzzle-id-display");
const puzzleBadge = document.getElementById("puzzle-badge");
const statCategories = document.getElementById("stat-categories");
const statCategoriesLabel = document.getElementById("stat-categories-label");
const statPuzzles = document.getElementById("stat-puzzles");
const statPuzzlesLabel = document.getElementById("stat-puzzles-label");
const searchInput = document.getElementById("search");
const btnNew = document.getElementById("btn-new");
const newForm = document.getElementById("new-category");
const newName = document.getElementById("new-name");
const newError = document.getElementById("new-error");
const newCancel = document.getElementById("new-cancel");
const categoryList = document.getElementById("category-list");
const btnTrainAll = document.getElementById("btn-train-all");
const btnOptions = document.getElementById("btn-options");
const toastEl = document.getElementById("toast");
const srStatus = document.getElementById("sr-status"); // read out by screen readers, never shown

let currentPuzzleId = null; // read from the active tab's DOM; null when it is not a puzzle page
let currentTabId = null; // active tab ID, needed for DOM extraction
let toastTimeout = null;

let data = { categories: {}, meta: {}, paused: {}, running: null }; // what is stored: the categories, their metadata and the parked paused cycles
let query = ""; // the search box
let saving = false;

// Palette indexes are what get stored per category (see background.js); keep PALETTE the same length as PALETTE_SIZE there.
const PALETTE = ["#3b82f6", "#ef4444", "#a855f7", "#2ecc71", "#facc15", "#f97316", "#06b6d4", "#ec4899"];

/* ============================================================
 * Initialisation
 * ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await detectCurrentTab();
  await loadData();
  bindEvents();
  renderAll();
});

/* ============================================================
 * Detect current tab and extract puzzle ID from DOM
 * ============================================================
 * The puzzle ID is read from the page's own DOM and nowhere else: no URL is read or parsed. A page that is not a
 * puzzle simply has no matching link, so extraction returns null and the popup shows its "no puzzle" state.
 * ============================================================ */
async function detectCurrentTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    currentTabId = tabs[0].id;
    currentPuzzleId = await extractPuzzleIdFromDOM();
  } catch (e) {
    console.error("[popup] Tab detection error:", e);
  }
}

/**
 * Inject an inline function into the active tab to extract the puzzle ID from the DOM.
 * Uses chrome.scripting.executeScript with func: (not files:) so it works with
 * activeTab permission alone — no host_permissions required.
 */
async function extractPuzzleIdFromDOM() {
  try {
    // browser.scripting where it exists (Firefox: promises). Its chrome.* is callback-only and would return undefined here,
    // so chrome.scripting is only for Chrome, whose polyfill has no scripting and whose chrome.* returns promises.
    const api = (typeof browser !== "undefined" && browser.scripting) ? browser : chrome;
    const results = await api.scripting.executeScript({
      target: { tabId: currentTabId },
      func: extractPuzzleIdFromPage,
    });
    const id = results && results[0] && results[0].result;
    // Strict validation: must be exactly 5 alphanumeric characters
    if (id && /^[A-Za-z0-9]{5}$/.test(id)) {
      return id;
    }
    return null;
  } catch (e) {
    // Expected on tabs we can't inject into (browser pages, the web store); there is simply no puzzle there.
    console.debug("[popup] No puzzle ID from this tab:", e && e.message);
    return null;
  }
}

/**
 * This function is serialised and injected into the page context.
 * It runs in the content script world, NOT in the popup.
 * It must be self-contained — no closures or external references.
 *
 * Strict extraction rules:
 *   - Only matches <a> elements whose href is /training/{5-char-id}
 *   - The anchor's textContent must match exactly #[A-Za-z0-9]{5}
 *   - Prefers visible anchors closest to a "Puzzle" label/container
 *   - Does NOT scan arbitrary page text to avoid false positives
 */
function extractPuzzleIdFromPage() {
  const TEXT_RE = /^#[A-Za-z0-9]{5}$/;
  const links = document.querySelectorAll('a[href^="/training/"]');
  const candidates = [];

  for (const link of links) {
    const hrefMatch = link.getAttribute("href").match(/^\/training\/([A-Za-z0-9]{5})$/);
    if (!hrefMatch) continue;
    const id = hrefMatch[1];
    const text = link.textContent.trim();
    if (!TEXT_RE.test(text)) continue;
    if (text.slice(1) !== id) continue;
    candidates.push({ link, id });
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;

  // Multiple matches: prefer a visible anchor (offsetParent !== null)
  const visible = candidates.filter((c) => c.link.offsetParent !== null);
  if (visible.length === 1) return visible[0].id;

  // Among visible (or all if none visible), prefer one inside a parent containing "Puzzle" text
  const pool = visible.length > 0 ? visible : candidates;
  for (const c of pool) {
    const parent = c.link.closest("p, div, span, header, section");
    if (parent && /\bPuzzle\b/i.test(parent.textContent)) {
      return c.id;
    }
  }

  return pool[0].id;
}


/* ============================================================
 * Data helpers
 * ============================================================ */
async function loadData() {
  const d = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
  const { pausedCycles, trainingSession } = await browser.storage.local.get(["pausedCycles", "trainingSession"]);
  // the cycle being trained now (not paused, not on its score screen): its bolt is drawn gold
  const running = trainingSession && !trainingSession.pausedAt && !trainingSession.cycleFinishedAt && typeof trainingSession.category === "string" ? trainingSession.category : null;
  data = { categories: (d && d.categories) || {}, meta: (d && d.meta) || {}, paused: pausedCycles || {}, running };
}

function categoryNames() {
  return Object.keys(data.categories).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function savedIn() {
  return currentPuzzleId ? categoryNames().filter((n) => data.categories[n].includes(currentPuzzleId)) : [];
}

// Must match hashColor in background.js (a test compares them): the colour of a category that has none stored yet.
function hashColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % PALETTE.length;
}

function colorOf(name) {
  const stored = data.meta.categoryMeta && data.meta.categoryMeta[name] && data.meta.categoryMeta[name].color;
  return Number.isInteger(stored) ? stored : hashColor(name);
}

function setDisabled(el, disabled, title) {
  el.setAttribute("aria-disabled", String(disabled)); // stays focusable, so its explanation can be read
  el.title = title;
}

/* ============================================================
 * Rendering
 * ============================================================ */
function renderAll() {
  renderCard();
  renderSummary();
  renderList();
  renderFooter();
}

function renderCard() {
  const n = savedIn().length;
  puzzleCard.classList.toggle("is-unavailable", !currentPuzzleId);
  puzzleCard.classList.toggle("is-saved", !!currentPuzzleId && n > 0);
  puzzleCard.classList.toggle("is-unsaved", !!currentPuzzleId && n === 0);
  puzzleIdDisplay.textContent = currentPuzzleId || "No puzzle detected";
  puzzleBadge.hidden = !currentPuzzleId;
  puzzleBadge.textContent = n === 0 ? "Not saved" : `Saved in ${n} ${n === 1 ? "category" : "categories"}`;
}

// Totals for the whole library (a search does not change them): the categories, and the puzzles saved in them, counted
// once each however many categories hold the same one.
function renderSummary() {
  const categories = categoryNames().length;
  const puzzles = new Set(Object.values(data.categories).flat()).size;
  statCategories.textContent = categories;
  statCategoriesLabel.textContent = categories === 1 ? "Category" : "Categories";
  statPuzzles.textContent = puzzles;
  statPuzzlesLabel.textContent = puzzles === 1 ? "Puzzle" : "Puzzles";
}

function renderFooter() {
  const total = Object.values(data.categories).reduce((n, puzzles) => n + puzzles.length, 0);
  const waiting = data.paused["All Categories"] ? " (a paused cycle is waiting)" : "";
  setDisabled(btnTrainAll, total === 0, total === 0 ? "Save a puzzle before training." : `Train all categories${waiting}`);
  const running = data.running === "All Categories" && total > 0;
  btnTrainAll.classList.toggle("is-running", running);
  if (running) btnTrainAll.title = "Training all categories now";
}

function visibleNames() {
  const q = query.toLowerCase();
  const all = categoryNames();
  return q ? all.filter((n) => n.toLowerCase().includes(q)) : all;
}

function renderList() {
  const names = visibleNames();
  categoryList.replaceChildren();
  categoryList.scrollTop = 0;
  if (names.length === 0) {
    const p = document.createElement("p");
    p.className = "list-empty";
    p.setAttribute("role", "listitem");
    p.textContent = query ? `No categories match “${query}”.` : "No categories yet — create one with + New.";
    categoryList.appendChild(p);
    return;
  }
  categoryList.append(...names.map(buildRow));
}

function buildRow(name) {
  const row = document.createElement("div");
  row.className = "category-row";
  row.setAttribute("role", "listitem");
  row.dataset.cat = name;
  row.innerHTML = `
    <span class="cat-dot"></span>
    <span class="cat-name"></span>
    <span class="cat-count"></span>
    <span class="cat-paused" hidden></span>
    <div class="row-actions">
      <button class="btn-save" type="button">
        <span class="save-icons">
          <svg class="ico-bookmark" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 011 1v17l-7-4.5L5 21V4a1 1 0 011-1z"/></svg>
          <svg class="ico-plus" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <svg class="ico-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg>
          <svg class="ico-remove" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </span>
        <span class="save-label"></span>
      </button>
      <button class="btn-train" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span class="train-label">Train</span>
      </button>
    </div>
  `;
  const label = row.querySelector(".cat-name");
  label.textContent = name;
  label.title = name; // the full name, since long ones are truncated
  syncRow(row);
  return row;
}

// Brings one row in line with `data` and the current puzzle without rebuilding it.
function syncRow(row) {
  const name = row.dataset.cat;
  const puzzles = data.categories[name] || [];
  const saved = !!currentPuzzleId && puzzles.includes(currentPuzzleId);
  row.classList.toggle("is-saved", saved);
  row.querySelector(".cat-dot").style.background = PALETTE[colorOf(name) % PALETTE.length];
  row.querySelector(".cat-count").textContent = puzzles.length;
  const waiting = data.paused[name];
  const tag = row.querySelector(".cat-paused");
  tag.hidden = !waiting;
  if (waiting) {
    tag.textContent = `⏸ ${waiting.completedInCycle || 0}/${waiting.totalPuzzles}`;
    tag.title = `Paused: ${waiting.completedInCycle || 0} of ${waiting.totalPuzzles} puzzles done in cycle ${waiting.cycleCount || 1}`;
  }
  row.querySelector(".save-label").textContent = saved ? "Saved" : "Save";

  const save = row.querySelector(".btn-save");
  if (!currentPuzzleId) {
    setDisabled(save, true, "Open a Lichess puzzle to save it");
    save.setAttribute("aria-label", `Save to ${name}`);
  } else {
    setDisabled(save, false, saved ? "Remove from this category" : "Save this puzzle to this category");
    save.setAttribute("aria-label", saved ? `Remove ${currentPuzzleId} from ${name}` : `Save ${currentPuzzleId} to ${name}`);
  }

  const train = row.querySelector(".btn-train");
  train.setAttribute("aria-label", `Train ${name}`);
  setDisabled(train, puzzles.length === 0, puzzles.length === 0 ? "Save a puzzle before training." : "Train this category");
  const running = data.running === name && puzzles.length > 0;
  train.classList.toggle("is-running", running);
  if (running) train.title = "Training this category now";
}

function syncRows() {
  categoryList.querySelectorAll(".category-row").forEach(syncRow);
}

/* ============================================================
 * Actions
 * ============================================================ */
async function saveTo(name, row, btn) {
  if (btn.getAttribute("aria-disabled") === "true") {
    if (!currentPuzzleId) showToast("Open a Lichess puzzle to save it", "warn");
    return;
  }
  if (saving) return;
  if (row.classList.contains("is-saved")) return removeFrom(name);
  saving = true;
  try {
    const resp = await browser.runtime.sendMessage({ type: "ADD_PUZZLE", category: name, puzzleId: currentPuzzleId });
    if (resp.ok || resp.duplicate) {
      await loadData();
      syncRows(); // in place: nothing moves under the pointer
      renderCard();
      renderSummary(); // a puzzle the library did not have yet raises the puzzle total
      renderFooter(); // the first saved puzzle is what enables Train all
      // Saving shows no message of its own: the row turning to Saved is it. Only the surprise is worth a toast.
      if (resp.duplicate) showToast(`Already in ${name}`, "warn");
      else srStatus.textContent = `Saved to ${name}`;
    } else {
      showToast(resp.error || "Could not save the puzzle", "error");
      await loadData(); // e.g. the category was deleted elsewhere: show what is really stored
      renderAll();
    }
  } catch (e) {
    showToast("Could not save the puzzle", "error");
  } finally {
    saving = false;
  }
}

// The green check on a saved row is the way back out: clicking it takes this puzzle out of that category again.
async function removeFrom(name) {
  saving = true; // one request at a time, shared with saving
  try {
    const resp = await browser.runtime.sendMessage({ type: "REMOVE_PUZZLE", category: name, puzzleId: currentPuzzleId });
    if (resp.ok || resp.error === "Puzzle not found in category.") {
      await loadData(); // "not found" means it was already removed elsewhere: the popup just catches up
      syncRows();
      renderCard();
      renderSummary(); // the total only drops when the last category holding the puzzle lets go of it
      renderFooter(); // removing the last saved puzzle disables Train all
      if (resp.ok) srStatus.textContent = `Removed from ${name}`; // the row going back to Save is the visible confirmation
      else showToast(`Not saved in ${name} any more`, "warn");
    } else {
      showToast(resp.error || "Could not remove the puzzle", "error");
      await loadData(); // e.g. the category was deleted elsewhere: show what is really stored
      renderAll();
    }
  } catch (e) {
    showToast("Could not remove the puzzle", "error");
  } finally {
    saving = false;
  }
}

async function trainCategory(name, btn) {
  if (btn.getAttribute("aria-disabled") === "true") {
    showToast("Save a puzzle before training.", "warn");
    return;
  }
  await loadData();
  await startTrainingSession(name, data.categories[name] || []);
}

async function trainAll() {
  await loadData();
  const ids = Object.values(data.categories).flat();
  if (ids.length === 0) {
    showToast("Save a puzzle before training.", "warn");
    return;
  }
  await startTrainingSession("All Categories", ids);
}

function showNewError(message) {
  newError.textContent = message;
  newError.hidden = false;
}

function openNewForm() {
  newForm.hidden = false;
  newError.hidden = true;
  newName.value = "";
  newName.focus();
}

function closeNewForm() {
  newForm.hidden = true;
  newError.hidden = true;
}

async function createCategory(e) {
  e.preventDefault();
  const name = newName.value.trim();
  if (!name) return showNewError("Category name cannot be empty.");
  const resp = await browser.runtime.sendMessage({ type: "CREATE_CATEGORY", name });
  if (!resp.ok) return showNewError(resp.error || "Could not create the category.");

  await loadData(); // the current puzzle is deliberately NOT saved into the new category
  query = "";
  searchInput.value = "";
  closeNewForm();
  renderAll();
  const row = categoryList.querySelector(`.category-row[data-cat="${CSS.escape(name)}"]`);
  if (row) {
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("just-added");
  }
  showToast(`Created “${name}”`, "success");
}

/* ============================================================
 * Event bindings
 * ============================================================ */
function setHot(train, on) {
  const group = train && train.closest(".row-actions");
  if (group) group.classList.toggle("train-hot", on);
}

function bindEvents() {
  btnOptions.addEventListener("click", () => browser.runtime.openOptionsPage());
  // Chrome closes the popup when the new tab takes focus; Firefox leaves it open, and an open popup cannot read the new tab
  // (activeTab covers only the tab it was opened on), so it would go on saying "No puzzle detected" over a puzzle. Close it
  // ourselves; opening it again on the puzzle tab detects the puzzle. Modified clicks stay the browser's own business.
  document.querySelector(".puzzle-link").addEventListener("click", (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    browser.tabs.create({ url: e.currentTarget.href }).then(() => window.close(), () => showToast("Could not open Lichess puzzles", "error"));
  });
  btnTrainAll.addEventListener("click", () => {
    if (btnTrainAll.getAttribute("aria-disabled") === "true") showToast("Save a puzzle before training.", "warn");
    else trainAll();
  });

  searchInput.addEventListener("input", () => {
    query = searchInput.value.trim();
    renderList();
  });

  btnNew.addEventListener("click", () => (newForm.hidden ? openNewForm() : closeNewForm()));
  newForm.addEventListener("submit", createCategory);
  newCancel.addEventListener("click", () => {
    closeNewForm();
    btnNew.focus();
  });
  newName.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeNewForm();
      btnNew.focus();
    }
  });

  categoryList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    const row = btn && btn.closest(".category-row");
    if (!row) return;
    if (btn.classList.contains("btn-save")) saveTo(row.dataset.cat, row, btn);
    else if (btn.classList.contains("btn-train")) trainCategory(row.dataset.cat, btn);
  });

  // Train grows (and Save shrinks) while Train is hovered or keyboard-focused. A class on the group, not :has(),
  // because the extension supports Firefox 109 and :has() only arrived in 121.
  const trainOf = (e) => e.target.closest && e.target.closest(".btn-train");
  categoryList.addEventListener("pointerover", (e) => {
    const t = trainOf(e);
    if (t && t.getAttribute("aria-disabled") !== "true") setHot(t, true);
  });
  categoryList.addEventListener("pointerout", (e) => {
    const t = trainOf(e);
    if (t && !t.contains(e.relatedTarget) && !t.matches(":focus-visible")) setHot(t, false);
  });
  categoryList.addEventListener("focusin", (e) => {
    const t = trainOf(e);
    if (t && t.getAttribute("aria-disabled") !== "true" && t.matches(":focus-visible")) setHot(t, true);
  });
  categoryList.addEventListener("focusout", (e) => {
    const t = trainOf(e);
    if (t && !t.matches(":hover")) setHot(t, false);
  });
}

/* ============================================================
 * Toast notification
 * ============================================================ */
function showToast(message, type = "success") {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.className = `toast toast-${type}`;
  toastTimeout = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2500);
}

/* ============================================================
 * Woodpecker Training — start session
 * ============================================================ */
function fisherYatesShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// The tab training is started from becomes the session's owner and is the tab that navigates to the puzzle; then the popup
// closes. `parked` is what is left in the parked area afterwards, saved in the same write as the new active cycle.
// `park` is an old-shape paused cycle to keep, `unpark` the category whose parked cycle this session continues. They are
// applied by the background to the paused cycles as they are by then, together with setting the session, in one step.
async function openSessionInActiveTab(session, { park = null, unpark = null } = {}) {
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, resolve);
  });
  session.ownerTabId = tabs && tabs.length > 0 ? tabs[0].id : null;
  const response = await browser.runtime.sendMessage({ type: "START_SESSION", session, park, unpark });
  if (!response || !response.ok) {
    showToast((response && response.error) || "Could not start training.", "error");
    return;
  }
  if (tabs && tabs.length > 0) {
    await new Promise((resolve) => {
      chrome.tabs.update(tabs[0].id, { url: session.queue[session.currentIndex] }, resolve);
    });
  }
  window.close();
}

async function startTrainingSession(categoryName, puzzleIds) {
  if (puzzleIds.length === 0) {
    showToast("No puzzles to train.", "warn");
    return;
  }

  const { trainingSession, pausedCycles } = await browser.storage.local.get(["trainingSession", "pausedCycles"]);
  const parked = pausedCycles || {};
  let park = null; // a cycle paused in the old shape (still in the active slot) is parked now rather than lost
  if (trainingSession && trainingSession.pausedAt) park = { ...trainingSession, ownerTabId: null };

  // A category with a paused cycle just continues it: pressing Train means "carry on", so there is nothing to ask. (To start
  // over, continue and use Restart in the overlay, which asks first.) Other categories' paused cycles are not in the way at all.
  // Pressing Train while another cycle is running just starts the new one (it replaces the running cycle; no question, because
  // asking was only ever a native dialog that automation and some browser settings answer "no" unseen). Pausing in the
  // overlay is how to keep a place.
  let resumed = null;
  let unpark = null;
  if (park && park.category === categoryName) {
    resumed = park; // the old-shape paused cycle is this category's: continue it, nothing to park
    park = null;
  } else if (Object.hasOwn(parked, categoryName)) {
    resumed = { ...parked[categoryName] };
    unpark = categoryName;
  }
  if (resumed) {
    resumed.timerStartedAt += Date.now() - resumed.pausedAt; // the time spent paused is left out of the clock
    delete resumed.pausedAt;
    await openSessionInActiveTab(resumed, { park, unpark });
    return;
  }

  // Deduplicate IDs
  const unique = [...new Set(puzzleIds)];
  const queue = fisherYatesShuffle(unique.map((id) => `https://lichess.org/training/${id}`));

  await openSessionInActiveTab({
    category: categoryName,
    queue: queue,
    currentIndex: 0,
    totalPuzzles: unique.length,
    cycleCount: 1,
    timerStartedAt: Date.now(),
    isMinimized: false,
    completedInCycle: 0,
  }, { park });
}
