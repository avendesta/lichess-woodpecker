/**
 * Lichess Woodpecker — Options/Manager Page Logic
 * Full category and puzzle management: create, rename, delete categories;
 * open, copy, remove puzzles; search/filter across all categories.
 */

/* ============================================================
 * DOM references
 * ============================================================ */
const mainContent = document.getElementById("main-content");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const btnNewCategory = document.getElementById("btn-new-category");

// Category create/rename modal
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalInput = document.getElementById("modal-input");
const modalError = document.getElementById("modal-error");
const modalCancel = document.getElementById("modal-cancel");
const modalConfirm = document.getElementById("modal-confirm");

const srStatus = document.getElementById("sr-status"); // read out by screen readers, never shown

const btnExport = document.getElementById("btn-export");
const btnImport = document.getElementById("btn-import");
const importFile = document.getElementById("import-file");
const importOverlay = document.getElementById("import-overlay");
const importSummary = document.getElementById("import-summary");
const importCancel = document.getElementById("import-cancel");
const importConfirm = document.getElementById("import-confirm");
const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // a real export is a few KB; anything this big is not one

// Stats section
const statsSection = document.getElementById("stats-section");
const statsEmpty = document.getElementById("stats-empty");
const statsTableContainer = document.getElementById("stats-table-container");
const statsTable = document.getElementById("stats-table");
const statsTbody = document.getElementById("stats-tbody");
const btnClearStats = document.getElementById("btn-clear-stats");
const statsMore = document.getElementById("stats-more");
const statsCount = document.getElementById("stats-count");
const btnStatsMore = document.getElementById("btn-stats-more");
const clearOverlay = document.getElementById("clear-overlay");
const clearMessage = document.getElementById("clear-message");
const clearCancel = document.getElementById("clear-cancel");
const clearConfirm = document.getElementById("clear-confirm");
const btnBackup = document.getElementById("btn-backup");
const btnHelp = document.getElementById("btn-help");
const helpOverlay = document.getElementById("help-overlay");
const helpClose = document.getElementById("help-close");
const backupOverlay = document.getElementById("backup-overlay");
const backupClose = document.getElementById("backup-close");
const tabList = document.querySelector('[role="tablist"]');
const tabButtons = [...document.querySelectorAll('[role="tab"]')];
const STATS_PAGE = 10; // how many training cycles show at first, and how many more each "Load more" adds
let allStats = []; // every recorded cycle, newest first
let statsShown = STATS_PAGE;

const ALL = "All Categories"; // the name the combined run is stored under (a category may not use it)
let renderedFilter = ""; // the search text the list was last built for
let renderedList = null; // what the category list currently shows, to skip rebuilding it when nothing it shows has changed
let modalMode = null; // "create" | "rename"
let modalRenameOld = null; // old name when renaming

/* ============================================================
 * SVG icon templates (inline for simplicity)
 * ============================================================ */
/* ============================================================
 * Initialisation
 * ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  showVersion();
  await refreshUI();
  bindEvents();
  await loadStats();
  watchStorage();
});

/* ============================================================
 * Staying in sync: changes made elsewhere (a puzzle saved from the popup, a training cycle that just finished, an import in
 * another tab) arrive as storage events, so this page follows along without a reload. A burst of writes becomes one refresh.
 * ============================================================ */
let syncTimer = null;
function watchStorage() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes.lichessNotes || changes.pausedCycles || changes.trainingSession)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      await refreshUI();
      await loadStats();
    }, 60);
  });
}

/** Show the running extension version; the manifest is the only source of truth. */
function showVersion() {
  const rt = (typeof chrome !== "undefined" && chrome.runtime) ? chrome.runtime
           : (typeof browser !== "undefined" && browser.runtime ? browser.runtime : null);
  const manifest = rt && rt.getManifest ? rt.getManifest() : null;
  const el = document.getElementById("version");
  if (el) el.textContent = manifest ? `v${manifest.version}` : "";
  const about = document.getElementById("about-version"); // Help & About shows it too, from the same place
  if (about) about.textContent = manifest ? manifest.version : "";
}

