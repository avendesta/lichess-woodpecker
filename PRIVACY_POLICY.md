# Privacy Policy — Lichess Woodpecker

**Last updated: October 13, 2026**

## Overview

Lichess Woodpecker is a browser extension that lets users save Lichess training puzzle IDs into user-defined categories for personal organization, and train them in repeated, randomized cycles with an overlay on Lichess puzzle pages. This policy explains what data the extension handles and how.

## Data Collection

**We do not collect any personal data.** The extension does not gather, transmit, or store any personally identifiable information (PII) such as names, email addresses, browsing history, or analytics.

## Data Storage

The extension stores the following data **locally on your device** using the browser's built-in extension storage (`storage.local`):

- **Puzzle IDs** — Short alphanumeric identifiers (e.g., `0j7EP`) extracted from Lichess training puzzle pages.
- **Category names and colours** — User-created labels used to organize saved puzzle IDs, the colour you or the extension gave each, and when you last saved a puzzle to it or trained it (used to list the most recently used first; it stays on your device).
- **Training results** — For each finished training cycle: the category, how long it took, how many puzzles it had, how many you got correct, incorrect or skipped, and when it finished.
- **Training in progress** — The shuffled list of puzzle IDs of a cycle you are training, your position in it, its timer and counts, and any cycles you have paused.
- **Settings** — Where you dragged the training overlay, and the choices on the Settings tab: the overlay's theme (follow Lichess, dark or light), whether the animations behind the score screen are shown, whether the next puzzle comes up by itself after a correct one, and which table-slam animation (fist, shake or none) the Shift+F shortcut plays, whether the popup lists categories alphabetically or by last use, whether it shows its small tip, and which tip it showed last (so the next one differs).
- **Metadata** — A schema version number and a last-updated timestamp (not linked to any user identity).

All data remains entirely on your device. No data is synced to any cloud service, remote server, or third party.

**Sounds and animations.** The score-screen scenes and the table-slam animation are drawn on the page by the extension itself. The slam's thud is generated on the spot by your browser; no sound file is loaded, nothing is recorded, and nothing leaves your device.

**Export and import.** The settings page can save your categories and puzzle IDs to a file you choose, and read such a file back. Both happen in your browser, only when you ask, and the file goes only where you put it.

## Network Requests

**The extension makes zero network requests.** It does not communicate with any external server, API, or analytics service. The only network activity occurs when you ask your browser to go to Lichess: when you click "Open" on a saved puzzle, "Open Lichess puzzles", or train (which moves your tab on to the next puzzle). That is a standard browser navigation to `https://lichess.org/training/…`, not a request made by the extension.

## What the Extension Reads on Lichess

On `https://lichess.org/training/` pages the extension runs a content script that draws the training overlay and reads the puzzle page's own markup: the puzzle's ID and whether you solved it cleanly, so it can count your results. It does not read your Lichess account, cookies or any other site's data, and nothing it reads is sent anywhere.

## Data Sharing

**We do not sell, share, or transfer any user data to third parties.** No data leaves your device.

## Data Retention

Saved data persists in your browser's local extension storage until:

- You manually remove individual puzzles or categories within the extension, or
- You uninstall the extension (which clears all extension storage), or
- You clear your browser's extension data.

## Permissions Justification

| Permission | Purpose |
|---|---|
| `storage` | Store puzzle IDs and categories locally |
| `activeTab` | Grants temporary access to the active tab when the user clicks the extension icon, so the popup can read the puzzle ID from that page. The extension does not read the tab's address. |
| `scripting` | Runs one small function bundled with the extension in the active tab to read the puzzle ID from the page's markup (the ID is not always in the address, e.g. on `/training`). Works with `activeTab`. |

No `tabs` permission or `host_permissions` are requested. The only standing access is the content script on `https://lichess.org/training/` pages described above, which exists to show the training overlay on puzzle pages. The extension loads and runs no remote code.

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top will be revised. Continued use of the extension after changes constitutes acceptance.

## Contact

For questions or concerns about this privacy policy, contact:

**Email:** avendesta2020@gmail.com
