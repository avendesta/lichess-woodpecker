/**
 * Lichess Puzzle Notes — Popup UI Logic
 * Handles save flow, category selection, quick puzzle view, and search.
 */

/* ============================================================
 * DOM references
 * ============================================================ */
const statusValid = document.getElementById("status-valid");
const statusInvalid = document.getElementById("status-invalid");
const puzzleIdDisplay = document.getElementById("puzzle-id-display");
const categorySelect = document.getElementById("category-select");
const newCategoryGroup = document.getElementById("new-category-group");
const newCategoryInput = document.getElementById("new-category-input");
const btnSave = document.getElementById("btn-save");
const btnOptions = document.getElementById("btn-options");
const toastEl = document.getElementById("toast");
const categoriesList = document.getElementById("categories-list");
const emptyState = document.getElementById("empty-state");

let currentPuzzleId = null; // extracted from current tab
let currentTabId = null; // active tab ID, needed for DOM extraction
let isTrainingPage = false; // true when the active tab is a Lichess training page
let toastTimeout = null;

/* ============================================================
 * Initialisation
 * ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await detectCurrentTab();
  await refreshUI();
  bindEvents();
});

/* ============================================================
 * Detect current tab and extract puzzle ID from DOM
 * ============================================================
 * 1. Gate: check the URL is a Lichess training page
 * 2. Extract: inject a function into the page to read the puzzle ID from the DOM
 * The puzzle ID is always obtained from the DOM (single source of truth).
 * ============================================================ */
async function detectCurrentTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      showInvalidStatus();
      return;
    }
    currentTabId = tabs[0].id;
    const url = tabs[0].url || "";

    // Gate: is this a Lichess training page?
    const resp = await browser.runtime.sendMessage({ type: "IS_TRAINING_PAGE", url });
    if (!resp || !resp.isTrainingPage) {
      isTrainingPage = false;
      showInvalidStatus();
      return;
    }

    isTrainingPage = true;

    // Extract puzzle ID from the DOM
    const domId = await extractPuzzleIdFromDOM();
    if (domId) {
      currentPuzzleId = domId;
      showValidStatus(currentPuzzleId);
    } else {
      showInvalidStatus();
    }
  } catch (e) {
    console.error("[popup] Tab detection error:", e);
    showInvalidStatus();
  }
}

/**
 * Inject an inline function into the active tab to extract the puzzle ID from the DOM.
 * Uses chrome.scripting.executeScript with func: (not files:) so it works with
 * activeTab permission alone — no host_permissions required.
 */
async function extractPuzzleIdFromDOM() {
  try {
    const api = (typeof chrome !== "undefined" && chrome.scripting) ? chrome : browser;
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
    console.error("[popup] DOM extraction error:", e);
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

function showValidStatus(id) {
  puzzleIdDisplay.textContent = id;
  statusValid.classList.remove("hidden");
  statusInvalid.classList.add("hidden");
  document.getElementById("save-section").classList.remove("hidden");
}

function showInvalidStatus() {
  statusValid.classList.add("hidden");
  statusInvalid.classList.remove("hidden");
  // Hide save section when no valid puzzle
  document.getElementById("save-section").classList.add("hidden");
}

/* ============================================================
 * Refresh the full UI (categories dropdown + puzzle list)
 * ============================================================ */
async function refreshUI() {
  const data = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
  const categories = data.categories || {};
  const catNames = Object.keys(categories).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  // Rebuild category dropdown
  rebuildCategoryDropdown(catNames);

  // Rebuild puzzle list view
  renderPuzzleList(categories, catNames);
}

function rebuildCategoryDropdown(catNames) {
  // Preserve current selection if possible
  const prev = categorySelect.value;
  categorySelect.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.disabled = true;
  defaultOpt.selected = true;
  defaultOpt.textContent = "Select category…";
  categorySelect.appendChild(defaultOpt);

  catNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    categorySelect.appendChild(opt);
  });

  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "+ New category…";
  categorySelect.appendChild(newOpt);

  // Restore previous selection
  if (prev && prev !== "__new__" && catNames.includes(prev)) {
    categorySelect.value = prev;
  }

  updateSaveButton();
}