/* ============================================================
 * Refresh the full UI
 * ============================================================ */
async function refreshUI() {
  const data = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
  const categories = data.categories || {};
  const { pausedCycles, trainingSession } = await browser.storage.local.get(["pausedCycles", "trainingSession"]);
  // the category being trained right now (not paused, not on its score screen): its Train button shows a gold bolt
  const running = trainingSession && !trainingSession.pausedAt && !trainingSession.cycleFinishedAt && typeof trainingSession.category === "string" ? trainingSession.category : null;
  const parked = pausedCycles || {}; // category -> its paused cycle: shown as a tag, and pressing Train continues it
  const everything = new Set(Object.values(categories).flat());
  const trainAll = document.getElementById("btn-train-all");
  const allWaiting = Object.hasOwn(parked, ALL) && Number.isFinite(parked[ALL].totalPuzzles) ? parked[ALL] : null;
  paintTrainButton(trainAll, allWaiting, running === ALL, "all categories");
  trainAll.disabled = everything.size === 0;
  if (everything.size === 0) trainAll.title = "Save a puzzle before training.";
  const catNames = Object.keys(categories).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const filter = searchInput.value.trim().toLowerCase();

  renderTotals(categories); // always the whole library, whatever the search shows

  // Rebuild the list only when what it shows has changed (a finished training cycle, for instance, changes nothing in it),
  // and put back whichever categories were open, so syncing never folds away what someone is reading.
  const shown = JSON.stringify([categories, filter, parked, running]);
  if (shown === renderedList) return;
  renderedList = shown;
  // Searching opens the categories that match, so the puzzles that matched are visible; clearing the search closes them again.
  // Only a change of the search text decides this: a sync while you search leaves whatever you opened or closed by hand alone.
  const filterChanged = filter !== renderedFilter;
  renderedFilter = filter;
  const open = new Set([...mainContent.querySelectorAll(".category-card:not(.collapsed) h3")].map((h) => h.textContent));

  mainContent.innerHTML = "";

  if (catNames.length === 0) {
    mainContent.appendChild(emptyState);
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  let anyVisible = false;

  catNames.forEach((catName) => {
    let puzzles = categories[catName] || [];
    const totalCount = puzzles.length;

    // Apply search filter
    if (filter) {
      puzzles = puzzles.filter((id) => id.toLowerCase().includes(filter));
      if (puzzles.length === 0) return;
    }

    anyVisible = true;
    const card = buildCategoryCard(catName, puzzles, totalCount, filterChanged ? filter !== "" : open.has(catName), Object.hasOwn(parked, catName) ? parked[catName] : null, catName === running);
    mainContent.appendChild(card);
  });

  if (!anyVisible) {
    const noMatch = document.createElement("p");
    noMatch.className = "empty-state";
    noMatch.textContent = filter
      ? "No puzzles match your search."
      : "No categories yet — create one to start saving puzzles.";
    mainContent.appendChild(noMatch);
  }
}

/* ============================================================
 * Totals: how many categories, and how many different puzzles are saved (one saved in several categories counts once)
 * ============================================================ */
function renderTotals(categories) {
  const names = Object.keys(categories);
  const puzzles = new Set(names.flatMap((n) => categories[n] || [])).size;
  document.getElementById("stat-categories").textContent = names.length;
  document.getElementById("stat-categories-label").textContent = names.length === 1 ? "Category" : "Categories";
  document.getElementById("stat-puzzles").textContent = puzzles;
  document.getElementById("stat-puzzles-label").textContent = puzzles === 1 ? "Puzzle" : "Puzzles";
}

/**
 * The Train button of a category row and of "Train all categories". It always says Train: a paused cycle shows in the row's
 * `⏸ n/total` tag, and pressing Train continues it. A gold bolt marks the cycle running now. `what` finishes the sentences:
 * "this category" or "all categories".
 */
const BOLT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
function paintTrainButton(btn, waiting, isRunning, what) {
  btn.classList.toggle("is-running", isRunning);
  btn.innerHTML = BOLT + "<span></span>";
  btn.querySelector("span").textContent = what === "all categories" ? "Train all categories" : "Train";
  btn.setAttribute("aria-label", `Train ${what}`);
  if (isRunning) btn.title = `Training ${what} now`;
  else if (waiting) btn.title = `Continue the paused cycle: ${waiting.completedInCycle || 0} of ${waiting.totalPuzzles} puzzles done`;
  else btn.title = `Train ${what}`;
}

/* ============================================================
 * Build a category card DOM element
 * ============================================================ */
function buildCategoryCard(catName, puzzles, totalCount, expanded = false, paused = null, isRunning = false) {
  const card = document.createElement("div");
  card.className = expanded ? "category-card" : "category-card collapsed";

  // Header
  const header = document.createElement("div");
  header.className = "category-card-header";
  header.innerHTML = `
    <div class="category-card-title">
      <div class="category-card-title-left">
        <span class="accordion-arrow">▶</span>
        <h3></h3>
        <span class="count"></span>
      </div>
    </div>
    <div class="category-card-actions">
      <button class="btn-train"></button><span class="actions-divider" aria-hidden="true"></span>
      <button class="btn-icon btn-rename" title="Rename category"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      <button class="btn-icon btn-delete-cat" title="Delete category"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
    </div>
  `;
  header.querySelector("h3").textContent = catName;
  const trainBtn = header.querySelector(".btn-train");
  const waiting = paused && Number.isFinite(paused.totalPuzzles) ? paused : null;
  paintTrainButton(trainBtn, waiting, isRunning, "this category");
  if (totalCount === 0) { // nothing to train: greyed out like the popup's, and a click says why
    trainBtn.setAttribute("aria-disabled", "true");
    trainBtn.title = "Save a puzzle before training.";
  }
  if (waiting) {
    const tag = document.createElement("span");
    tag.className = "paused-tag";
    tag.textContent = `⏸ ${waiting.completedInCycle || 0}/${waiting.totalPuzzles}`;
    header.querySelector(".category-card-title-left").appendChild(tag);
  }
  header.querySelector(".count").textContent = `${totalCount} puzzle${totalCount !== 1 ? "s" : ""}`;
  header.querySelectorAll(".category-card-actions button").forEach((b) => { b.dataset.cat = catName; });
  card.appendChild(header);

  // Add click handler to header for accordion toggle
  header.addEventListener("click", (e) => {
    // Don't toggle if clicking on action buttons
    if (e.target.closest(".category-card-actions")) return;
    
    card.classList.toggle("collapsed"); // the arrow turns and the body slides, both in CSS
  });

  // Body
  const body = document.createElement("div");
  body.className = "category-card-body";

  if (puzzles.length === 0) {
    body.innerHTML = `<p class="puzzle-empty">No puzzles saved in this category.</p>`;
  } else {
    const grid = document.createElement("div");
    grid.className = "puzzle-grid";

    puzzles.forEach((pid) => {
      const chip = document.createElement("div");
      chip.className = "puzzle-chip";
      chip.innerHTML = `
        <span class="puzzle-chip-id"></span>
        <button class="btn-icon btn-open" title="Open puzzle"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
        <button class="btn-icon btn-copy" title="Copy URL"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        <button class="btn-icon btn-remove" title="Remove puzzle"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      `;
      chip.querySelector(".puzzle-chip-id").textContent = pid;
      chip.querySelectorAll("button").forEach((b) => { b.dataset.id = pid; });
      chip.querySelector(".btn-remove").dataset.cat = catName;
      grid.appendChild(chip);
    });

    body.appendChild(grid);
  }

  const collapse = document.createElement("div"); // a grid row that animates between 1fr and 0fr: the body grows to its real height
  collapse.className = "category-card-collapse";
  collapse.appendChild(body);
  card.appendChild(collapse);
  return card;
}

/* ============================================================
 * Event bindings
 * ============================================================ */
function bindEvents() {
  // New category button
  document.getElementById("btn-train-all").addEventListener("click", () => trainCategory(ALL));
  btnNewCategory.addEventListener("click", () => openModal("create"));

  // Search
  searchInput.addEventListener("input", () => refreshUI());

  // Tabs
  tabButtons.forEach((t) => t.addEventListener("click", () => selectTab(t)));
  tabList.addEventListener("keydown", onTabKey);

  // Backup & Restore: one dialog holding Import and Export
  btnBackup.addEventListener("click", openBackup);
  backupClose.addEventListener("click", () => closeBackup());
  backupOverlay.addEventListener("click", (e) => {
    if (e.target === backupOverlay) closeBackup();
  });
  btnExport.addEventListener("click", async () => {
    await handleExport();
    closeBackup();
  });
  btnImport.addEventListener("click", () => importFile.click()); // the dialog stays until a file is chosen (cancelling the picker leaves it open)
  importFile.addEventListener("change", handleImportFile);
  importCancel.addEventListener("click", closeImport);
  importOverlay.addEventListener("click", (e) => {
    if (e.target === importOverlay) closeImport();
  });
  importConfirm.addEventListener("click", applyImport);

  // Help & About
  btnHelp.addEventListener("click", openHelp);
  helpClose.addEventListener("click", closeHelp);
  helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) closeHelp();
  });

  // Escape closes whichever of these dialogs is open
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!importOverlay.classList.contains("hidden")) closeImport();
    else if (!clearOverlay.classList.contains("hidden")) closeClearConfirm();
    else if (!backupOverlay.classList.contains("hidden")) closeBackup();
    else if (!helpOverlay.classList.contains("hidden")) closeHelp();
  });

  // Stats
  btnStatsMore.addEventListener("click", () => {
    statsShown += STATS_PAGE;
    renderStats();
  });
  btnClearStats.addEventListener("click", openClearConfirm);
  clearCancel.addEventListener("click", closeClearConfirm);
  clearOverlay.addEventListener("click", (e) => {
    if (e.target === clearOverlay) closeClearConfirm();
  });
  clearConfirm.addEventListener("click", clearStats);

  // Delegated clicks on main content (puzzle actions + category actions)
  mainContent.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.classList.contains("btn-open")) {
      const pid = btn.dataset.id;
      await browser.tabs.create({ url: `https://lichess.org/training/${pid}` });
    } else if (btn.classList.contains("btn-copy")) {
      const pid = btn.dataset.id;
      await copyToClipboard(`https://lichess.org/training/${pid}`);
      showToast("URL copied!", "success");
    } else if (btn.classList.contains("btn-remove")) {
      const pid = btn.dataset.id;
      const cat = btn.dataset.cat;
      const resp = await browser.runtime.sendMessage({
        type: "REMOVE_PUZZLE",
        category: cat,
        puzzleId: pid,
      });
      if (resp.ok) {
        showToast(`Removed ${pid}`, "success");
        await refreshUI();
      } else {
        showToast(resp.error || "Error", "error");
      }
    } else if (btn.classList.contains("btn-train")) {
      await trainCategory(btn.dataset.cat);
    } else if (btn.classList.contains("btn-rename")) {
      openModal("rename", btn.dataset.cat);
    } else if (btn.classList.contains("btn-delete-cat")) {
      await handleDeleteClick(btn);
    }
  });

  // An armed bin goes back to normal when anything else happens: a click elsewhere, Escape, focus leaving it
  document.addEventListener("click", (e) => { if (armedDelete && !armedDelete.btn.contains(e.target)) disarmDelete(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") disarmDelete(); });
  mainContent.addEventListener("focusout", (e) => { if (armedDelete && e.target === armedDelete.btn) disarmDelete(); });

  // Modal events
  modalCancel.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  modalConfirm.addEventListener("click", handleModalConfirm);
  modalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleModalConfirm();
    if (e.key === "Escape") closeModal();
  });
}

