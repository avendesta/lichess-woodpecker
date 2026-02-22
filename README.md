# Lichess Woodpecker

A cross-browser Manifest V3 extension for saving Lichess training puzzle IDs into user-defined categories.

## Features

- **One-click save** — Save the current puzzle ID when on a valid `https://lichess.org/training/{id}` page
- **User-defined categories** — Create, rename, and delete categories freely
- **Duplicate prevention** — Won't add the same puzzle ID to a category twice
- **Search/filter** — Quickly find puzzle IDs across all categories
- **Open / Copy / Remove** — Manage saved puzzles with one click
- **Cross-browser** — Works on Chrome and Firefox with the same codebase
- **Persistent storage** — Data survives browser restarts via `storage.local`

## Project Structure

```
lichess-woodpecker/
├── manifest.json            # MV3 manifest (Chrome + Firefox compatible)
├── browser-polyfill.js      # Minimal polyfill: wraps chrome.* as browser.*
├── background.js            # Service worker: storage ops, URL parsing, message handler
├── popup.html               # Popup UI markup
├── popup.css                # Popup styles (dark theme)
├── popup.js                 # Popup logic: save flow, category selector, quick view
├── options.html             # Full manager page markup
├── options.css              # Manager page styles
├── options.js               # Manager logic: CRUD categories/puzzles, search
├── icons/
│   ├── icon16.png           # Toolbar icon
│   ├── icon48.png           # Extension management icon
│   └── icon128.png          # Store/install icon
├── scripts/
│   └── package.js           # Packaging script for Chrome Web Store ZIP
├── docs/
│   └── privacy-policy.html  # Hosted privacy policy (GitHub Pages)
├── generate-icons.js        # (Dev utility) Generates PNG icons from code
├── package.json             # npm scripts (package, generate-icons)
├── PRIVACY_POLICY.md        # Privacy policy
├── .gitignore
└── README.md
```

## Installation

### Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `lichess-woodpecker` folder (the one containing `manifest.json`)
5. The extension icon appears in the toolbar

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` inside the `lichess-woodpecker` folder
4. The extension icon appears in the toolbar

> **Note:** Firefox temporary add-ons are removed on restart. For persistent installation, package as `.xpi` and sign via [AMO](https://addons.mozilla.org/).

## Data Schema

All data is stored under the key `lichessNotes` in `browser.storage.local`:

```json
{
  "categories": {
    "Queen Attacks": ["0j7EP", "abc12"],
    "Endgames": ["ZZ999"]
  },
  "meta": {
    "version": 1,
    "updatedAt": 1707849600000
  }
}
```

### Storage Helpers (in `background.js`)

| Function | Description |
|---|---|
| `getAllData()` | Read full dataset; resets to defaults if corrupted |
| `saveAllData(data)` | Write full dataset with updated timestamp |
| `createCategory(name)` | Create category; rejects empty/duplicate names (case-insensitive) |
| `renameCategory(old, new)` | Rename; rejects if new name collides |
| `deleteCategory(name)` | Delete category and all its puzzles |
| `addPuzzleToCategory(cat, id)` | Add puzzle; returns `{duplicate: true}` if exists |
| `removePuzzleFromCategory(cat, id)` | Remove single puzzle from category |

## URL Validation Rules

The `extractPuzzleId(url)` function in `background.js` enforces:

- **Protocol:** must be `https:`
- **Hostname:** must be exactly `lichess.org`
- **Pathname:** must be exactly `/training/{id}` (two segments only)
- **ID format:** alphanumeric characters only (`[a-zA-Z0-9]+`)
- **Query/hash:** allowed but ignored (the ID is still extracted from the pathname)

### Examples

| URL | Result |
|---|---|
| `https://lichess.org/training/0j7EP` | ✅ `0j7EP` |
| `https://lichess.org/training/0j7EP?color=white` | ✅ `0j7EP` |
| `https://lichess.org/training/0j7EP#hint` | ✅ `0j7EP` |
| `http://lichess.org/training/0j7EP` | ❌ wrong protocol |
| `https://lichess.org/training/` | ❌ empty ID |
| `https://lichess.org/training/abc/extra` | ❌ extra path segment |
| `https://lichess.org/puzzles/0j7EP` | ❌ wrong path |
| `https://other.org/training/0j7EP` | ❌ wrong hostname |

## Permissions Rationale

The extension requests the minimum permissions required for its functionality:

