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
const searchInput = document.getElementById("search-input");

let currentPuzzleId = null; // extracted from current tab
let currentTabId = null; // active tab ID, needed for DOM extraction
let needsDomExtraction = false; // true when ID must come from page DOM
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
 * Detect current tab URL and extract puzzle ID
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
    const resp = await browser.runtime.sendMessage({ type: "EXTRACT_PUZZLE_ID", url });

    if (resp && resp.puzzleId === "NEED_DOM") {
      // URL is a valid training page but ID must be extracted from the DOM
      needsDomExtraction = true;
      const domId = await extractPuzzleIdFromDOM();
      if (domId) {
        currentPuzzleId = domId;
        showValidStatus(currentPuzzleId);
      } else {
        showInvalidStatus();
      }
    } else if (resp && resp.puzzleId) {
      needsDomExtraction = false;
      currentPuzzleId = resp.puzzleId;
      showValidStatus(currentPuzzleId);
    } else {
      needsDomExtraction = false;
      showInvalidStatus();
    }
  } catch (e) {
    console.error("[popup] Tab detection error:", e);
    showInvalidStatus();
  }
}

/**
 * Inject a content script into the active tab to extract the puzzle ID from the DOM.
 * Used when the URL is /training or /training/mix and the ID isn't in the path.
 */
async function extractPuzzleIdFromDOM() {
  try {
    // Use chrome.scripting API (available via polyfill or natively)
    const api = (typeof chrome !== "undefined" && chrome.scripting) ? chrome : browser;
    const results = await api.scripting.executeScript({
      target: { tabId: currentTabId },
      files: ["extract-puzzle.js"],
    });
    // executeScript returns an array of InjectionResult; the script's return value is in .result
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
  renderPuzzleList(categories, catNames, searchInput.value.trim());
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
function renderPuzzleList(categories, catNames, filter) {
  categoriesList.innerHTML = "";
  const lowerFilter = (filter || "").toLowerCase();

  if (catNames.length === 0) {
    emptyState.classList.remove("hidden");
    categoriesList.appendChild(emptyState);
    return;
  }

  emptyState.classList.add("hidden");

  catNames.forEach((catName) => {
    let puzzles = categories[catName] || [];

    // Apply search filter
    if (lowerFilter) {
      puzzles = puzzles.filter((id) => id.toLowerCase().includes(lowerFilter));
      // Hide category entirely if no matches
      if (puzzles.length === 0) return;
    }

    const block = document.createElement("div");
    block.className = "category-block";

    // Header
    const header = document.createElement("div");
    header.className = "category-header";
    header.innerHTML = `
      <div>
        <span class="category-name">${escapeHtml(catName)}</span>
        <span class="category-count">(${categories[catName].length})</span>
      </div>
      <span class="category-toggle open">▶</span>
    `;
    block.appendChild(header);

    // Puzzle list
    const list = document.createElement("div");
    list.className = "puzzle-list";

    if (puzzles.length === 0 && !lowerFilter) {
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
            <button class="btn-copy" title="Copy URL" data-id="${escapeHtml(pid)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
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

    // Toggle collapse
    header.addEventListener("click", () => {
      const toggle = header.querySelector(".category-toggle");
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

  // If filter hid everything
  if (categoriesList.children.length === 0) {
    const noMatch = document.createElement("p");
    noMatch.className = "empty-state";
    noMatch.textContent = "No puzzles match your search.";
    categoriesList.appendChild(noMatch);
  }
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

  // Search
  searchInput.addEventListener("input", () => {
    refreshUI();
  });

  // Delegated clicks for puzzle actions
  categoriesList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const puzzleId = btn.dataset.id;
    if (!puzzleId) return;

    if (btn.classList.contains("btn-open")) {
      await browser.tabs.create({ url: `https://lichess.org/training/${puzzleId}` });
    } else if (btn.classList.contains("btn-copy")) {
      await copyToClipboard(`https://lichess.org/training/${puzzleId}`);
      showToast("URL copied!", "success");
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
  // Re-extract from DOM on each save click when the URL doesn't contain the ID,
  // because puzzles change dynamically on /training and /training/mix pages.
  if (needsDomExtraction) {
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