/* ============================================================
 * Category create/rename modal
 * ============================================================ */
function openModal(mode, oldName) {
  modalMode = mode;
  modalRenameOld = oldName || null;
  modalError.classList.add("hidden");
  modalInput.value = mode === "rename" ? oldName : "";

  if (mode === "create") {
    modalTitle.textContent = "New Category";
    modalConfirm.textContent = "Create";
  } else {
    modalTitle.textContent = "Rename Category";
    modalConfirm.textContent = "Rename";
  }

  modalOverlay.classList.remove("hidden");
  setTimeout(() => modalInput.focus(), 50);
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  modalMode = null;
  modalRenameOld = null;
}

async function handleModalConfirm() {
  const name = modalInput.value.trim();
  if (!name) {
    showModalError("Category name cannot be empty.");
    return;
  }

  const creating = modalMode === "create"; // read now: closeModal() clears modalMode before the toast is built
  let resp;
  if (creating) {
    resp = await browser.runtime.sendMessage({ type: "CREATE_CATEGORY", name });
  } else {
    resp = await browser.runtime.sendMessage({
      type: "RENAME_CATEGORY",
      oldName: modalRenameOld,
      newName: name,
    });
  }

  if (resp.ok) {
    closeModal();
    showToast(
      creating ? `Created "${name}"` : `Renamed to "${name}"`,
      "success"
    );
    await refreshUI();
  } else {
    showModalError(resp.error || "An error occurred.");
  }
}

