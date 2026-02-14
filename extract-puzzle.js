/**
 * Content script injected into Lichess training pages to extract the puzzle ID
 * from the DOM when it's not available in the URL (e.g. /training, /training/mix).
 *
 * Strict extraction rules:
 *   - Only matches <a> elements whose href is /training/{5-char-id}
 *   - The anchor's textContent must match exactly #[A-Za-z0-9]{5}
 *   - Prefers visible anchors closest to a "Puzzle" label/container
 *   - Does NOT scan arbitrary page text to avoid false positives
 *
 * Returns the 5-char alphanumeric ID, or null if not found.
 */
(function () {
  "use strict";

  const ID_RE = /^[A-Za-z0-9]{5}$/;
  const TEXT_RE = /^#[A-Za-z0-9]{5}$/;

  // Find all <a> whose href points to /training/{exactly 5 chars}
  const links = document.querySelectorAll('a[href^="/training/"]');
  const candidates = [];

  for (const link of links) {
    const hrefMatch = link.getAttribute("href").match(/^\/training\/([A-Za-z0-9]{5})$/);
    if (!hrefMatch) continue;

    const id = hrefMatch[1];
    if (id === "mix00") continue; // paranoia guard

    // Anchor text must be exactly "#XXXXX" (the puzzle label format)
    const text = link.textContent.trim();
    if (!TEXT_RE.test(text)) continue;

    // Validate the text ID matches the href ID
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

  // Fallback: return the first candidate
  return pool[0].id;
})();
