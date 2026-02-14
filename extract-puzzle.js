/**
 * Content script injected into Lichess training pages to extract the puzzle ID
 * from the DOM when it's not available in the URL (e.g. /training, /training/mix).
 *
 * Looks for the puzzle ID in two ways:
 *   1. An anchor element whose href starts with "/training/" — extracts the ID from the href
 *   2. Text matching the pattern #([A-Za-z0-9]+) anywhere in the page
 *
 * Returns only the alphanumeric ID (without #), or null if not found.
 */
(function () {
  "use strict";

  // Strategy 1: Find an <a> whose href matches /training/{id}
  const links = document.querySelectorAll('a[href^="/training/"]');
  for (const link of links) {
    const match = link.getAttribute("href").match(/^\/training\/([A-Za-z0-9]+)$/);
    if (match && match[1] !== "mix") {
      return match[1];
    }
  }

  // Strategy 2: Search for text like "#0j7EP" in the page body
  const textMatch = document.body.innerText.match(/#([A-Za-z0-9]+)/);
  if (textMatch && textMatch[1] !== "mix") {
    return textMatch[1];
  }

  return null;
})();