function showModalError(msg) {
  modalError.textContent = msg;
  modalError.classList.remove("hidden");
}

/* ============================================================
 * Delete category: two clicks on the bin, no dialog
 * ============================================================
 * The first click arms the bin (it turns red, says so in its tooltip and to screen readers); the second deletes. It
 * disarms itself after a few seconds, when anything else is clicked, on Escape, when focus leaves it, and when another
 * bin is armed. A second click within a moment of the first (a reflex double-click) is ignored, so it cannot delete.
 */
const DELETE_ARM_MS = 4000;
const DELETE_GUARD_MS = 400;
let armedDelete = null; // { btn, at, timer }: the bin that has been clicked once

function armDelete(btn) {
  disarmDelete();
  const label = `Click again to delete "${btn.dataset.cat}"`;
  btn.classList.add("armed");
  btn.title = label;
  btn.setAttribute("aria-label", label);
  srStatus.textContent = label;
  armedDelete = { btn, at: Date.now(), timer: setTimeout(disarmDelete, DELETE_ARM_MS) };
}

function disarmDelete() {
  if (!armedDelete) return;
  const { btn, timer } = armedDelete;
  armedDelete = null;
  clearTimeout(timer);
  btn.classList.remove("armed");
  btn.title = "Delete category";
  btn.removeAttribute("aria-label");
  srStatus.textContent = "";
}

