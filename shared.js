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
function showToast(message, type = "success") {
  const toastEl = document.getElementById("toast");
  if (toastTimer) clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast toast-${type}`;
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
