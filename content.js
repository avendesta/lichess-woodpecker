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
    return new Promise((resolve, reject) => {
      try {
        storage.local.set({ [STORAGE_KEY]: session }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      } catch (error) {
        // Handle extension context invalidation
        if (error.message.includes('Extension context invalidated')) {
          console.warn('[lpn] Extension context invalidated, session not saved');
          resolve(); // Resolve anyway to prevent unhandled promise rejection
        } else {
          reject(error);
        }
      }
    });
  }

  function clearSession() {
    console.log('[lpn] Clearing training session');
    return new Promise((resolve) => {
      try {
        storage.local.remove(STORAGE_KEY, () => {
          if (chrome.runtime.lastError) {
            console.warn('[lpn] Error clearing session:', chrome.runtime.lastError.message);
          } else {
            console.log('[lpn] Session cleared successfully');
          }
          resolve(); // Always resolve to prevent unhandled promise rejection
        });
      } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
          console.warn('[lpn] Extension context invalidated, session not cleared');
        } else {
          console.warn('[lpn] Error clearing session:', error.message);
        }
        resolve(); // Always resolve to prevent unhandled promise rejection
      }
    });
  }

  function getAllData() {
    return new Promise((resolve) => {
      try {
        storage.local.get("lichessNotes", (result) => {
          const d = result.lichessNotes || { categories: {} };
          resolve(d);
        });
      } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
          console.warn('[lpn] Extension context invalidated, using empty data');
        } else {
          console.warn('[lpn] Error getting data:', error.message);
        }
        resolve({ categories: {} }); // Return empty data to prevent crashes
      }
    });
  }

  /* ============================================================
   * Read session — bail if none
   * ============================================================ */
  let session = await getSession();
  console.log("[lpn] Session check result:", session);
  if (!session) {
    console.log("[lpn] No active training session - not showing overlay.");
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
    setupLichessContinueDetection();
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

    // Stats
    const statsRow = document.createElement("div");
    statsRow.className = "wpk-info-row";
    const solved = session.solvedInCycle || 0;
    const skipped = session.skippedInCycle || 0;
    statsRow.innerHTML = `
      <span class="wpk-info-label">Solved / Skipped</span>
      <span class="wpk-info-value">
        <span style="color: var(--wpk-accent)">${solved}</span> / 
        <span style="color: var(--wpk-danger)">${skipped}</span>
      </span>
    `;
    body.appendChild(statsRow);

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

    const settingsBtn = document.createElement("button");
    settingsBtn.className = "wpk-btn-settings";
    settingsBtn.innerHTML = "⚙️";
    settingsBtn.title = "Open options";
    settingsBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
    });
    actions.appendChild(settingsBtn);

    const nextBtn = document.createElement("button");
    nextBtn.className = "wpk-btn-skip";
    nextBtn.textContent = "Skip \u25B6";
    nextBtn.addEventListener("click", () => skipPuzzle());
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
   * Next puzzle
   * ============================================================ */
  async function skipPuzzle() {
    session.skippedInCycle = (session.skippedInCycle || 0) + 1;
    session.completedInCycle++;
    session.currentIndex++;

    if (session.currentIndex >= session.queue.length) {
      // All puzzles seen — save cycle stats and start new cycle
      await saveCycleStats();
      
      session.queue = fisherYatesShuffle([...session.queue]);
      session.currentIndex = 0;
      session.cycleCount++;
      session.completedInCycle = 0;
      session.solvedInCycle = 0;
      session.skippedInCycle = 0;
      session.timerStartedAt = Date.now(); // Reset timer for new cycle
    }

    try {
      await saveSession(session);
      window.location.href = session.queue[session.currentIndex];
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('[lpn] Extension context invalidated during skipPuzzle, navigating anyway');
        window.location.href = session.queue[session.currentIndex];
      } else {
        console.error('[lpn] Error saving session during skipPuzzle:', error);
        // Still navigate even if save fails
        window.location.href = session.queue[session.currentIndex];
      }
    }
  }

  async function solvePuzzle() {
    session.solvedInCycle = (session.solvedInCycle || 0) + 1;
    session.completedInCycle++;
    session.currentIndex++;

    if (session.currentIndex >= session.queue.length) {
      // All puzzles seen — save cycle stats and start new cycle
      await saveCycleStats();
      
      session.queue = fisherYatesShuffle([...session.queue]);
      session.currentIndex = 0;
      session.cycleCount++;
      session.completedInCycle = 0;
      session.solvedInCycle = 0;
      session.skippedInCycle = 0;
      session.timerStartedAt = Date.now(); // Reset timer for new cycle
    }

    try {
      await saveSession(session);
      window.location.href = session.queue[session.currentIndex];
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('[lpn] Extension context invalidated during solvePuzzle, navigating anyway');
        window.location.href = session.queue[session.currentIndex];
      } else {
        console.error('[lpn] Error saving session during solvePuzzle:', error);
        // Still navigate even if save fails
        window.location.href = session.queue[session.currentIndex];
      }
    }
  }

  /* ============================================================
   * Save cycle stats
   * ============================================================ */
  async function saveCycleStats() {
    try {
      const allData = await getAllData();
      const stats = {
        category: session.category,
        timeTaken: Date.now() - session.timerStartedAt,
        totalPuzzles: session.totalPuzzles,
        solved: session.solvedInCycle || 0,
        skipped: session.skippedInCycle || 0,
        completedAt: Date.now()
      };
      
      // Initialize stats array if it doesn't exist
      if (!allData.meta) allData.meta = {};
      if (!allData.meta.trainingStats) allData.meta.trainingStats = [];
      
      // Add new stats to the beginning of the array
      allData.meta.trainingStats.unshift(stats);
      
      // Keep only last 50 stats to prevent storage bloat
      if (allData.meta.trainingStats.length > 50) {
        allData.meta.trainingStats = allData.meta.trainingStats.slice(0, 50);
      }
      
      // Save updated data
      await new Promise((resolve) => {
        storage.local.set({ lichessNotes: allData }, resolve);
      });
      
      console.log('[lpn] Cycle stats saved:', stats);
    } catch (error) {
      console.warn('[lpn] Failed to save cycle stats:', error);
    }
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
   * Lichess Continue Training Detection
   * ============================================================ */
  function setupLichessContinueDetection() {
    // Use MutationObserver to detect when the feedback div appears
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is the puzzle feedback container
            const feedbackDiv = node.classList?.contains('puzzle__feedback') ? node : 
                               node.querySelector?.('.puzzle__feedback');
            
            if (feedbackDiv) {
              // Check for either .continue or .vote button
              const actionBtn = feedbackDiv.querySelector('.continue, .vote');
              if (actionBtn) {
                console.log('[lpn] Lichess action button detected, hooking into it');
                // Add click listener to advance to next puzzle
                actionBtn.addEventListener('click', async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log('[lpn] Lichess action button clicked, advancing to next puzzle');
                  await solvePuzzle();
                });
              }
            }
          }
        });
      });
    });

    // Start observing the body for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check immediately in case the button is already there
    const existingFeedback = document.querySelector('.puzzle__feedback.after');
    if (existingFeedback) {
      // Check for either .continue or .vote button
      const actionBtn = existingFeedback.querySelector('.continue, .vote');
      if (actionBtn && !actionBtn.hasAttribute('data-lpn-handled')) {
        actionBtn.setAttribute('data-lpn-handled', 'true');
        actionBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('[lpn] Lichess action button clicked (existing), advancing to next puzzle');
          await solvePuzzle();
        });
      }
    }
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