/* ============================================================
 * Render puzzle list grouped by category
 * ============================================================ */
function renderPuzzleList(categories, catNames) {
  categoriesList.innerHTML = "";

  if (catNames.length === 0) {
    emptyState.classList.remove("hidden");
    categoriesList.appendChild(emptyState);
    return;
  }

  emptyState.classList.add("hidden");

  catNames.forEach((catName) => {
    const puzzles = categories[catName] || [];

    const block = document.createElement("div");
    block.className = "category-block";

    // Header
    const header = document.createElement("div");
    header.className = "category-header";

    const headerLeft = document.createElement("div");
    headerLeft.innerHTML = `
      <span class="category-name">${escapeHtml(catName)}</span>
      <span class="category-count">(${puzzles.length})</span>
    `;

    const headerRight = document.createElement("div");
    headerRight.className = "category-header-actions";

    // Play button
    const playBtn = document.createElement("button");
    playBtn.className = "btn-play";
    playBtn.title = puzzles.length > 0 ? "Start Woodpecker Training" : "No puzzles to train";
    if (puzzles.length === 0) {
      playBtn.disabled = true;
    }
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    playBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await startTrainingSession(catName, categories[catName] || []);
    });
    headerRight.appendChild(playBtn);

    // Copy IDs button
    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy-ids";
    copyBtn.title = "Copy IDs";
    copyBtn.dataset.cat = catName;
    if (puzzles.length === 0) {
      copyBtn.disabled = true;
      copyBtn.title = "No IDs to copy";
    }
    copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy IDs`;
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ids = categories[catName] || [];
      if (ids.length === 0) return;
      await copyToClipboard(JSON.stringify(ids));
      showToast("Copied IDs", "success");
    });
    headerRight.appendChild(copyBtn);

    const toggle = document.createElement("span");
    toggle.className = "category-toggle";
    toggle.textContent = "▶";
    headerRight.appendChild(toggle);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);
    block.appendChild(header);

    // Puzzle list
    const list = document.createElement("div");
    list.className = "puzzle-list hidden";

    if (puzzles.length === 0) {
      list.innerHTML = `<p class="puzzle-empty">No puzzles saved in this category.</p>`;
    } else {
      puzzles.forEach((pid) => {
        const row = document.createElement("div");
        row.className = "puzzle-row";
        row.innerHTML = `
          <span class="puzzle-id">${escapeHtml(pid)}</span>
          <div class="puzzle-actions">
            <button class="btn-open" title="Open puzzle" data-id="${escapeHtml(pid)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="btn-remove" title="Remove puzzle" data-id="${escapeHtml(pid)}" data-cat="${escapeHtml(catName)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        `;
        list.appendChild(row);
      });
    }

    block.appendChild(list);
    categoriesList.appendChild(block);

    // Toggle collapse (only on header left side + toggle icon, not on copy button)
    header.addEventListener("click", (e) => {
      if (e.target.closest(".btn-copy-ids") || e.target.closest(".btn-play")) return;
      const isOpen = toggle.classList.contains("open");
      if (isOpen) {
        toggle.classList.remove("open");
        list.classList.add("hidden");
      } else {
        toggle.classList.add("open");
        list.classList.remove("hidden");
      }
    });
  });
}

/* ============================================================
 * Event bindings
 * ============================================================ */
function bindEvents() {
  // Category dropdown change
  categorySelect.addEventListener("change", () => {
    if (categorySelect.value === "__new__") {
      newCategoryGroup.classList.remove("hidden");
      newCategoryInput.focus();
    } else {
      newCategoryGroup.classList.add("hidden");
    }
    updateSaveButton();
  });

  // New category input — enable save when typing
  newCategoryInput.addEventListener("input", updateSaveButton);

  // Save button
  btnSave.addEventListener("click", handleSave);

  // Options page
  btnOptions.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });

  // Delegated clicks for puzzle actions
  categoriesList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const puzzleId = btn.dataset.id;
    if (!puzzleId) return;

    if (btn.classList.contains("btn-open")) {
      await browser.tabs.create({ url: `https://lichess.org/training/${puzzleId}` });
    } else if (btn.classList.contains("btn-remove")) {
      const cat = btn.dataset.cat;
      const resp = await browser.runtime.sendMessage({
        type: "REMOVE_PUZZLE",
        category: cat,
        puzzleId,
      });
      if (resp.ok) {
        showToast(`Removed ${puzzleId}`, "success");
        await refreshUI();
      } else {
        showToast(resp.error || "Error removing puzzle", "error");
      }
    }
  });
}

