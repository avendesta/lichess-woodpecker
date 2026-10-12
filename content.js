/**
 * Lichess Woodpecker — Woodpecker Training Content Script
 * Injected on lichess.org/training/* pages.
 * Reads session state from chrome.storage.local and renders a floating overlay.
 */

(async function () {
  "use strict";

  const STORAGE_KEY = "trainingSession";
  const OVERLAY_ID = "lpn-woodpecker-overlay";
  const POS_KEY = "overlayPos"; // { left, bottom } in px; absent until the user drags the overlay
  const AUTO_KEY = "autoNext"; // boolean; absent means on
  const PARKED_KEY = "pausedCycles"; // { [category]: cycle }: paused cycles wait here, one per category; trainingSession is only the running one

  // Avoid double-injection
  if (document.getElementById(OVERLAY_ID)) return;

  /* ============================================================
   * Storage helpers
   * ============================================================ */
  const storage = (typeof chrome !== "undefined" && chrome.storage)
    ? chrome.storage : (typeof browser !== "undefined" && browser.storage ? browser.storage : null);

  if (!storage) return;

  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => resolve(chrome.runtime.lastError ? null : response));
      } catch (_) {
        resolve(null); // extension context invalidated
      }
    });
  }

  // A session belongs to one tab. A tab that doesn't own it stays out of the way entirely; a session with no live owner
  // (its tab was closed, or the browser restarted) is offered through a Resume chip instead of being picked up silently.
  const who = await ask({ type: "GET_SESSION_ROLE" });
  if (!who || (who.role !== "owner" && who.role !== "resumable")) return;
  const resuming = who.role === "resumable";
  const myTabId = who.tabId;
  let detached = false; // set once this tab lets go of the session

  function getSession() {
    return new Promise((resolve) => {
      storage.local.get(STORAGE_KEY, (result) => {
        resolve(result[STORAGE_KEY] || null);
      });
    });
  }

  function getLocal(key) {
    return new Promise((resolve) => {
      storage.local.get(key, (result) => resolve(result[key] ?? null));
    });
  }

  function saveSession(session) {
    return new Promise((resolve, reject) => {
      if (detached) return resolve();
      const done = () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      };
      try {
        if (session.pausedAt) {
          // A paused cycle lives in the parked area, never in the active slot (even for something as small as minimizing).
          // The background changes that map, one operation at a time, so a stale copy here cannot drop another category's cycle.
          ask({ type: "PARK_CYCLE", cycle: session }).then((response) => {
            if (response && response.ok) resolve();
            else reject(new Error((response && response.error) || "could not park the paused cycle"));
          });
        } else {
          storage.local.set({ [STORAGE_KEY]: session }, done);
        }
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

  // A cycle that was already running when "solved" became "correct / incorrect" keeps its count.
  if (session.correctInCycle === undefined) {
    session.correctInCycle = session.solvedInCycle || 0;
    delete session.solvedInCycle;
  }

  // Validate category still exists (skip for "All Categories" virtual category). Only the owner may end a session.
  if (!resuming) {
    const allData = await getAllData();
    if (session.category !== "All Categories" && !allData.categories[session.category]) {
      console.warn("[lpn] Category no longer exists, ending session.");
      await clearSession();
      return;
    }
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
    return (session.cycleFinishedAt || session.pausedAt || Date.now()) - (session.timerStartedAt || Date.now());
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
   * The logo. Inlined, not loaded from the extension: a file the page can load would have to be web-accessible, which
   * would let lichess.org detect that this extension is installed. The line between the markers is written by
   * `npm run generate-icons` from icons/logo.svg (ids prefixed so they cannot clash with the page's own).
   * ============================================================ */
  /* LOGO:BEGIN */
  const LOGO_SVG = "<svg aria-hidden=\"true\" focusable=\"false\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"270 42 875 1135\"><defs><linearGradient id=\"wpk-navy\" x1=\"0\" y1=\"0\" x2=\"0.84\" y2=\"1\"><stop offset=\"0\" stop-color=\"#071c35\"/><stop offset=\"1\" stop-color=\"#00142c\"/></linearGradient><linearGradient id=\"wpk-red\" x1=\"0\" y1=\"0\" x2=\"0.8\" y2=\"0.8\"><stop offset=\"0\" stop-color=\"#ff514c\"/><stop offset=\"1\" stop-color=\"#ff393d\"/></linearGradient><linearGradient id=\"wpk-wing\" x1=\"0\" y1=\"0\" x2=\"0.85\" y2=\"1\"><stop offset=\"0\" stop-color=\"#399cf6\"/><stop offset=\"1\" stop-color=\"#1970dc\"/></linearGradient><linearGradient id=\"wpk-ivory\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0.8\"><stop offset=\"0\" stop-color=\"#fffaf0\"/><stop offset=\"1\" stop-color=\"#f2f0e8\"/></linearGradient></defs><path fill=\"url(#wpk-red)\" d=\"M329 69 C403 139 488 157 631 170 C767 181 824 228 859 339 C817 285 774 252 703 238 C632 221 567 226 508 220 C530 236 553 254 582 266 C537 290 508 317 466 326 C410 314 351 253 323 178 C358 190 392 211 423 215 C389 186 359 136 329 69Z\"/><path fill=\"url(#wpk-navy)\" d=\"M341 1054 C323 929 350 782 400 670 C431 607 476 575 518 560 C467 504 446 442 449 388 C456 309 512 263 581 239 C658 212 739 226 798 259 C831 280 849 310 861 339 C938 369 1028 397 1105 430 C1021 433 915 438 818 450 C745 460 703 492 728 527 C743 552 800 582 832 647 C860 700 875 767 857 819 C815 838 785 866 777 898 C770 926 792 944 813 959 C826 969 819 991 798 991 L467 991 C405 1003 375 1042 341 1054Z\"/><path fill=\"url(#wpk-red)\" d=\"M541 334 C612 327 667 377 740 413 C702 419 665 408 633 400 C585 388 565 414 581 452 C610 512 672 570 700 606 C628 555 567 514 530 459 C502 419 494 363 541 334Z\"/><path fill=\"url(#wpk-ivory)\" d=\"M526 338 C577 289 636 269 688 277 C741 284 771 316 814 350 C856 372 905 389 955 403 C905 402 856 389 828 385 C806 381 787 397 754 413 C716 429 673 432 682 485 C689 521 741 551 778 611 C814 673 815 733 786 788 C749 850 681 887 552 899 C629 868 693 813 720 754 C747 691 740 638 697 595 C659 554 605 510 583 469 C562 427 583 393 632 402 C664 407 701 414 740 413 C690 399 647 364 612 348 C584 334 559 329 526 338Z\"/><path fill=\"url(#wpk-wing)\" d=\"M366 819 C385 733 436 650 500 601 C554 558 600 564 617 606 C639 661 592 755 541 807 C489 862 427 897 368 926 C439 847 506 778 551 674 C473 713 411 761 366 819Z\"/><path fill=\"#031a37\" d=\"M711 305 C690 302 674 321 683 346 C690 367 717 380 740 372 C758 365 764 345 758 333 C750 341 736 337 731 326 C726 316 729 307 737 302 C730 301 720 303 711 305Z\"/><path fill=\"#fffaf0\" d=\"M731 305 C721 316 723 332 735 338 C748 344 761 335 759 325 C751 337 731 331 731 305Z\"/><path fill=\"url(#wpk-navy)\" d=\"M476 1002 H788 C809 1002 822 1019 833 1041 C842 1059 826 1070 812 1070 H445 C423 1070 415 1057 425 1036 C437 1011 452 1002 476 1002Z\"/><path fill=\"url(#wpk-navy)\" d=\"M458 1081 H813 C844 1081 871 1105 886 1133 C892 1144 887 1158 878 1158 H364 C356 1158 361 1145 368 1134 C386 1102 419 1081 458 1081Z\"/></svg>";
  /* LOGO:END */

  // The logo on its light rounded tile (its navy base would vanish on the dark overlay). Parsed, never assigned as HTML.
  function makeLogo() {
    const svg = document.importNode(new DOMParser().parseFromString(LOGO_SVG, "image/svg+xml").documentElement, true);
    const tile = document.createElement("span");
    tile.className = "wpk-logo";
    tile.appendChild(svg);
    return tile;
  }

  /* ============================================================
   * Build overlay DOM
   * ============================================================ */
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-label", "Woodpecker training");
  document.body.appendChild(overlay);

  /* ---- Tooltips: any element with data-tip shows its words on hover or keyboard focus. One element, kept outside
   * the panel (which clips its overflow), placed above the button, below it when there is no room, and nudged
   * sideways so it never leaves the screen. The buttons carry the same words in their aria-labels. ---- */
  const tip = document.createElement("div");
  tip.className = "wpk-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("aria-hidden", "true");

  function hideTip() {
    tip.classList.remove("wpk-tip-on");
  }

  function showTip(el) {
    tip.textContent = el.dataset.tip;
    tip.classList.add("wpk-tip-on");
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(gap, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - gap));
    const above = r.top - t.height - gap >= gap;
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? r.top - t.height - gap : r.bottom + gap}px`;
  }

  overlay.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) showTip(el);
    else hideTip();
  });
  overlay.addEventListener("mouseleave", hideTip);
  overlay.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el && el.matches(":focus-visible")) showTip(el); // not after a mouse click, which would only repeat the hover
  });
  overlay.addEventListener("focusout", hideTip);
  function onTipKey(e) {
    if (e.key === "Escape") hideTip();
  }
  document.addEventListener("keydown", onTipKey);

  /* ---- Position: draggable, remembered, always kept on screen ---- */
  let pos = await getLocal(POS_KEY);
  let dragged = false; // lets the pill tell a drag from a click

  // Light or dark: judge the Lichess page by its own computed colours (its class and variable names are internal and
  // change). Transparent or image themes can't be judged, so they keep the dark look.
  function pageIsLight() {
    for (let el = document.querySelector("main") || document.body; el; el = el.parentElement) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m || (m.length > 3 && +m[3] < 0.5)) continue; // transparent: look at what is behind it
      const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
    }
    return false;
  }

  function applyTheme() {
    overlay.classList.toggle("wpk-light", pageIsLight());
  }

  let themeTimer = null;
  function themeMayHaveChanged() {
    applyTheme();
    clearTimeout(themeTimer);
    themeTimer = setTimeout(applyTheme, 500); // Lichess flips its class before the new stylesheet has loaded
  }
  const themeWatcher = new MutationObserver(themeMayHaveChanged);
  const darkQuery = matchMedia("(prefers-color-scheme: dark)"); // Lichess's "system" background follows the OS
  applyTheme();

  const AUTO_NEXT_MS = 1000; // long enough to see the final move
  let autoNext = (await getLocal(AUTO_KEY)) !== false;
  let autoTimer = null;

  // Clamp only what is displayed; `pos` keeps the raw value so the panel and the
  // (smaller) pill each fit the screen without drifting when you swap between them.
  function applyPos() {
    if (!pos) return;
    const maxLeft = Math.max(0, document.documentElement.clientWidth - overlay.offsetWidth);
    const maxBottom = Math.max(0, document.documentElement.clientHeight - overlay.offsetHeight);
    overlay.style.left = `${Math.min(Math.max(0, pos.left), maxLeft)}px`;
    overlay.style.bottom = `${Math.min(Math.max(0, pos.bottom), maxBottom)}px`;
  }
  window.addEventListener("resize", applyPos);

  function makeDraggable(handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = overlay.getBoundingClientRect();
      const startLeft = rect.left;
      const startBottom = document.documentElement.clientHeight - rect.bottom;
      let moving = false;
      dragged = false;
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moving && Math.hypot(dx, dy) < 4) return; // below 4px it's a click
        moving = true;
        pos = { left: startLeft + dx, bottom: startBottom - dy };
        applyPos();
      };
      const onEnd = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        if (!moving) return;
        dragged = true;
        // Save where it actually landed (post-clamp), not where the pointer went.
        const r = overlay.getBoundingClientRect();
        pos = { left: r.left, bottom: document.documentElement.clientHeight - r.bottom };
        try {
          storage.local.set({ [POS_KEY]: pos }, () => void chrome.runtime.lastError);
        } catch (_) { /* extension context invalidated; losing a position is harmless */ }
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    });
  }

  let timerInterval = null;
  let toastTimeout = null;

  function render() {
    overlay.innerHTML = "";
    hideTip();
    overlay.appendChild(tip);

    if (resuming) {
      renderResume();
      applyPos();
      return;
    }

    if (session.isMinimized) {
      renderCollapsed();
    } else {
      renderExpanded();
    }

    applyPos();
    startTimer();
  }

  /* ---- Resume chip: a session exists but its tab is gone ---- */
  function renderResume() {
    const chip = document.createElement("div");
    chip.className = "wpk-collapsed wpk-resume-wrap";
    chip.innerHTML = `
      <span class="wpk-icon"></span>
      <button class="wpk-resume"></button>
      <button class="wpk-resume-dismiss" title="Dismiss" aria-label="Dismiss">\u2715</button>
    `;
    chip.querySelector(".wpk-icon").appendChild(makeLogo());
    const done = session.completedInCycle || 0;
    const resume = chip.querySelector(".wpk-resume");
    resume.textContent = `Resume ${session.category} \u00B7 ${done}/${session.totalPuzzles}`;
    resume.setAttribute("aria-label", `Resume Woodpecker session: ${session.category}, ${done} of ${session.totalPuzzles} puzzles done`);
    resume.addEventListener("click", claimSession);
    chip.querySelector(".wpk-resume-dismiss").addEventListener("click", detach); // not just overlay.remove(): that left its listeners and the theme observer running
    makeDraggable(chip);
    overlay.appendChild(chip);
  }

  // Take the session over for this tab, then restart here as its owner at the puzzle it was on.
  async function claimSession() {
    const res = await ask({ type: "CLAIM_SESSION" });
    if (!res || !res.ok) {
      overlay.remove(); // another tab got there first
      return;
    }
    const target = res.session.queue[res.session.currentIndex];
    if (res.session.cycleFinishedAt || location.href === target) location.reload();
    else location.href = target;
  }

  // The settings gear, the same button in the training controls and on the score screen.
  function makeSettingsButton() {
    const btn = document.createElement("button");
    btn.className = "wpk-btn-settings";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
    btn.dataset.tip = "Open options";
    btn.setAttribute("aria-label", "Open options");
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" });
    });
    return btn;
  }

  /* ---- Collapsed view ---- */
  function renderCollapsed() {
    const pct = session.totalPuzzles > 0
      ? `${session.completedInCycle}/${session.totalPuzzles}`
      : "0/0";
    const el = document.createElement("div");
    el.className = "wpk-collapsed";
    el.innerHTML = `
      <span class="wpk-icon"></span>
      <span class="wpk-collapsed-progress"></span>
      <span class="wpk-collapsed-timer" data-timer></span>
    `;
    el.querySelector(".wpk-collapsed-progress").textContent = pct;
    el.querySelector(".wpk-icon").appendChild(makeLogo());
    if (session.pausedAt) el.querySelector(".wpk-icon").textContent = "\u23F8\uFE0F"; // paused: the same slot, a pause sign
    el.querySelector(".wpk-collapsed-timer").textContent = formatTime(getElapsed()); // shown at once, since a paused clock never ticks
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", `Show training panel, ${session.completedInCycle} of ${session.totalPuzzles}${session.pausedAt ? ", paused" : ""}`);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
    });
    makeDraggable(el);
    el.addEventListener("click", async () => {
      if (dragged) return; // the click that ends a drag must not expand the pill
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
        <span class="wpk-icon"></span>
        <span data-title>Woodpecker Training</span>
      </div>
      <div class="wpk-titlebar-btns">
        <button class="wpk-btn-minimize" data-tip="Minimize" aria-label="Minimize">\u2500</button>
        <button class="wpk-btn-close" data-tip="End session" aria-label="End session">\u2715</button>
      </div>
    `;
    titlebar.querySelector(".wpk-icon").appendChild(makeLogo());
    panel.appendChild(titlebar);
    makeDraggable(titlebar);
    if (session.pausedAt) {
      const title = titlebar.querySelector("[data-title]");
      title.textContent = "Paused";
      title.classList.add("wpk-title-paused");
    }

    titlebar.querySelector(".wpk-btn-minimize").addEventListener("click", async () => {
      session.isMinimized = true;
      await saveSession(session);
      render();
    });

    const closeBtn = titlebar.querySelector(".wpk-btn-close");
    if (session.pausedAt) {
      closeBtn.dataset.tip = "Close (your progress is kept)";
      closeBtn.setAttribute("aria-label", "Close (your progress is kept)");
    }
    closeBtn.addEventListener("click", session.pausedAt ? closePaused : endSession);

    // Body
    const body = document.createElement("div");
    body.className = "wpk-body";
    if (session.pausedAt) body.classList.add("wpk-paused"); // the same panel in the same places, with the signs of a pause

    if (session.cycleFinishedAt) {
      renderResultsBody(body);
      panel.appendChild(body);
      overlay.appendChild(panel);
      return;
    }

    // Category
    const catRow = document.createElement("div");
    catRow.className = "wpk-info-row";
    catRow.innerHTML = `
      <span class="wpk-info-label">Category</span>
      <span class="wpk-info-value"></span>
    `;
    catRow.querySelector(".wpk-info-value").textContent = session.category;
    body.appendChild(catRow);

    // Progress
    const pctNum = session.totalPuzzles > 0
      ? Math.round((session.completedInCycle / session.totalPuzzles) * 100)
      : 0;
    const progressWrap = document.createElement("div");
    progressWrap.className = "wpk-progress-wrap";
    progressWrap.innerHTML = `
      <div class="wpk-progress-bar">
        <div class="wpk-progress-fill"></div>
      </div>
      <div class="wpk-progress-text">
        <span class="wpk-info-label">Progress</span>
        <span class="wpk-info-value"></span>
      </div>
    `;
    progressWrap.querySelector(".wpk-progress-fill").style.width = `${pctNum}%`;
    if (session.pausedAt) {
      const tag = document.createElement("span");
      tag.className = "wpk-paused-tag";
      tag.textContent = "Paused";
      progressWrap.querySelector(".wpk-progress-text .wpk-info-label").appendChild(tag);
    }
    progressWrap.querySelector(".wpk-progress-text .wpk-info-value").textContent =
      `${session.completedInCycle} / ${session.totalPuzzles}`;
    body.appendChild(progressWrap);

    // Stats
    const statsRow = document.createElement("div");
    statsRow.className = "wpk-info-row";
    statsRow.innerHTML = `
      <span class="wpk-info-label">Correct / Incorrect / Skipped</span>
      <span class="wpk-info-value">
        <span style="color: var(--wpk-accent)" data-correct></span> /
        <span style="color: var(--wpk-danger)" data-incorrect></span> /
        <span style="color: var(--wpk-warning)" data-skipped></span>
      </span>
    `;
    statsRow.querySelector("[data-correct]").textContent = session.correctInCycle || 0;
    statsRow.querySelector("[data-incorrect]").textContent = session.incorrectInCycle || 0;
    statsRow.querySelector("[data-skipped]").textContent = session.skippedInCycle || 0;
    body.appendChild(statsRow);

    // Cycle
    const cycleRow = document.createElement("div");
    cycleRow.className = "wpk-info-row";
    cycleRow.innerHTML = `
      <span class="wpk-info-label">Cycle</span>
      <span class="wpk-info-value"></span>
    `;
    cycleRow.querySelector(".wpk-info-value").textContent = session.cycleCount;
    body.appendChild(cycleRow);

    // Auto-next switch
    const autoRow = document.createElement("label");
    autoRow.className = "wpk-info-row wpk-auto-row";
    autoRow.innerHTML = `
      <span class="wpk-info-label">Auto-next when correct</span>
      <input type="checkbox" data-autonext>
    `;
    const autoBox = autoRow.querySelector("[data-autonext]");
    autoBox.checked = autoNext;
    if (session.pausedAt) {
      autoBox.disabled = true; // nothing advances by itself while paused
      autoRow.classList.add("wpk-inactive");
    }
    autoBox.addEventListener("change", () => {
      autoNext = autoBox.checked;
      clearTimeout(autoTimer);
      autoTimer = null;
      try {
        storage.local.set({ [AUTO_KEY]: autoNext }, () => void chrome.runtime.lastError);
      } catch (_) { /* extension context invalidated; the switch still works for this page */ }
      maybeAutoAdvance(); // turning it back on while a finished puzzle is showing should pick it up
    });
    body.appendChild(autoRow);

    // Timer
    const timerRow = document.createElement("div");
    timerRow.className = "wpk-timer-row";
    // One slot: Pause while training, a green Play that grows to say "Continue" while paused.
    if (session.pausedAt) timerRow.innerHTML = `
      <span class="wpk-timer-display" data-timer></span>
      <button class="wpk-btn-play" aria-label="Continue training">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        <span class="wpk-play-label">Continue</span>
      </button>
    `;
    else timerRow.innerHTML = `
      <span class="wpk-timer-display" data-timer></span>
      <button class="wpk-btn-pause" data-tip="Pause and keep your place" aria-label="Pause training (your place is kept)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
      </button>
    `;
    if (session.pausedAt) timerRow.querySelector(".wpk-btn-play").addEventListener("click", resumeTraining);
    else timerRow.querySelector(".wpk-btn-pause").addEventListener("click", pauseTraining);
    timerRow.querySelector(".wpk-timer-display").textContent = formatTime(getElapsed());
    body.appendChild(timerRow);

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "wpk-actions wpk-controls";

    actions.appendChild(makeSettingsButton());

    const right = document.createElement("div");
    right.className = "wpk-controls-right";

    const restartBtn = document.createElement("button");
    restartBtn.className = "wpk-btn-restart";
    restartBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span>Restart</span>';
    restartBtn.dataset.tip = "Restart from puzzle 1: timer and counts reset";
    restartBtn.setAttribute("aria-label", "Restart cycle from puzzle 1 (timer and counts reset)");
    restartBtn.addEventListener("click", restartCycle);
    right.appendChild(restartBtn);

    const nextBtn = document.createElement("button");
    nextBtn.className = "wpk-btn-skip";
    nextBtn.innerHTML = '<span>Skip</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
    nextBtn.dataset.tip = "Skip this puzzle (counts as skipped)";
    nextBtn.setAttribute("aria-label", "Skip this puzzle (counts as skipped)");
    if (session.pausedAt) {
      // aria-disabled rather than disabled, so it can still show why
      nextBtn.setAttribute("aria-disabled", "true");
      nextBtn.dataset.tip = "Skipping is off while paused";
      nextBtn.setAttribute("aria-label", "Skip (unavailable while paused)");
    }
    nextBtn.addEventListener("click", () => advance("skipped")); // advance() ignores it while paused
    right.appendChild(nextBtn);
    actions.appendChild(right);

    body.appendChild(actions);
    panel.appendChild(body);

    // Toast element
    const toast = document.createElement("div");
    toast.className = "wpk-toast";
    toast.setAttribute("data-wpk-toast", "");
    panel.appendChild(toast);

    overlay.appendChild(panel);
  }

  
  
  /* ---- Cycle complete view ---- */
  // The score screen has a scene behind it, by how the cycle went: fireworks and confetti for a perfect one, golden sparkles
  // above 75%, floating blue particles from 50% to 75%, a storm below 50%. Only decoration: it sits behind the content, never
  // takes a click, is hidden from assistive technology, and is not created at all for anyone who asked for reduced motion.
  // It stays for as long as the score screen is up (minimizing removes it, reopening builds it again) and costs nothing while
  // it plays: every piece loops in CSS and animates only transform and opacity (no timers, no per-frame script), within a
  // budget of about 120 elements. The one flashing element, the storm's lightning, is a single dim pulse every few seconds.
  const rand = (min, max) => min + Math.random() * (max - min);
  const fx2 = (n) => n.toFixed(2);
  function makeCelebration(accuracy) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const kind = accuracy >= 100 ? "fireworks" : accuracy > 75 ? "sparkles" : accuracy >= 50 ? "particles" : "storm";

    const fx = document.createElement("div");
    fx.className = "wpk-fx";
    fx.dataset.fx = kind;
    fx.setAttribute("aria-hidden", "true");
    // a piece: a span with a class and custom properties; a negative delay means it is already mid-flight when the screen opens
    const add = (parent, cls, vars) => {
      const el = document.createElement("span");
      el.className = cls;
      for (const [k, v] of Object.entries(vars || {})) el.style.setProperty(k, v);
      parent.appendChild(el);
      return el;
    };

    if (kind === "fireworks") {
      const palettes = [["#ffc933", "#ff9f43", "#ffb300"], ["#ff4d6a", "#ff7a93", "#ff3d5a"], ["#4aa3ff", "#7cc0ff", "#2f86ff"], ["#3ee088", "#7af0b0", "#18c964"]];
      const spots = [[24, 26], [74, 22], [50, 46], [86, 54]];
      palettes.forEach((colours, i) => {
        const period = 3.4 + i * 0.35;
        const burst = add(fx, "wpk-fx-burst", { "--bx": `${spots[i][0]}%`, "--by": `${spots[i][1]}%`, "--P": `${fx2(period)}s`, "--D": `${fx2(-rand(0, period))}s` });
        add(burst, "wpk-fx-rocket", {});
        for (let ring = 0; ring < 2; ring++) {
          const n = ring ? 12 : 8;
          const reach = ring ? 104 : 58;
          const turn = rand(0, Math.PI);
          for (let k = 0; k < n; k++) {
            const a = turn + (k / n) * Math.PI * 2;
            add(burst, "wpk-fx-spark", { "--dx": Math.round(Math.cos(a) * reach), "--dy": Math.round(Math.sin(a) * reach), "--c": colours[(k + ring) % colours.length] });
          }
        }
      });
      const colours = ["#2ecc71", "#3b8bff", "#f59e0b", "#ef4444", "#a855f7", "#ffd76a"];
      for (let i = 0; i < 26; i++) {
        const t = rand(4.2, 7);
        add(fx, "wpk-fx-confetti", { "--x": `${fx2(rand(2, 96))}%`, "--t": `${fx2(t)}s`, "--d": `${fx2(-rand(0, t))}s`, "--c": colours[i % colours.length], "--sw": `${Math.round(rand(10, 26))}px`, "--r": `${Math.round(rand(300, 900))}deg` });
      }
    } else if (kind === "sparkles") {
      add(fx, "wpk-fx-glow", {});
      for (let i = 0; i < 22; i++) {
        const t = rand(2.2, 4.4);
        const size = i < 4 ? rand(24, 30) : rand(10, 20); // a few big stars among the small ones
        const star = add(fx, "wpk-fx-star", { "--x": `${fx2(rand(3, 94))}%`, "--y": `${fx2(rand(4, 92))}%`, "--s": `${Math.round(size)}px`, "--t": `${fx2(t)}s`, "--d": `${fx2(-rand(0, t))}s` });
        star.appendChild(document.createElement("i")); // the star shape; the wrapper carries the glow, which a clip-path would cut off
      }
    } else if (kind === "particles") {
      add(fx, "wpk-fx-glow", {});
      for (let i = 0; i < 24; i++) {
        const t = rand(7, 13);
        add(fx, "wpk-fx-orb", { "--x": `${fx2(rand(2, 94))}%`, "--s": `${Math.round(rand(6, 30))}px`, "--t": `${fx2(t)}s`, "--d": `${fx2(-rand(0, t))}s`, "--sw": `${Math.round(rand(-18, 18))}px`, "--o": fx2(rand(0.35, 0.8)) });
      }
    } else {
      [["-40px", "-10px", 15], ["60px", "-24px", 19], ["150px", "-6px", 23]].forEach(([x, y, t], i) => {
        add(fx, "wpk-fx-cloud", { "--x": x, "--y": y, "--t": `${t}s`, "--d": `${-i * 6}s` });
      });
      for (let i = 0; i < 56; i++) {
        const near = i % 3 === 0; // two depths: fewer, longer, brighter drops in front
        const t = near ? rand(0.55, 0.8) : rand(0.9, 1.3);
        add(fx, `wpk-fx-drop${near ? " wpk-fx-near" : ""}`, { "--x": `${fx2(rand(0, 118))}%`, "--t": `${fx2(t)}s`, "--d": `${fx2(-rand(0, t))}s` });
      }
      add(fx, "wpk-fx-lightning", {});
    }
    return fx;
  }

  function renderResultsBody(body) {
    const total = session.totalPuzzles || 0;
    const done = session.completedInCycle || 0;
    const accuracy = total > 0 ? Math.round(((session.correctInCycle || 0) / total) * 100) : 0;
    const tier = accuracy >= 80 ? "high" : accuracy >= 60 ? "medium" : "low"; // same cut-offs as the options page

    body.classList.add("wpk-result");
    body.innerHTML = `
      <div class="wpk-result-head">
        <span class="wpk-result-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg>
        </span>
        <div class="wpk-result-titles">
          <div class="wpk-result-title" role="heading" aria-level="2"></div>
          <div class="wpk-result-sub"></div>
        </div>
      </div>
      <div class="wpk-stat-grid">
        <div class="wpk-stat"><strong class="wpk-stat-num" data-correct></strong><span class="wpk-stat-label">Correct</span></div>
        <div class="wpk-stat"><strong class="wpk-stat-num" data-incorrect></strong><span class="wpk-stat-label">Incorrect</span></div>
        <div class="wpk-stat"><strong class="wpk-stat-num" data-skipped></strong><span class="wpk-stat-label">Skipped</span></div>
      </div>
      <div class="wpk-result-row">
        <span class="wpk-result-label">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>
          First-try accuracy
        </span>
        <strong class="wpk-result-score"></strong>
      </div>
      <div class="wpk-result-row">
        <span class="wpk-result-label">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.5 14"/></svg>
          Time taken
        </span>
        <strong class="wpk-result-value" data-result-time></strong>
      </div>
    `;
    body.querySelector(".wpk-result-title").textContent = `Cycle ${session.cycleCount} Complete`;
    body.querySelector(".wpk-result-sub").textContent = `${session.category} · ${done} puzzle${done === 1 ? "" : "s"} processed`;
    body.querySelector("[data-correct]").textContent = session.correctInCycle || 0;
    body.querySelector("[data-incorrect]").textContent = session.incorrectInCycle || 0;
    body.querySelector("[data-skipped]").textContent = session.skippedInCycle || 0;
    const score = body.querySelector(".wpk-result-score");
    score.textContent = `${accuracy}%`;
    score.classList.add(`wpk-result-${tier}`);
    body.querySelector("[data-result-time]").textContent = formatTime(getElapsed());
    const celebration = makeCelebration(accuracy);
    if (celebration) body.prepend(celebration);

    // The bottom row is the training view's: the settings gear on the left, and on the right Exit and Repeat where
    // Restart and Skip were.
    const actions = document.createElement("div");
    actions.className = "wpk-actions wpk-controls";
    actions.appendChild(makeSettingsButton());
    const right = document.createElement("div");
    right.className = "wpk-controls-right";

    const exitBtn = document.createElement("button");
    exitBtn.className = "wpk-btn-exit";
    exitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Exit</span>';
    exitBtn.dataset.tip = "End the session (finished cycles are kept)";
    exitBtn.addEventListener("click", endSession);
    right.appendChild(exitBtn);

    const nextBtn = document.createElement("button");
    nextBtn.className = "wpk-btn-next";
    nextBtn.innerHTML = '<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    nextBtn.querySelector("span").textContent = "Repeat";
    nextBtn.dataset.tip = "Start the next cycle, reshuffled";
    nextBtn.addEventListener("click", startNextCycle);
    right.appendChild(nextBtn);

    actions.appendChild(right);
    body.appendChild(actions);
  }

  /* ============================================================
   * Next puzzle
   * ============================================================ */
  // Stop everything this tab was doing, without touching the stored session.
  function detach() {
    detached = true;
    if (timerInterval) clearInterval(timerInterval);
    finishedWatcher.disconnect();
    themeWatcher.disconnect();
    darkQuery.removeEventListener("change", themeMayHaveChanged);
    storage.onChanged.removeListener(onSessionChanged);
    clearTimeout(autoTimer);
    clearTimeout(themeTimer);
    clearTimeout(toastTimeout);
    window.removeEventListener("resize", applyPos);
    document.removeEventListener("click", onLichessContinue, true);
    document.removeEventListener("keydown", onTipKey);
    overlay.remove();
  }

  async function endSession() {
    detach();
    await clearSession(); // the whole session goes, not just the overlay
  }

  // Taking a paused cycle out of the parked area (the key goes away when none are left).
  async function unpark(category) {
    await ask({ type: "UNPARK_CYCLE", category }); // by the background, which changes the parked map one operation at a time
  }

  // Pause parks the cycle under its category (order, index, counts, cycle number and where the clock stopped) and
  // freezes the clock. It is parked first and the active slot emptied second, so nothing is lost if the second step fails.
  async function pauseTraining() {
    if (advancing || detached || session.pausedAt || session.cycleFinishedAt) return;
    clearTimeout(autoTimer);
    autoTimer = null;
    session.pausedAt = Date.now();
    session.ownerTabId = null; // a parked cycle belongs to no tab
    await saveSession(session); // goes to the parked area because it is paused
    await clearSession();
    render(); // the paused view stays up, drawn from this copy
  }

  // Shifting the start forward by the time spent paused means that time never counts, in the overlay or in the saved
  // statistics. The puzzle is then loaded fresh: a half-played or already-solved board is not an answer.
  async function resumeTraining() {
    if (advancing || detached || !session.pausedAt) return;
    advancing = true;
    session.timerStartedAt += Date.now() - session.pausedAt;
    delete session.pausedAt;
    session.ownerTabId = myTabId;
    await saveSession(session); // running again first, then out of the parked area
    await unpark(session.category);
    window.location.href = session.queue[session.currentIndex];
  }

  // The question is part of the overlay rather than window.confirm(): a native dialog can be suppressed (a background
  // tab, "prevent this page from creating more dialogs", automated browsers) and is then answered "no" without the user
  // ever seeing it, so Restart would silently do nothing. It sits over the bottom of the panel (the timer and button
  // rows), so nothing else moves, and Cancel is the default.
  function askRestart() {
    return new Promise((resolve) => {
      const panel = overlay.querySelector(".wpk-panel");
      if (!panel || panel.querySelector(".wpk-confirm")) return resolve(false);
      const box = document.createElement("div");
      box.className = "wpk-confirm";
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Restart this cycle?");
      box.innerHTML = `
        <p class="wpk-confirm-text">Restart this cycle from puzzle 1? Its progress, counts and timer will be reset.</p>
        <div class="wpk-confirm-actions">
          <button class="wpk-confirm-cancel">Cancel</button>
          <button class="wpk-confirm-yes">Restart</button>
        </div>
      `;
      const answer = (yes) => {
        box.remove();
        if (!yes) overlay.querySelector(".wpk-btn-restart")?.focus();
        resolve(yes);
      };
      box.querySelector(".wpk-confirm-cancel").addEventListener("click", () => answer(false));
      box.querySelector(".wpk-confirm-yes").addEventListener("click", () => answer(true));
      box.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); answer(false); }
      });
      panel.appendChild(box);
      box.querySelector(".wpk-confirm-cancel").focus();
    });
  }

  // Restart throws away this cycle's progress (counts, position and clock), so it asks first.
  async function restartCycle() {
    if (advancing || detached) return;
    if (!(await askRestart())) return;
    advancing = true; // a double click must not restart twice before the page navigates away
    const wasPaused = !!session.pausedAt;
    session.timerStartedAt = Date.now();
    session.currentIndex = 0;
    resetCounts();
    if (wasPaused) {
      // restarting a paused cycle also runs it: this tab takes it over and it leaves the parked area
      delete session.pausedAt;
      session.ownerTabId = myTabId;
    }
    await saveSession(session);
    if (wasPaused) await unpark(session.category);
    window.location.href = session.queue[0];
  }

  // A paused cycle is already parked, so closing its overlay has nothing to save.
  function closePaused() {
    detach();
  }

  // The session was ended, or handed to another tab (Play pressed elsewhere): this tab must let go.
  function onSessionChanged(changes, area) {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const now = changes[STORAGE_KEY].newValue;
    if (!now && session.pausedAt) return; // our own pause emptied the active slot; the paused view stays
    if (!now || now.ownerTabId !== myTabId) detach();
  }

  function resetCounts() {
    session.completedInCycle = 0;
    session.correctInCycle = 0;
    session.incorrectInCycle = 0;
    session.skippedInCycle = 0;
  }

  let advancing = false; // a double click must not count (or skip) twice before the page navigates away

  // outcome: "correct" | "incorrect" | "skipped"
  async function advance(outcome) {
    if (advancing || detached || session.pausedAt) return;
    advancing = true;
    clearTimeout(autoTimer);
    autoTimer = null;
    session[`${outcome}InCycle`] = (session[`${outcome}InCycle`] || 0) + 1;
    session.completedInCycle++;
    session.currentIndex++;

    if (session.currentIndex >= session.queue.length) {
      // All puzzles seen: record the cycle, then wait on the score screen for Continue / Quit.
      session.cycleFinishedAt = Date.now(); // freezes the timer and switches the overlay to the results
      session.isMinimized = false;
      await saveCycleStats();
      try {
        await saveSession(session);
      } catch (error) {
        console.warn("[lpn] Could not save session:", error.message);
      }
      advancing = false;
      render();
      return;
    }
    await saveAndGo();
  }

  // The score screen's Continue: reshuffle and begin the next cycle.
  async function startNextCycle() {
    if (advancing || detached) return;
    advancing = true;
    session.queue = fisherYatesShuffle([...session.queue]);
    session.currentIndex = 0;
    session.cycleCount++;
    resetCounts();
    session.timerStartedAt = Date.now();
    delete session.cycleFinishedAt;
    await saveAndGo();
  }

  async function saveAndGo() {
    try {
      await saveSession(session);
    } catch (error) {
      console.warn("[lpn] Could not save session, navigating anyway:", error.message);
    }
    if (detached) return; // lost ownership while saving: don't drag the player away from what they're doing
    window.location.href = session.queue[session.currentIndex];
  }

  /* ============================================================
   * Save cycle stats
   * ============================================================ */
  // The background records it: it is the only writer of the library, and applies changes one at a time (this used to read the
  // whole library here and write it all back, which could overwrite a puzzle saved in the popup at the same moment).
  async function saveCycleStats() {
    const stats = {
      category: session.category,
      timeTaken: getElapsed(),
      totalPuzzles: session.totalPuzzles,
      correct: session.correctInCycle || 0,
      incorrect: session.incorrectInCycle || 0,
      skipped: session.skippedInCycle || 0,
      completedAt: Date.now()
    };
    const response = await ask({ type: "RECORD_STATS", stats });
    if (response && response.ok) console.log('[lpn] Cycle stats saved:', stats);
    else console.warn('[lpn] Failed to save cycle stats:', response && response.error);
  }

  /* ============================================================
   * Timer
   * ============================================================ */
  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    if (session.pausedAt) return; // a paused clock does not tick
    timerInterval = setInterval(() => {
      const els = overlay.querySelectorAll("[data-timer]");
      const elapsed = formatTime(getElapsed());
      els.forEach((el) => { el.textContent = elapsed; });
    }, 1000);
  }

  /* ============================================================
   * Lichess Continue Training Detection
   * ============================================================ */
  // Lichess marks each puzzle in its own session strip: result-true on a clean solve, result-false from the
  // first wrong move or "View the solution". Without the strip, fall back to the move list: a puzzle was
  // clean if it has no wrong move (move.fail) and was finished (move.win; viewing the solution never sets it).
  function firstTryCorrect() {
    const current = document.querySelector(".puzzle__session a.current");
    if (current?.classList.contains("result-true")) return true;
    if (current?.classList.contains("result-false")) return false;
    return !document.querySelector(".puzzle__moves move.fail") && !!document.querySelector(".puzzle__moves move.win");
  }

  // One delegated listener, registered once. Lichess swaps the feedback panel for a new element when a puzzle
  // ends, so listening on the button itself would need observers; capture phase also keeps Lichess's own
  // Continue handler from starting a competing navigation.
  function onLichessContinue(e) {
    const btn = e.target.closest?.(".puzzle__feedback.after .continue, .puzzle__feedback.after .vote");
    if (!btn) return;
    if (btn.matches(".continue")) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (session.cycleFinishedAt || session.pausedAt) return; // the score screen or the paused view is waiting for a choice
    advance(firstTryCorrect() ? "correct" : "incorrect");
  }

  // Auto-next: a correct solve moves on by itself after a short pause. Anything else (a mistake, a viewed
  // solution) is exactly what you want to study, so it waits for Continue.
  function maybeAutoAdvance() {
    if (!autoNext || autoTimer || advancing || session.cycleFinishedAt || session.pausedAt) return;
    if (!document.querySelector(".puzzle__feedback.after") || !firstTryCorrect()) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      // Look again: the strip can still show the previous attempt's mark the instant the panel appears.
      if (!advancing && !session.cycleFinishedAt && !session.pausedAt && firstTryCorrect()) advance("correct");
    }, AUTO_NEXT_MS);
  }

  // Lichess's own "Jump to next puzzle immediately" setting swaps in a random puzzle ~0.3s after a finish, in the
  // same page (the URL changes by pushState), so this script keeps running on a puzzle that isn't in the session.
  // If the page has left a puzzle that was finished, count that puzzle and take the player to the session's next
  // one, whatever our own switch says. (That jump leaves no time to study a mistake; turn the Lichess setting off for that.)
  const startPath = location.pathname;
  let finishedVerdict = null; // the last verdict seen while the finished panel was showing
  function watchPage() {
    if (document.querySelector(".puzzle__feedback.after")) {
      finishedVerdict = firstTryCorrect();
    } else if (finishedVerdict !== null && location.pathname !== startPath && !advancing && !session.cycleFinishedAt && !session.pausedAt) {
      advance(finishedVerdict ? "correct" : "incorrect");
      return;
    }
    maybeAutoAdvance();
  }

  // One watcher for the page's lifetime; it re-evaluates on every change, so a first look that is a frame early corrects itself.
  const finishedWatcher = new MutationObserver(watchPage);

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
   * Initial render
   * ============================================================ */
  render();
  themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  themeWatcher.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  themeWatcher.observe(document.head, { childList: true }); // Lichess swaps a stylesheet when the theme changes
  darkQuery.addEventListener("change", themeMayHaveChanged);
  if (!resuming) {
    document.addEventListener("click", onLichessContinue, true);
    finishedWatcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    storage.onChanged.addListener(onSessionChanged);
    watchPage(); // the puzzle may already be finished when this script loads
  }
})();