| Permission | Type | Why it's needed |
|---|---|---|
| `storage` | Permission | Persist puzzle IDs and categories locally via `storage.local`. Core to the extension's purpose. |
| `activeTab` | Permission | Grants temporary access to the active tab when the user clicks the extension icon. Allows reading the tab URL and injecting a script to extract the puzzle ID from the DOM. No background or persistent access. |
| `scripting` | Permission | Enables `scripting.executeScript` to inject an inline function into the active tab that reads the puzzle ID from the page DOM. Only used on `/training` and `/training/mix` pages where the ID is not in the URL. Works with `activeTab` — no `host_permissions` needed. |

No `tabs` permission or `host_permissions` are requested.

**No data is collected, transmitted, or shared.** See the [Privacy Policy](#privacy-policy) for full details.

## Privacy Policy

The full privacy policy is available at:

- **In this repo:** [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)
- **Hosted (for Web Store):** [docs/privacy-policy.html](./docs/privacy-policy.html) — deploy via GitHub Pages at `https://<username>.github.io/lichess-woodpecker/privacy-policy.html`

**Summary:** The extension stores only puzzle IDs and category names locally on your device. It makes zero network requests, collects no personal data, and shares nothing with third parties.

**Contact:** avendestawork@gmail.com

## Packaging for Chrome Web Store

To produce a release ZIP suitable for uploading to the Chrome Web Store:

```bash
npm run package
```

This runs `scripts/package.js`, which:

1. Reads the version from `manifest.json`
2. Validates that all runtime files exist
3. Creates `release/lichess-puzzle-saver-v<version>.zip` containing only the files Chrome needs

**Output:** `release/lichess-puzzle-saver-v1.0.0.zip`

The ZIP excludes all dev files (README, docs, scripts, `.git/`, etc.) and contains only:

- `manifest.json`, `background.js`, `browser-polyfill.js`, `extract-puzzle.js`
- `popup.html`, `popup.css`, `popup.js`
- `options.html`, `options.css`, `options.js`
- `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

> The `release/` directory and `*.zip` files are git-ignored and will not be committed.

## Manual Test Checklist

### Setup
- [ ] Load extension in Chrome (unpacked)
- [ ] Load extension in Firefox (temporary add-on)
- [ ] Extension icon visible in toolbar

### Popup — Invalid Page
- [ ] Open popup on `about:blank` → save section hidden, shows "Open a Lichess training puzzle" message
- [ ] Open popup on `https://lichess.org/` → same invalid state
- [ ] Open popup on `https://lichess.org/training/` → invalid (empty ID)

### Popup — Valid Page
- [ ] Navigate to `https://lichess.org/training/0j7EP`
- [ ] Open popup → shows "Puzzle: 0j7EP", save section visible
- [ ] Save button disabled until category selected

### Category Management
- [ ] Select "+ New category…" → input appears
- [ ] Type "Tactics" and click Save → puzzle saved, toast "Saved 0j7EP to Tactics"
- [ ] Category appears in dropdown and in puzzle list below
- [ ] Create second category "Endgames"
- [ ] Try creating "tactics" (lowercase) → error "Category already exists"
- [ ] Open options page (gear icon) → both categories visible

### Saving Puzzles
- [ ] Save same puzzle to same category → toast "Already saved"
- [ ] Navigate to different puzzle, save to "Tactics" → success
- [ ] Save to "Endgames" → success

### Puzzle Actions (Popup & Options)
- [ ] Click Open icon → new tab opens `https://lichess.org/training/{id}`
- [ ] Click Copy icon → URL copied to clipboard, toast confirms
- [ ] Click Remove icon → puzzle removed, list updates

### Options Page — Category Management
- [ ] Rename "Tactics" to "Sharp Tactics" → success
- [ ] Try rename to "Endgames" → error (duplicate)
- [ ] Delete "Endgames" → confirmation dialog → confirm → category removed

### Search
- [ ] Type partial puzzle ID in search box → categories filter to show only matches
- [ ] Clear search → all categories/puzzles visible again

### Persistence
- [ ] Close and reopen browser → all data intact
- [ ] Disable and re-enable extension → data intact

### Edge Cases
- [ ] Empty category (all puzzles removed) → shows "No puzzles saved" message, category persists
- [ ] No categories → shows "No categories yet — create one to start"
- [ ] URL with query params `?color=white` → still extracts ID correctly
- [ ] URL with hash `#hint` → still extracts ID correctly
