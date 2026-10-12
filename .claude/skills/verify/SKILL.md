---
name: verify
description: Run the full verification loop for this extension (check, Firefox lint, E2E tests, diff risk review). Use after any code change and before saying work is done or committing.
---

1. `npm run check` — stop and fix on failure.
2. `npm run check:firefox` — Firefox package + web-ext lint.
3. `npm test` — if the overlay test fails, rerun once; if it still fails, open the live puzzle with Playwright MCP and see whether Lichess's DOM changed before touching extension code.
4. `git diff --stat` then review the diff against CLAUDE.md rules: manifests in sync, `escapeHtml` on new `innerHTML`, no new permissions, INCLUDE lists updated for new files, Firefox-compatible APIs.
5. Report: PASS/FAIL per step and any risks. Don't claim success for a step you skipped.
