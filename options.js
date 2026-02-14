/**
 * Lichess Puzzle Notes — Options/Manager Page Logic
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

// Delete confirmation modal
const deleteOverlay = document.getElementById("delete-overlay");
const deleteMessage = document.getElementById("delete-message");
const deleteCancel = document.getElementById("delete-cancel");
const deleteConfirm = document.getElementById("delete-confirm");

const toastEl = document.getElementById("toast");
const btnExport = document.getElementById("btn-export");

let toastTimeout = null;
let modalMode = null; // "create" | "rename"
let modalRenameOld = null; // old name when renaming
let deleteCategoryName = null; // category pending deletion

/* ============================================================
 * SVG icon templates (inline for simplicity)
 * ============================================================ */
const ICONS = {
  open: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  remove: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
  rename: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
};

/* ============================================================
 * Initialisation
 * ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await refreshUI();
  bindEvents();
});

/* ============================================================
 * Refresh the full UI
 * ============================================================ */
async function refreshUI() {
  const data = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
  const categories = data.categories || {};
  const catNames = Object.keys(categories).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const filter = searchInput.value.trim().toLowerCase();

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
    const card = buildCategoryCard(catName, puzzles, totalCount);
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
 * Build a category card DOM element
 * ============================================================ */
function buildCategoryCard(catName, puzzles, totalCount) {
  const card = document.createElement("div");
  card.className = "category-card";

  // Header
  const header = document.createElement("div");
  header.className = "category-card-header";
  header.innerHTML = `
    <div class="category-card-title">
      <h3>${escapeHtml(catName)}</h3>
      <span class="count">${totalCount} puzzle${totalCount !== 1 ? "s" : ""}</span>
    </div>
    <div class="category-card-actions">
      <button class="btn-icon btn-rename" title="Rename category" data-cat="${escapeHtml(catName)}">${ICONS.rename}</button>
      <button class="btn-icon btn-delete-cat" title="Delete category" data-cat="${escapeHtml(catName)}">${ICONS.delete}</button>
    </div>
  `;
  card.appendChild(header);

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
        <span class="puzzle-chip-id">${escapeHtml(pid)}</span>
        <button class="btn-icon btn-open" title="Open puzzle" data-id="${escapeHtml(pid)}">${ICONS.open}</button>
        <button class="btn-icon btn-copy" title="Copy URL" data-id="${escapeHtml(pid)}">${ICONS.copy}</button>
        <button class="btn-icon btn-remove" title="Remove puzzle" data-id="${escapeHtml(pid)}" data-cat="${escapeHtml(catName)}">${ICONS.remove}</button>
      `;
      grid.appendChild(chip);
    });

    body.appendChild(grid);
  }

  card.appendChild(body);
  return card;
}

/* ============================================================
 * Event bindings
 * ============================================================ */
function bindEvents() {
  // New category button
  btnNewCategory.addEventListener("click", () => openModal("create"));

  // Search
  searchInput.addEventListener("input", () => refreshUI());

  // Export
  btnExport.addEventListener("click", handleExport);

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
    } else if (btn.classList.contains("btn-rename")) {
      openModal("rename", btn.dataset.cat);
    } else if (btn.classList.contains("btn-delete-cat")) {
      openDeleteConfirm(btn.dataset.cat);
    }
  });

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

  // Delete modal events
  deleteCancel.addEventListener("click", closeDeleteModal);
  deleteOverlay.addEventListener("click", (e) => {
    if (e.target === deleteOverlay) closeDeleteModal();
  });
  deleteConfirm.addEventListener("click", handleDeleteConfirm);
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

  let resp;
  if (modalMode === "create") {
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
      modalMode === "create" ? `Created "${name}"` : `Renamed to "${name}"`,
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
 * Delete category confirmation
 * ============================================================ */
function openDeleteConfirm(catName) {
  deleteCategoryName = catName;
  deleteMessage.textContent = `Are you sure you want to delete "${catName}" and all its puzzles? This cannot be undone.`;
  deleteOverlay.classList.remove("hidden");
}

function closeDeleteModal() {
  deleteOverlay.classList.add("hidden");
  deleteCategoryName = null;
}

async function handleDeleteConfirm() {
  if (!deleteCategoryName) return;
  const resp = await browser.runtime.sendMessage({
    type: "DELETE_CATEGORY",
    name: deleteCategoryName,
  });
  if (resp.ok) {
    showToast(`Deleted "${deleteCategoryName}"`, "success");
  } else {
    showToast(resp.error || "Error deleting category", "error");
  }
  closeDeleteModal();
  await refreshUI();
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

/* ============================================================
 * JSON Export
 * ============================================================ */
async function handleExport() {
  try {
    const data = await browser.runtime.sendMessage({ type: "GET_ALL_DATA" });
    const manifest = browser.runtime.getManifest();
    const now = new Date();

    const exportObj = {
      app: "lichess-puzzle-saver",
      exportVersion: 1,
      exportedAt: now.toISOString(),
      source: {
        extension: "chrome",
        extensionVersion: manifest.version,
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
