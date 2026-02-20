# Privacy Policy — Lichess Puzzle Bookmark

**Last updated: February 13, 2026**

## Overview

Lichess Puzzle Bookmark is a browser extension that lets users save Lichess training puzzle IDs into user-defined categories for personal organization. This policy explains what data the extension handles and how.

## Data Collection

**We do not collect any personal data.** The extension does not gather, transmit, or store any personally identifiable information (PII) such as names, email addresses, browsing history, or analytics.

## Data Storage

The extension stores the following data **locally on your device** using the browser's built-in extension storage (`storage.local`):

- **Puzzle IDs** — Short alphanumeric identifiers (e.g., `0j7EP`) extracted from Lichess training puzzle pages.
- **Category names** — User-created labels used to organize saved puzzle IDs.
- **Metadata** — A schema version number and a last-updated timestamp (not linked to any user identity).

All data remains entirely on your device. No data is synced to any cloud service, remote server, or third party.

## Network Requests

**The extension makes zero network requests.** It does not communicate with any external server, API, or analytics service. The only network activity occurs when you click "Open" on a saved puzzle, which navigates your browser to `https://lichess.org/training/{id}` — a standard browser navigation, not an extension-initiated request.

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
| `activeTab` | Grants temporary access to the active tab when the user clicks the extension icon. Allows reading the tab URL and injecting a script to read the puzzle ID from the DOM. |
| `scripting` | Inject an inline function into the active tab to extract the puzzle ID from the page DOM when the URL does not contain it (e.g., `/training`, `/training/mix`). Works with `activeTab` — no host permissions needed. |

No `tabs` permission or `host_permissions` are requested. The extension has no persistent access to any website.

## Changes to This Policy

If this policy is updated, the "Last updated" date at the top will be revised. Continued use of the extension after changes constitutes acceptance.

## Contact

For questions or concerns about this privacy policy, contact:

**Email:** avendestawork@gmail.com
