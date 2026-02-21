/**
 * Lichess Woodpecker — Woodpecker Training Content Script
 * Injected on lichess.org/training/* pages.
 * Reads session state from chrome.storage.local and renders a floating overlay.
 */

(async function () {
  "use strict";

  const STORAGE_KEY = "trainingSession";
  const OVERLAY_ID = "lpn-woodpecker-overlay";

  // Avoid double-injection
  if (document.getElementById(OVERLAY_ID)) return;

  /* ============================================================
   * Storage helpers
   * ============================================================ */
  const storage = (typeof chrome !== "undefined" && chrome.storage)
    ? chrome.storage : (typeof browser !== "undefined" && browser.storage ? browser.storage : null);

  if (!storage) return;

  function getSession() {
    return new Promise((resolve) => {
      storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  function saveSession(session) {
    return new Promise((resolve) => {
      storage.local.set({ [STORAGE_KEY]: session }, resolve);
    });
  }

  function clearSession() {
    return new Promise((resolve) => {
      storage.local.remove(STORAGE_KEY, resolve);
    });
  }

  function getAllData() {
    return new Promise((resolve) => {
      storage.local.get("lichessNotes", (result) => {
        const d = result.lichessNotes || { categories: {} };
        resolve(d);
      });
    });
  }

  /* ============================================================
   * Read session — bail if none
   * ============================================================ */
  let session = await getSession();
  if (!session) {
    console.log("[lpn] No active training session.");
    return;
  }
  console.log("[lpn] Training session found:", session.category, session.completedInCycle + "/" + session.totalPuzzles);

  // Validate category still exists (skip for "All Categories" virtual category)
  const allData = await getAllData();
  if (session.category !== "All Categories" && !allData.categories[session.category]) {
    console.warn("[lpn] Category no longer exists, ending session.");
    await clearSession();
    return;
  }

  /* ============================================================
   * Utility: format time
   * ============================================================ */
  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getElapsed() {
    return Date.now() - (session.timerStartedAt || Date.now());
  }

  /* ============================================================
   * Fisher-Yates shuffle
   * ============================================================ */
  function fisherYatesShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /* ============================================================
   * Build overlay DOM
   * ============================================================ */
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  document.body.appendChild(overlay);

  let timerInterval = null;
  let toastTimeout = null;

  function render() {
    overlay.innerHTML = "";

    if (session.isMinimized) {
      renderCollapsed();
    } else {
      renderExpanded();
    }

    startTimer();
  }

  /* ---- Collapsed view ---- */
  function renderCollapsed() {
    const pct = session.totalPuzzles > 0
      ? `${session.completedInCycle}/${session.totalPuzzles}`
      : "0/0";
    const el = document.createElement("div");
    el.className = "wpk-collapsed";
    el.innerHTML = `
      <span class="wpk-icon">\u{1F3CB}\u{FE0F}</span>
      <span class="wpk-collapsed-progress">${pct}</span>
      <span class="wpk-collapsed-timer" data-timer></span>
    `;
    el.addEventListener("click", async () => {
      session.isMinimized = false;
      await saveSession(session);
      render();
    });
    overlay.appendChild(el);
  }

  /* ---- Expanded view ---- */
  function renderExpanded() {
    const panel = document.createElement("div");
    panel.className = "wpk-panel";

    // Title bar
    const titlebar = document.createElement("div");
    titlebar.className = "wpk-titlebar";
    titlebar.innerHTML = `
      <div class="wpk-titlebar-left">
        <span class="wpk-icon">\u{1F3CB}\u{FE0F}</span>
        <span>Woodpecker Training</span>
      </div>
      <div class="wpk-titlebar-btns">
        <button class="wpk-btn-minimize" title="Minimize">\u2500</button>
        <button class="wpk-btn-close" title="End session">\u2715</button>
      </div>
    `;
    panel.appendChild(titlebar);

    titlebar.querySelector(".wpk-btn-minimize").addEventListener("click", async () => {
      session.isMinimized = true;
      await saveSession(session);
      render();
    });

    titlebar.querySelector(".wpk-btn-close").addEventListener("click", () => {
      showConfirmEnd(panel);
    });

    // Body
    const body = document.createElement("div");
    body.className = "wpk-body";

    // Category
    const catRow = document.createElement("div");
    catRow.className = "wpk-info-row";
    catRow.innerHTML = `
      <span class="wpk-info-label">Category</span>
      <span class="wpk-info-value">${escapeHtml(session.category)}</span>
    `;
    body.appendChild(catRow);

    // Progress
    const pctNum = session.totalPuzzles > 0
      ? Math.round((session.completedInCycle / session.totalPuzzles) * 100)
      : 0;
    const progressWrap = document.createElement("div");
    progressWrap.className = "wpk-progress-wrap";
    progressWrap.innerHTML = `
      <div class="wpk-progress-bar">
        <div class="wpk-progress-fill" style="width: ${pctNum}%"></div>
      </div>
      <div class="wpk-progress-text">
        <span class="wpk-info-label">Progress</span>
        <span class="wpk-info-value">${session.completedInCycle} / ${session.totalPuzzles}</span>
      </div>
    `;
    body.appendChild(progressWrap);

    // Cycle
    const cycleRow = document.createElement("div");
    cycleRow.className = "wpk-info-row";
    cycleRow.innerHTML = `
      <span class="wpk-info-label">Cycle</span>
      <span class="wpk-info-value">${session.cycleCount}</span>
    `;
    body.appendChild(cycleRow);

    // Timer
    const timerRow = document.createElement("div");
    timerRow.className = "wpk-timer-row";
    timerRow.innerHTML = `
      <span class="wpk-timer-display" data-timer>${formatTime(getElapsed())}</span>
      <button class="wpk-btn-reset">\u{1F504} Reset</button>
    `;
    timerRow.querySelector(".wpk-btn-reset").addEventListener("click", async () => {
      session.timerStartedAt = Date.now();
      session.currentIndex = 0;
      session.completedInCycle = 0;
      await saveSession(session);
      window.location.href = session.queue[0];
    });
    body.appendChild(timerRow);

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "wpk-actions";

    const quickSaveBtn = document.createElement("button");
    quickSaveBtn.className = "wpk-btn-quicksave";
    quickSaveBtn.innerHTML = "\u{1F4BE} Quick Save";
    quickSaveBtn.addEventListener("click", () => {
      toggleQuickSave(body);
    });
    actions.appendChild(quickSaveBtn);

    const nextBtn = document.createElement("button");
    nextBtn.className = "wpk-btn-next";
    nextBtn.textContent = "Next \u25B6";
    nextBtn.addEventListener("click", () => nextPuzzle());
    actions.appendChild(nextBtn);

    body.appendChild(actions);
    panel.appendChild(body);

    // Toast element
    const toast = document.createElement("div");
    toast.className = "wpk-toast";
    toast.setAttribute("data-wpk-toast", "");
    panel.appendChild(toast);

    overlay.appendChild(panel);
  }

  /* ============================================================
   * Confirm end session
   * ============================================================ */
  function showConfirmEnd(panel) {
    const body = panel.querySelector(".wpk-body");
    if (!body) return;
    body.innerHTML = "";

    const confirm = document.createElement("div");
    confirm.className = "wpk-confirm";
    confirm.innerHTML = `
      <p>End training session?</p>
      <div class="wpk-confirm-btns">
        <button class="wpk-btn-cancel">Cancel</button>
        <button class="wpk-btn-confirm-end">End Session</button>
      </div>
    `;

    confirm.querySelector(".wpk-btn-cancel").addEventListener("click", () => {
      render();
    });

    confirm.querySelector(".wpk-btn-confirm-end").addEventListener("click", async () => {
      if (timerInterval) clearInterval(timerInterval);
      await clearSession();
      overlay.remove();
    });

    body.appendChild(confirm);
  }

  /* ============================================================
   * Quick save dropdown
   * ============================================================ */
  async function toggleQuickSave(body) {
    const existing = body.querySelector(".wpk-quicksave-dropdown");
    if (existing) {
      existing.remove();
      return;
    }

    const data = await getAllData();
    const catNames = Object.keys(data.categories).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    if (catNames.length === 0) {
      showOverlayToast("No categories available");
      return;
    }

    // Extract current puzzle ID from the page URL
    const currentId = extractCurrentPuzzleId();
    if (!currentId) {
      showOverlayToast("No puzzle ID found");
      return;
    }

    const dropdown = document.createElement("div");
    dropdown.className = "wpk-quicksave-dropdown";

    catNames.forEach((name) => {
      const btn = document.createElement("button");
      btn.textContent = name;
      btn.addEventListener("click", async () => {
        // Save via storage directly (add to category if not duplicate)
        const freshData = await getAllData();
        const cat = freshData.categories[name];
        if (!cat) {
          showOverlayToast("Category not found");
          dropdown.remove();
          return;
        }
        if (cat.includes(currentId)) {
          showOverlayToast("Already saved");
          dropdown.remove();
          return;
        }
        cat.push(currentId);
        freshData.meta = freshData.meta || {};
        freshData.meta.updatedAt = Date.now();
        await new Promise((resolve) => {
          storage.local.set({ lichessNotes: freshData }, resolve);
        });
        showOverlayToast(`Saved to ${name}`);
        dropdown.remove();
      });
      dropdown.appendChild(btn);
    });

    body.appendChild(dropdown);
  }

  /* ============================================================
   * Extract current puzzle ID from page URL
   * ============================================================ */
  function extractCurrentPuzzleId() {
    const match = window.location.pathname.match(/^\/training\/([A-Za-z0-9]{5})$/);
    return match ? match[1] : null;
  }

  /* ============================================================
   * Next puzzle
   * ============================================================ */
  async function nextPuzzle() {
    session.completedInCycle++;
    session.currentIndex++;

    if (session.currentIndex >= session.queue.length) {
      // All puzzles seen — reshuffle for next cycle
      session.queue = fisherYatesShuffle([...session.queue]);
      session.currentIndex = 0;
      session.cycleCount++;
      session.completedInCycle = 0;
    }

    await saveSession(session);
    window.location.href = session.queue[session.currentIndex];
  }

  /* ============================================================
   * Timer
   * ============================================================ */
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const els = overlay.querySelectorAll("[data-timer]");
      const elapsed = formatTime(getElapsed());
      els.forEach((el) => { el.textContent = elapsed; });
    }, 1000);
  }

  /* ============================================================
   * Overlay toast
   * ============================================================ */
  function showOverlayToast(msg) {
    const el = overlay.querySelector("[data-wpk-toast]");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("visible");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      el.classList.remove("visible");
    }, 2000);
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
   * Initial render
   * ============================================================ */
  render();
})();