async function handleDeleteClick(btn) {
  if (!armedDelete || armedDelete.btn !== btn) { armDelete(btn); return; }
  if (Date.now() - armedDelete.at < DELETE_GUARD_MS) return; // a double-click: still armed, nothing deleted
  const name = btn.dataset.cat;
  disarmDelete();
  const resp = await browser.runtime.sendMessage({ type: "DELETE_CATEGORY", name });
  if (resp.ok) {
    showToast(`Deleted "${name}"`, "success");
  } else {
    showToast(resp.error || "Error deleting category", "error");
  }
  await refreshUI();
}

/* ============================================================
 * Clipboard helper
 * ============================================================ */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/* ============================================================
 * Tabs: Categories (the default) and Statistics, one panel at a time (the standard tabs pattern: arrows, Home and End
 * move between them, and only the selected tab is in the tab order)
 * ============================================================ */
function selectTab(tab, focus = false) {
  tabButtons.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  if (focus) tab.focus();
}

function onTabKey(e) {
  const i = tabButtons.indexOf(document.activeElement);
  if (i === -1) return;
  const last = tabButtons.length - 1;
  const target = { ArrowRight: tabButtons[i === last ? 0 : i + 1], ArrowLeft: tabButtons[i === 0 ? last : i - 1], Home: tabButtons[0], End: tabButtons[last] }[e.key];
  if (!target) return;
  e.preventDefault();
  selectTab(target, true);
}

