# Chrome Web Store listing: Lichess Woodpecker

Everything to paste into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
The extension is **already published** ([listing](https://chromewebstore.google.com/detail/lichess-woodpecker/hiplnejlfcaelegbajdonblkcechfced), item ID `hiplnejlfcaelegbajdonblkcechfced`), so this is an **update**:
open that item rather than creating a new one. Most fields below are already filled in on the live listing; this is the
source of truth to change or re-check them against.

## 0. Before you start

1. Run `/release 1.3.1`. It bumps the version, builds the packages and publishes the GitHub Release. (1.2.0 is already tagged, and the
   Firefox manifest changed after it: see the Firefox listing file. The Chrome package itself is unchanged apart from the version.)
2. Open the item in the dashboard: **Package → Upload new package**. The version must be **higher than the one currently
   published** (shown on the Package tab).

## 1. The package to upload

| | |
|---|---|
| File | `lichess-puzzle-saver-v1.3.1.zip` (the file name still carries the project's old name; it contains Lichess Woodpecker) |
| Where | `release/` in this repository after `npm run package`, or the same file attached to the [GitHub Release](https://github.com/avendesta/lichess-woodpecker/releases) |
| Check | Manifest V3, version 1.3.1, 18 files, permissions exactly `storage`, `activeTab`, `scripting`, and no `host_permissions` key (see the note below about what the dashboard shows) |

**What the Package tab shows after you upload.** The Draft column lists `storage, activeTab, scripting, host permission`. That is expected:

- **"host permission"** is the content script on `https://lichess.org/training/*`. The dashboard counts a content script's sites as host access even though the manifest has no `host_permissions` key. Version 1.1.0 had a content script on lichess.org too (its pattern also covered http and subdomains; 1.3.0 narrows it to `https://lichess.org/training/*`), so it is not new, and narrowing access never prompts existing users. It needs the "Host access" justification in section 4.
- **`tabs` is gone.** The Published column (1.1.0) still lists `tabs`; 1.3.0 does not request it, which removes the "read your browsing history" warning. A permission being dropped never prompts existing users.

## 2. Store listing tab

| Field | Value |
|---|---|
| **Title** | `Lichess Woodpecker` (comes from the manifest's `name`, 18 of 75 characters) |
| **Summary** | `Woodpecker training mode for Lichess puzzles. Save puzzles, create categories, and practice with randomized training.` (comes from the manifest's `description`, 117 of 132 characters; change it in `manifest.json` and `manifest-firefox.json` together) |
| **Category** | Keep the live listing's. If you change it, the closest fits are **Education** or **Games**. The dashboard's list of categories changes, so pick from what it shows. |
| **Language** | English |
| **Mature content** | Off |
| **Homepage URL** | https://github.com/avendesta/lichess-woodpecker |
| **Support URL** | https://github.com/avendesta/lichess-woodpecker/issues |
| **Official URL** | None (it is chosen from sites you have verified in Google Search Console; skip it) |

### Description

Plain text: the dashboard does not render Markdown. Paste exactly this (it starts at the next line and ends at the closing fence).

```text
Lichess Woodpecker turns Lichess puzzle training into Woodpecker-style practice: collect a set of puzzles, solve them again and again in a new shuffled order, and watch your speed and accuracy improve.

SAVE PUZZLES
• Open any Lichess puzzle, click the toolbar icon and press Save next to a category.
• Create, rename and delete as many categories as you like. The same puzzle is never saved twice in a category, and a saved puzzle comes out again with one click.
• Search puzzle IDs across all your categories.

TRAIN IN CYCLES
• Press the lightning-bolt button on a category (or "Train all categories") and the extension takes you through its puzzles in random order.
• A small overlay on the Lichess page shows your progress, a timer and your correct, incorrect and skipped counts. Skip a puzzle, restart the cycle, pause and continue exactly where you left off, or minimize the overlay.
• A correct solve can move on to the next puzzle by itself, while mistakes wait for you so you can study them.
• When a cycle ends, a score screen shows your first-try accuracy and time, with a one-click Repeat for the next, reshuffled cycle, and a scene behind your score: fireworks for a perfect cycle, sparkles, floating particles, or a storm.
• The overlay follows Lichess's light or dark theme, or you can choose Dark or Light.

SETTINGS
• A Settings tab on the options page: choose the overlay's theme, turn the score-screen animations and Auto-next on or off, pick a table-slam animation, choose how the popup orders your categories (alphabetical or last used), and turn its tips on or off.
• Press Shift+F on a puzzle page to slam the board: a giant fist, or a shaking table (or None to turn it off).

TRACK YOUR PROGRESS
• The Statistics tab lists every finished cycle: category, time, puzzles, correct, incorrect, skipped, first-try accuracy and date.
• Back up your categories to a file and import them in another browser.

PRIVATE BY DESIGN
• Everything is stored on your device. No account, no tracking, no analytics, and the extension makes no network requests of its own.
• Permissions are minimal: storage, and temporary access to the tab you open the popup on. The training overlay appears only on lichess.org/training pages.

TIP: Lichess has a setting called "Jump to next puzzle immediately". While it is on, a mistake cannot wait for you to study it, so turn it off for training.

Lichess Woodpecker is an independent project. It is not affiliated with or endorsed by Lichess. The Woodpecker Method is a puzzle-repetition training approach popularised by Axel Smith and Hans Tikkanen's book of the same name; this extension is inspired by it.
```

## 3. Graphic assets

| Asset | File in this repository | Spec | 
|---|---|---|
| **Store icon (128x128)** | **`icons/icon128.png`** (in the repository root, inside the `icons` folder) | 128x128 PNG. It is the same file the package contains. The logo's source is `icons/logo.svg`; `npm run generate-icons` rebuilds the PNGs from it. |
| Screenshot 1 | `docs/screenshots/01-save-from-popup.png` | 1280x800, 24-bit PNG, no alpha |
| Screenshot 2 | `docs/screenshots/02-training-overlay.png` | 1280x800 |
| Screenshot 3 | `docs/screenshots/03-cycle-complete.png` | 1280x800 |
| Screenshot 4 | `docs/screenshots/04-categories.png` | 1280x800 |
| Screenshot 5 | `docs/screenshots/05-statistics.png` | 1280x800 (the dashboard accepts 1 to 5) |
| **Small promo tile** | `docs/store/small-promo-tile-440x280.png` | 440x280. Required. |
| **Marquee promo tile** | `docs/store/marquee-promo-1400x560.png` | 1400x560. Optional. |
| Promo video | (none) | Optional. Chrome's documentation lists it as required, but the page dates from 2020; if the dashboard insists, record a short screen capture and add its YouTube link. |

The screenshots are real extension screens over real Lichess pages, with made-up puzzle IDs and training history. The first one is
the popup rendered over the page (a toolbar popup cannot be captured by automation).

## 4. Privacy practices tab

**Single purpose description**

```text
Helps users practise Lichess puzzles in Woodpecker-style repeated cycles: it saves puzzle IDs into personal categories, then trains them in shuffled order with an on-page timer, progress and results.
```

**Permission justifications** (one box per permission listed in the manifest)

**`storage`**

```text
Saves the user's categories, the puzzle IDs they save, their training progress and their results in storage.local, on their own device only. Nothing is sent anywhere.
```

**`activeTab`**

```text
When the user clicks the toolbar icon on a Lichess puzzle page, the popup reads that page's puzzle ID so it can be saved. The access covers only that tab and only after the user's click.
```

**`scripting`**

```text
Used together with activeTab: runs one small function bundled inside the extension (scripting.executeScript with func; never remote code) in the tab the popup was opened on, to read the puzzle ID from the page's markup.
```

**Host access (the content script on `https://lichess.org/training/*`)**

```text
A content script on lichess.org/training pages draws the training overlay (timer, progress, Skip, Restart, Pause) and reads the puzzle page's own markup to count a puzzle as correct, incorrect or skipped. It reads nothing else and sends nothing anywhere.
```

**Remote code:** choose **No, I am not using remote code.** (All code is in the package; nothing is fetched or evaluated.)

**Data usage:** the extension does not send any user data off the device (no analytics, no network requests of its own). Leave the data
type boxes **unchecked**, and tick the three certification statements. Keep this consistent with how the live listing is already
answered. If you ever change what is transmitted, change this, the privacy policy and the Firefox manifest's `data_collection_permissions` together.

**Privacy policy URL:** https://github.com/avendesta/lichess-woodpecker/blob/main/PRIVACY_POLICY.md
(It was brought up to date for this release: what is stored, that nothing is sent, and what the content script reads.)

## 5. Test instructions (Submission / "Provide test instructions")

```text
No account or login is needed, and nothing has to be configured.

1. Open https://lichess.org/training (anonymous puzzles work).
2. Click the extension's toolbar icon. The popup shows "Current puzzle #xxxxx". Click "+ New", type a name such as Test and press Enter, then press "Save" next to it (the button turns into a green check).
3. Reload https://lichess.org/training to get another puzzle, open the popup again and Save that one too.
4. In the popup press the lightning-bolt button next to the category. The tab moves to one of the saved puzzles and a "Woodpecker Training" panel appears at the bottom left of the page (timer, progress, Skip, Restart, Pause).
5. Press "Skip" until the cycle ends. A "Cycle 1 Complete" screen shows the counts, accuracy and time, with "Repeat" and "Exit".
6. Open the settings page (the gear in the popup). The Categories tab lists the saved puzzles; the Statistics tab shows the finished cycle.

The extension makes no network requests of its own and has no server; training only moves the tab to lichess.org/training/<id> addresses.
```

## 6. Distribution tab

| Field | Value |
|---|---|
| Visibility | Public |
| Pricing | Free |
| Regions | All regions (default) |

## 7. Account

The dashboard needs a verified contact email under **Account**. The public contact in the privacy policy and the README is `avendesta2020@gmail.com`.

## 8. Pre-submit checklist

- [ ] `/release 1.3.1` done; the zip in `release/` (or on the GitHub Release) is version 1.3.1
- [ ] Checked Save in the real popup by hand (automation cannot open the toolbar popup)
- [ ] Description, screenshots and promo images uploaded as above
- [ ] Permission justifications pasted for all four rows; remote code answered **No**
- [ ] Privacy policy URL set; the three certifications ticked
- [ ] Test instructions pasted
- [ ] Submit for review
