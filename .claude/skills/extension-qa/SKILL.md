---
name: extension-qa
description: Exploratory QA of the extension in a real browser through the Playwright MCP (popup, options page, training overlay on live Lichess). Use to check a UI/behavior change visually or to investigate a reported bug.
---

Read-only against lichess.org: no login, no puzzle submission beyond viewing.

1. Playwright MCP loads this folder as an unpacked extension. Get the extension ID from `chrome://extensions` or the service worker URL (`browser_evaluate` on any page, or navigate to `chrome://extensions`).
2. Open `chrome-extension://<id>/options.html`: create a category, add puzzle IDs with the popup's Save buttons (open `popup.html` as a tab and set `currentPuzzleId` then call `renderAll()`) or `browser.runtime.sendMessage` from an extension page, rename, delete. Screenshot each state.
3. Start a training session (popup → Train), land on `https://lichess.org/training/<id>`: confirm overlay renders, timer ticks, Skip advances, minimize/close work, stats show on options page after a cycle.
4. Check `browser_console_messages` on every page for errors/warnings.
5. Finish with SHIP / DO-NOT-SHIP and a list of findings with screenshots. If a finding is a repeatable regression, add it to `tests/extension.spec.js`.
