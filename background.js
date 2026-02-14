/**
 * Background service worker for Lichess Puzzle Notes.
 * Handles storage operations via message passing from popup/options pages.
 * Uses browser.storage.local for persistence.
 */

// Import polyfill for Chrome compatibility.
// In Chrome (service worker), use importScripts. In Firefox (background script), the
// polyfill is loaded via the manifest "scripts" array, but we still try importScripts
// as a fallback in case it's available.
try {
  importScripts("browser-polyfill.js");
} catch (_) {
  // Firefox background scripts don't support importScripts; polyfill is loaded via manifest.
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

/** Retrieve the full stored dataset; returns defaults if empty/corrupted. */
async function getAllData() {
  try {
    const result = await browser.storage.local.get("lichessNotes");
    if (
      result.lichessNotes &&
      typeof result.lichessNotes === "object" &&
      result.lichessNotes.categories
    ) {
      return result.lichessNotes;
    }
  } catch (e) {
    console.warn("[lichess-note] Storage read error, resetting:", e);
  }
  // Empty or corrupted — initialise with defaults
  await browser.storage.local.set({ lichessNotes: structuredClone(DEFAULT_DATA) });
  return structuredClone(DEFAULT_DATA);
}

/** Persist the full dataset, updating the meta timestamp. */
async function saveAllData(data) {
  data.meta.updatedAt = Date.now();
  await browser.storage.local.set({ lichessNotes: data });
}

/** Create a new category. Returns {ok, error}. */
async function createCategory(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { ok: false, error: "Category name cannot be empty." };

  const data = await getAllData();
  // Case-insensitive duplicate check
  const existing = Object.keys(data.categories).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) return { ok: false, error: `Category "${existing}" already exists.` };

  data.categories[trimmed] = [];
  await saveAllData(data);
  return { ok: true };
}

/** Rename a category. Returns {ok, error}. */
async function renameCategory(oldName, newName) {
  const trimmedNew = (newName || "").trim();
  if (!trimmedNew) return { ok: false, error: "Category name cannot be empty." };

  const data = await getAllData();
  if (!(oldName in data.categories))
    return { ok: false, error: `Category "${oldName}" not found.` };

  if (oldName !== trimmedNew) {
    const clash = Object.keys(data.categories).find(
      (k) => k.toLowerCase() === trimmedNew.toLowerCase() && k !== oldName
    );
    if (clash) return { ok: false, error: `Category "${clash}" already exists.` };
  }

  data.categories[trimmedNew] = data.categories[oldName];
  delete data.categories[oldName];
  await saveAllData(data);
  return { ok: true };
}

/** Delete a category and all its puzzle IDs. Returns {ok, error}. */
async function deleteCategory(name) {
  const data = await getAllData();
  if (!(name in data.categories))
    return { ok: false, error: `Category "${name}" not found.` };

  delete data.categories[name];
  await saveAllData(data);
  return { ok: true };
}

/** Add a puzzle ID to a category. Prevents duplicates. Returns {ok, duplicate, error}. */
async function addPuzzleToCategory(category, puzzleId) {
  const data = await getAllData();
  if (!(category in data.categories))
    return { ok: false, error: `Category "${category}" not found.` };

  if (data.categories[category].includes(puzzleId))
    return { ok: false, duplicate: true, error: "Already saved." };

  data.categories[category].push(puzzleId);
  await saveAllData(data);
  return { ok: true };
}

/** Remove a puzzle ID from a category. Returns {ok, error}. */
async function removePuzzleFromCategory(category, puzzleId) {
  const data = await getAllData();
  if (!(category in data.categories))
    return { ok: false, error: `Category "${category}" not found.` };

  const idx = data.categories[category].indexOf(puzzleId);
  if (idx === -1) return { ok: false, error: "Puzzle not found in category." };

  data.categories[category].splice(idx, 1);
  await saveAllData(data);
  return { ok: true };
}

/* ============================================================
 * URL validation & puzzle ID extraction
 * ============================================================
 * Rules:
 *   - Hostname must be exactly "lichess.org"
 *   - Pathname must be /training/{id} (extract ID from URL), OR
 *     /training, /training/, /training/mix, /training/mix/ (extract ID from DOM)
 *   - {id} must be non-empty and contain only alphanumeric chars
 *   - Query strings and hash fragments are allowed but ignored
 *   - Protocol must be https
 *
 * Returns:
 *   - The puzzle ID string if extractable from the URL
 *   - "NEED_DOM" if the URL is a valid training page but the ID must come from the DOM
 *   - null if the URL is not a Lichess training page at all
 * ============================================================ */
function extractPuzzleId(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "lichess.org") return null;

    // Normalise: strip trailing slash for easier matching
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // Split pathname into segments: "/training/0j7EP" -> ["", "training", "0j7EP"]
    const segments = pathname.split("/");
    if (segments.length < 2 || segments[0] !== "" || segments[1] !== "training") return null;

    // /training (no ID segment)
    if (segments.length === 2) return "NEED_DOM";

    const id = segments[2];

    // /training/mix -> need DOM extraction
    if (id === "mix") {
      // Only allow /training/mix, not /training/mix/extra
      if (segments.length > 3) return null;
      return "NEED_DOM";
    }

    // /training/{id} — must be exactly 3 segments with alphanumeric ID
    if (segments.length !== 3) return null;
    if (!id || !/^[a-zA-Z0-9]+$/.test(id)) return null;

    return id;
  } catch {
    return null;
  }
}

/* ============================================================
 * Message handler — popup & options communicate via messages
 * ============================================================ */
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case "GET_ALL_DATA":
        return await getAllData();

      case "CREATE_CATEGORY":
        return await createCategory(message.name);

      case "RENAME_CATEGORY":
        return await renameCategory(message.oldName, message.newName);

      case "DELETE_CATEGORY":
        return await deleteCategory(message.name);

      case "ADD_PUZZLE":
        return await addPuzzleToCategory(message.category, message.puzzleId);

      case "REMOVE_PUZZLE":
        return await removePuzzleFromCategory(message.category, message.puzzleId);

      case "EXTRACT_PUZZLE_ID":
        return { puzzleId: extractPuzzleId(message.url) };

      default:
        return { ok: false, error: "Unknown message type." };
    }
  };

  // Return true to indicate async response (Chrome requirement)
  handler().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