/* ============================================================
 * Backup & Restore dialog
 * ============================================================ */
function openBackup() {
  backupOverlay.classList.remove("hidden");
  btnImport.focus();
}

// `refocus` is false when something else (the import preview) is taking over, so focus is not pulled back behind it
function closeBackup(refocus = true) {
  if (backupOverlay.classList.contains("hidden")) return;
  backupOverlay.classList.add("hidden");
  if (refocus) btnBackup.focus();
}

/* ============================================================
 * Help & About: a few links (documentation, issues, contact, privacy) and the version. Nothing is fetched or sent.
 * ============================================================ */
function openHelp() {
  helpOverlay.classList.remove("hidden");
  helpOverlay.querySelector(".help-item").focus();
}

function closeHelp() {
  if (helpOverlay.classList.contains("hidden")) return;
  helpOverlay.classList.add("hidden");
  btnHelp.focus();
}

/* ============================================================
 * JSON Import: read the file, ask the background what it would change, show that, and merge only on confirmation.
 * The background does all the validating, so the page only has to read JSON.
 * ============================================================ */
let pendingImport = null;

function closeImport() {
  importOverlay.classList.add("hidden");
  pendingImport = null;
}

function renderImportSummary(summary) {
  importSummary.replaceChildren();
  const line = (text, cls) => {
    const li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    importSummary.appendChild(li);
  };
  const nothingNew = summary.added === 0 && summary.newCategories.length === 0;
  if (nothingNew) {
    line("Everything in this file is already here.", "import-note");
  } else {
    if (summary.newCategories.length) line(`New categories: ${summary.newCategories.length}`);
    if (summary.mergedCategories.length) line(`Existing categories updated: ${summary.mergedCategories.length}`);
    line(`New puzzles added: ${summary.added}`);
  }
  if (summary.duplicates) line(`Already saved, skipped: ${summary.duplicates}`);
  if (summary.invalidIds) line(`Invalid puzzle IDs skipped: ${summary.invalidIds}`);
  if (summary.skippedNames) line(`Categories skipped (unusable name): ${summary.skippedNames}`);
  importConfirm.classList.toggle("hidden", nothingNew); // nothing to confirm
  importCancel.textContent = nothingNew ? "Close" : "Cancel";
  importOverlay.classList.remove("hidden");
  (nothingNew ? importCancel : importConfirm).focus();
}