/* ============================================================
 * Save handler
 * ============================================================ */
async function handleSave() {
  // Always re-extract from DOM on each save click, because puzzles
  // change dynamically on Lichess training pages.
  if (isTrainingPage) {
    const freshId = await extractPuzzleIdFromDOM();
    if (freshId) {
      currentPuzzleId = freshId;
      showValidStatus(currentPuzzleId);
    } else {
      showInvalidStatus();
      showToast("No puzzle found on page.", "error");
      return;
    }
  }

  if (!currentPuzzleId) return;

  let category = categorySelect.value;

  // Creating a new category inline
  if (category === "__new__") {
    const newName = newCategoryInput.value.trim();
    if (!newName) {
      showToast("Enter a category name.", "warn");
      newCategoryInput.focus();
      return;
    }
    const createResp = await browser.runtime.sendMessage({ type: "CREATE_CATEGORY", name: newName });
    if (!createResp.ok) {
      showToast(createResp.error, "error");
      return;
    }
    category = newName;
    newCategoryInput.value = "";
    newCategoryGroup.classList.add("hidden");
  }

  if (!category || category === "__new__") {
    showToast("Select a category first.", "warn");
    return;
  }

  const resp = await browser.runtime.sendMessage({
    type: "ADD_PUZZLE",
    category,
    puzzleId: currentPuzzleId,
  });

  if (resp.ok) {
    showToast(`Saved ${currentPuzzleId} to ${category}`, "success");
    await refreshUI();
    // Re-select the category
    categorySelect.value = category;
  } else if (resp.duplicate) {
    showToast("Already saved.", "warn");
  } else {
    showToast(resp.error || "Error saving puzzle.", "error");
  }
}

/* ============================================================
 * Update save button enabled state
 * ============================================================ */
function updateSaveButton() {
  if (!currentPuzzleId) {
    btnSave.disabled = true;
    return;
  }
  const val = categorySelect.value;
  if (val === "__new__") {
    btnSave.disabled = !newCategoryInput.value.trim();
  } else {
    btnSave.disabled = !val;
  }
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

async function startTrainingSession(categoryName, puzzleIds) {
  if (puzzleIds.length === 0) {
    showToast("No puzzles to train.", "warn");
    return;
  }

  // Check for existing session
  const result = await browser.storage.local.get("trainingSession");
  if (result.trainingSession) {
    const confirmed = confirm("A training session is already in progress. Start a new one?");
    if (!confirmed) return;
  }

  // Deduplicate IDs
  const unique = [...new Set(puzzleIds)];
  const queue = fisherYatesShuffle(unique.map((id) => `https://lichess.org/training/${id}`));

  const session = {
    category: categoryName,
    queue: queue,
    currentIndex: 0,
    totalPuzzles: unique.length,
    cycleCount: 1,
    timerStartedAt: Date.now(),
    isMinimized: false,
    completedInCycle: 0,
  };

  await browser.storage.local.set({ trainingSession: session });

  // Navigate active tab to first puzzle and close popup
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { url: queue[0] }, () => {
      window.close();
    });
  } else {
    window.close();
  }
}

/* ============================================================
 * Clipboard helper
 * ============================================================ */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers / restricted contexts
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
 * HTML escaping
 * ============================================================ */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
