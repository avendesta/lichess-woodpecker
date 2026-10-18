/**
 * Shared by the popup and the options page (both load it before their own script): the code that has to behave the same in both
 * and cannot be imported, because there is no build step. Plain functions on the page; it is never loaded by the overlay
 * (a content script would need it listed in both manifests) or by the background.
 */

function fisherYatesShuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// A short message in the page's #toast element; a success toast hides itself, news and errors are read from it at once.
let toastTimer = null;
// A toast with `data-rich` (the popup's) is a card: an icon, the message and a close button. Without it (the options page's) it
// is plain text. A new toast replaces the one showing. The icons are static markup parsed as SVG, never built from a message.
const TOAST_ICONS = {
  success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg>',
  problem: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="7.5" x2="12" y2="12.5"/><circle cx="12" cy="16.2" r="0.6"/></svg>',
  close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
};

function toastSvg(markup) {
  return document.importNode(new DOMParser().parseFromString(markup, "image/svg+xml").documentElement, true);
}

function showToast(message, type = "success") {
  const toastEl = document.getElementById("toast");
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.className = `toast toast-${type}`;
  if (toastEl.dataset.rich) {
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.append(toastSvg(type === "success" ? TOAST_ICONS.success : TOAST_ICONS.problem));
    const text = document.createElement("span");
    text.className = "toast-msg";
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.append(toastSvg(TOAST_ICONS.close));
    close.addEventListener("click", () => {
      clearTimeout(toastTimer);
      toastEl.classList.add("hidden");
    });
    toastEl.replaceChildren(icon, text, close);
  } else {
    toastEl.textContent = message;
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 2500);
}

/**
 * The session to start for `name` (a category, or "All Categories"), from the puzzle IDs it trains (`pool`) and what is stored
 * (`trainingSession`, `pausedCycles`). Pure: it changes nothing stored. Returns `{session, park, unpark}`:
 *  - a category with a parked cycle just continues it (`unpark` names it; the clock is shifted so paused time is left out),
 *  - a cycle paused in the old shape (still in the active slot) is `park`ed rather than lost, or continued if it is this one's,
 *  - otherwise a fresh cycle over the different puzzles in a random order.
 * The caller sets `ownerTabId` and sends START_SESSION; the background validates it all again.
 */
function buildSession(name, pool, trainingSession, pausedCycles) {
  const parked = pausedCycles || {};
  let park = null;
  if (trainingSession && trainingSession.pausedAt) park = { ...trainingSession, ownerTabId: null };
  let session = null;
  let unpark = null;
  if (park && park.category === name) {
    session = park;
    park = null;
  } else if (Object.hasOwn(parked, name)) {
    session = { ...parked[name] };
    unpark = name;
  }
  if (session) {
    session.timerStartedAt += Date.now() - session.pausedAt;
    delete session.pausedAt;
  } else {
    const ids = [...new Set(pool)];
    session = {
      category: name,
      queue: fisherYatesShuffle(ids.map((id) => `https://lichess.org/training/${id}`)),
      currentIndex: 0,
      totalPuzzles: ids.length,
      cycleCount: 1,
      timerStartedAt: Date.now(),
      isMinimized: false,
      completedInCycle: 0,
    };
  }
  return { session, park, unpark };
}