async function handleImportFile() {
  const file = importFile.files[0];
  importFile.value = ""; // so choosing the same file again still fires "change"
  if (!file) return;
  closeBackup(false); // a file was chosen: the preview (or an error toast) takes over from the dialog
  if (file.size > IMPORT_MAX_BYTES) {
    showToast("That file is too large to be an export.", "error");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (e) {
    showToast("That file isn't valid JSON.", "error");
    return;
  }
  let resp;
  try {
    resp = await browser.runtime.sendMessage({ type: "IMPORT_PREVIEW", payload });
  } catch (e) {
    showToast("Couldn't reach the extension. Reload it and try again.", "error");
    return;
  }
  if (!resp || !resp.ok) {
    showToast((resp && resp.error) || "That file can't be imported.", "error");
    return;
  }
  pendingImport = payload;
  renderImportSummary(resp.summary);
}

async function applyImport() {
  const payload = pendingImport;
  closeImport();
  let resp;
  try {
    resp = await browser.runtime.sendMessage({ type: "IMPORT_APPLY", payload });
  } catch (e) {
    showToast("Couldn't reach the extension. Reload it and try again.", "error");
    return;
  }
  if (!resp || !resp.ok) {
    showToast((resp && resp.error) || "Import failed.", "error");
    return;
  }
  const { added, newCategories } = resp.summary;
  const bits = [];
  if (added) bits.push(`${added} new puzzle${added === 1 ? "" : "s"}`);
  if (newCategories.length) bits.push(`${newCategories.length} new categor${newCategories.length === 1 ? "y" : "ies"}`);
  showToast(`Imported ${bits.join(" and ")}.`, "success");
  await refreshUI();
}

/* ============================================================
 * JSON Export
 * ============================================================ */
async function handleExport() {
  try {
    const data = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
    const rt = (typeof chrome !== "undefined" && chrome.runtime) ? chrome.runtime
             : (typeof browser !== "undefined" && browser.runtime ? browser.runtime : null);
    const manifest = rt && rt.getManifest ? rt.getManifest() : null;
    const now = new Date();

    const exportObj = {
      app: "lichess-puzzle-saver",
      exportVersion: 1,
      exportedAt: now.toISOString(),
      source: {
        extension: "chrome",
        extensionVersion: manifest?.version || "unknown",
      },
      data: {
        categories: data.categories || {},
      },
    };

    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const filename = `lichess-puzzle-saver-export-${yyyy}-${mm}-${dd}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Export downloaded.", "success");
  } catch (e) {
    console.error("[options] Export error:", e);
    showToast("Export failed.", "error");
  }
}

/* ============================================================
 * Training Statistics Functions
 * ============================================================ */
function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

function getSuccessRateClass(rate) {
  if (rate >= 80) return 'high';
  if (rate >= 60) return 'medium';
  return 'low';
}

async function loadStats() {
  try {
    const result = await browser.storage.local.get("lichessNotes");
    const data = result.lichessNotes || {};
    const stats = data.meta?.trainingStats || [];
    // newest first, by the date each cycle finished (not by the order they happen to be stored in)
    allStats = stats.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    renderStats();
  } catch (error) {
    console.error('[options] Failed to load stats:', error);
  }
}

// Draws the first `statsShown` cycles; "Load more" raises that number by ten.
function renderStats() {
  if (allStats.length === 0) {
    statsEmpty.classList.remove('hidden');
    statsTableContainer.classList.add('hidden');
    statsMore.classList.add('hidden');
    return;
  }
  statsEmpty.classList.add('hidden');
  statsTableContainer.classList.remove('hidden');

  statsTbody.innerHTML = '';
  allStats.slice(0, statsShown).forEach(stat => {
    // Rows saved before first-try tracking only have `solved`, which mixed clean and after-a-mistake solves.
    const tracked = typeof stat.correct === 'number';
    const successRate = tracked && stat.totalPuzzles > 0 ? Math.round((stat.correct / stat.totalPuzzles) * 100) : null;
    const row = document.createElement('tr');

    row.innerHTML = `
      <td class="category-name"></td>
      <td class="time-taken"></td>
      <td class="total-puzzles"></td>
      <td class="correct"></td>
      <td class="incorrect"></td>
      <td class="skipped"></td>
      <td class="success-rate"></td>
      <td class="completed-date"></td>
    `;
    const cells = {
      ".category-name": stat.category,
      ".time-taken": formatTime(stat.timeTaken),
      ".total-puzzles": stat.totalPuzzles,
      ".correct": tracked ? stat.correct : "—",
      ".incorrect": tracked ? stat.incorrect : "—",
      ".skipped": stat.skipped,
      ".success-rate": successRate === null ? "—" : `${successRate}%`,
      ".completed-date": formatDate(stat.completedAt),
    };
    for (const [sel, value] of Object.entries(cells)) row.querySelector(sel).textContent = value;
    if (successRate !== null) row.querySelector(".success-rate").classList.add(getSuccessRateClass(successRate));
    else row.title = "Recorded before first-try tracking, so correct and incorrect are unknown.";

    statsTbody.appendChild(row);
  });

  // ten or fewer: nothing to load and nothing to count
  const shown = Math.min(statsShown, allStats.length);
  statsMore.classList.toggle('hidden', allStats.length <= STATS_PAGE);
  statsCount.textContent = `Showing ${shown} of ${allStats.length}`;
  btnStatsMore.classList.toggle('hidden', shown >= allStats.length);
}

// Clearing statistics cannot be undone, so it asks first, in the page: a native confirm() is auto-dismissed by automation
// and can be suppressed by the browser, which would make the button look dead.
function openClearConfirm() {
  if (allStats.length === 0) {
    showToast('There are no statistics to clear.', 'warn');
    return;
  }
  clearMessage.textContent = `This removes all ${allStats.length} recorded training cycle${allStats.length === 1 ? '' : 's'}. Your categories and puzzles are not affected. This cannot be undone.`;
  clearOverlay.classList.remove('hidden');
  clearCancel.focus(); // the safe answer is the default
}

function closeClearConfirm() {
  clearOverlay.classList.add('hidden');
  btnClearStats.focus();
}

async function clearStats() {
  closeClearConfirm();
  try {
    const response = await browser.runtime.sendMessage({ type: "CLEAR_STATS" }); // the background is the only writer of the library
    if (!response || !response.ok) throw new Error((response && response.error) || "no answer");

    statsShown = STATS_PAGE;
    await loadStats();
    showToast('Training statistics cleared.', 'success');

  } catch (error) {
    console.error('[options] Failed to clear stats:', error);
    showToast('Failed to clear training statistics.', 'error');
  }
}

/**
 * Train a category from here: like the popup's Train, but in a new tab (this page has no puzzle tab to take over). A parked
 * cycle of the category is continued; otherwise a fresh shuffled cycle starts. The new tab owns the session, and the
 * background sets it (START_SESSION) before the tab is pointed at the puzzle, so the overlay finds its owner at once.
 */
let training = false; // a second click while the first is still starting would open a second tab and replace the cycle just continued
async function trainCategory(name) {
  if (training) return;
  training = true;
  try {
    await startCategory(name);
  } catch (err) {
    showToast("Could not start training.", "error");
  } finally {
    training = false;
  }
}

async function startCategory(name) {
  const all = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
  if (!all || all.ok === false) {
    showToast((all && all.error) || "Could not read your library.", "error");
    return;
  }
  const categories = all.categories || {};
  const pool = name === ALL ? [...new Set(Object.values(categories).flat())] : Object.hasOwn(categories, name) ? categories[name] : [];
  if (pool.length === 0) {
    showToast("No puzzles to train.", "warn");
    return;
  }
  const { trainingSession, pausedCycles } = await browser.storage.local.get(["trainingSession", "pausedCycles"]);
  const { session, park, unpark } = buildSession(name, pool, trainingSession, pausedCycles);
  const tab = await browser.tabs.create({ url: "about:blank" });
  session.ownerTabId = tab.id;
  let response;
  try {
    response = await browser.runtime.sendMessage({ type: "START_SESSION", session, park, unpark });
  } catch (err) {
    response = null;
  }
  if (!response || !response.ok) {
    showToast((response && response.error) || "Could not start training.", "error");
    chrome.tabs.remove(tab.id);
    return;
  }
  chrome.tabs.update(tab.id, { url: session.queue[session.currentIndex] });
}
