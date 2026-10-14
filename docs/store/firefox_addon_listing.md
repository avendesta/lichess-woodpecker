# Firefox Add-ons (AMO) listing: Lichess Woodpecker

Everything to paste into [addons.mozilla.org's developer hub](https://addons.mozilla.org/developers/) ("Submit a New Add-on").
This is the **first** submission of this add-on to AMO. Nothing about it exists there yet.

## 0. Is the `.xpi` ready? What was missing, and what to do first

The version-1.2.0 `.xpi` was **not** ready: from 3 November 2025 Mozilla requires every new add-on to declare what data it collects
(`browser_specific_settings.gecko.data_collection_permissions`), and signing a new add-on without it is rejected. The manifest now
declares `"required": ["none"]` (the extension sends nothing anywhere), so the next release's `.xpi` is ready.

1. Run `/release 1.3.0`. It bumps the version, builds `release/lichess-woodpecker-v1.3.0.xpi` and publishes the GitHub Release.
   (1.2.0 is already tagged and its `.xpi` lacks the key. Do not submit that one.)
2. Submit the 1.3.0 `.xpi` as below.

What the validation will show you: **0 errors and 2 warnings**, both of them `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION` /
`KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` ("`strict_min_version` is 109, but Firefox only learned this key in 140"). They are
harmless: older Firefox ignores the key, and an add-on that collects no data needs nothing more for them. They are accepted on purpose,
to keep supporting Firefox 109 and up. Raising `strict_min_version` to 140 (and adding a `gecko_android` section at 142) would clear them
and drop older Firefox.

## 1. Submit

1. Sign in at https://addons.mozilla.org/developers/ and choose **Submit a New Add-on**.
2. **Distribution:** **On this site** (listed on AMO). ("On your own" is for add-ons you host yourself.)
3. **Upload:** `release/lichess-woodpecker-v1.3.0.xpi` from this repository after `npm run package:firefox`, or the same file on the
   [GitHub Release](https://github.com/avendesta/lichess-woodpecker/releases). It is unsigned; AMO signs it.
4. Wait for validation: expect the 0 errors and 2 warnings described above.
5. **Platforms:** tick **Windows, macOS and Linux**. Leave **Android off**: the extension has only been tested in desktop Firefox.
6. **Do you need to submit source code?** **No.** There is no build step and nothing is minified, transpiled or obfuscated: the uploaded
   files are the source. (`content.js` holds the logo as one inline SVG string, written there by `generate-icons.js` from
   `icons/logo.svg`; it is plain, readable text.)

## 2. Listing details

| Field | Value |
|---|---|
| **Name** | `Lichess Woodpecker` |
| **Add-on URL** | `lichess-woodpecker` |
| **Experimental** | Off |
| **Requires payment** | Off |
| **Categories** (up to 2) | **Games & Entertainment** (a second one is optional) |
| **Support email** | avendesta2020@gmail.com |
| **Support website** | https://github.com/avendesta/lichess-woodpecker/issues |
| **Homepage** | https://github.com/avendesta/lichess-woodpecker |
| **License** | **Your decision.** The repository has no LICENSE file, so today it is "All rights reserved". If you keep it that way choose **All Rights Reserved**. If you want it open source, add a LICENSE file (for example MIT) first and choose the same one here. I did not pick one for you. |
| **Privacy policy** | Leave the checkbox **off**: Mozilla asks for it when data leaves the device, and nothing does. The policy is still public at https://github.com/avendesta/lichess-woodpecker/blob/main/PRIVACY_POLICY.md and linked from the description. |
| **Tags** | **Optional, and you cannot type your own:** AMO only offers a fixed list (Mozilla's choice, to stop tag spam), and it is short, so many add-ons fit none of it. Pick the few that honestly describe the add-on (anything about games or chess, puzzles, training, learning), or leave it empty. Tags do not affect approval. |

### Summary (206 of 250 characters)

```text
Save Lichess puzzles into categories and train them Woodpecker-style: shuffled cycles, a timer, first-try accuracy and history. Everything stays on your device; no account, no tracking, no network requests.
```

### Description

AMO renders a small Markdown subset (bold, lists, links), which is what this uses. Paste exactly this.

```markdown
Lichess Woodpecker turns Lichess puzzle training into Woodpecker-style practice: collect a set of puzzles, solve them again and again in a new shuffled order, and watch your speed and accuracy improve.

**Save puzzles**
* Open any Lichess puzzle, click the toolbar icon and press Save next to a category.
* Create, rename and delete as many categories as you like. The same puzzle is never saved twice in a category, and a saved puzzle comes out again with one click.
* Search puzzle IDs across all your categories.

**Train in cycles**
* Press the lightning-bolt button on a category (or "Train all categories") and the extension takes you through its puzzles in random order.
* A small overlay on the Lichess page shows your progress, a timer and your correct, incorrect and skipped counts. Skip a puzzle, restart the cycle (it asks first), pause and continue exactly where you left off, or minimize the overlay.
* A correct solve can move on to the next puzzle by itself, while mistakes wait for you so you can study them.
* When a cycle ends, a score screen shows your first-try accuracy and time, with a one-click Repeat for the next, reshuffled cycle, and a scene behind your score: fireworks for a perfect cycle, sparkles, floating particles, or a storm.
* The overlay follows Lichess's light or dark theme, or you can choose Dark or Light.

**Settings**
* A Settings tab on the options page: choose the overlay's theme, turn the score-screen animations and Auto-next on or off, and pick a table-slam animation.
* Press Shift+F on a puzzle page to slam the board: a giant fist, or a shaking table (or None to turn it off).

**Track your progress**
* The Statistics tab lists every finished cycle: category, time, puzzles, correct, incorrect, skipped, first-try accuracy and date.
* Back up your categories to a file and import them in another browser.

**Private by design**
* Everything is stored on your device. No account, no tracking, no analytics, and the extension makes no network requests of its own.
* Permissions are minimal: storage, and temporary access to the tab you open the popup on. The training overlay appears only on lichess.org/training pages.

TIP: Lichess has a setting called "Jump to next puzzle immediately". While it is on, a mistake cannot wait for you to study it, so turn it off for training.

Lichess Woodpecker is an independent project. It is not affiliated with or endorsed by Lichess. The Woodpecker Method is a puzzle-repetition training approach popularised by Axel Smith and Hans Tikkanen's book of the same name; this extension is inspired by it.

[Privacy policy](https://github.com/avendesta/lichess-woodpecker/blob/main/PRIVACY_POLICY.md) · [Source code and issues](https://github.com/avendesta/lichess-woodpecker)
```

### Icon and screenshots

| Asset | File in this repository |
|---|---|
| **Icon** | **`icons/icon128.png`** (128x128). AMO reads it from the package's manifest, so there is nothing to upload unless you want to replace it later. |
| Screenshot 1 | `docs/screenshots/01-save-from-popup.png` (1280x800, the size Mozilla recommends) |
| Screenshot 2 | `docs/screenshots/02-training-overlay.png` (1280x800, the size Mozilla recommends) |
| Screenshot 3 | `docs/screenshots/03-cycle-complete.png` (1280x800, the size Mozilla recommends) |
| Screenshot 4 | `docs/screenshots/04-categories.png` (1280x800, the size Mozilla recommends) |
| Screenshot 5 | `docs/screenshots/05-statistics.png` (1280x800, the size Mozilla recommends) |

Captions (Mozilla shows them under each screenshot; keep the text out of the images):

1. Save the puzzle you are looking at into any category from the toolbar popup.
2. Train a category in shuffled order, with a timer, progress and your counts right on the Lichess page.
3. A finished cycle shows your first-try accuracy and time, with one click to repeat it.
4. Create, rename and delete categories, and see every puzzle saved in them.
5. Your training history: time, correct, incorrect, skipped and first-try accuracy for each cycle.

## 3. Notes to reviewer

```text
Lichess Woodpecker has no build step: the uploaded files are the source, with nothing minified, transpiled or obfuscated. No remote code is loaded or evaluated, and the extension makes no network requests of its own (no fetch, no XMLHttpRequest, no analytics). It declares data_collection_permissions "none".

Permissions: "storage" keeps the user's categories, saved puzzle IDs, training progress and results in storage.local. "activeTab" lets the popup read the puzzle ID of the tab it is opened on, after the user clicks the toolbar button. "scripting" is used with it: scripting.executeScript with a bundled func reads the puzzle ID from the page markup. There are no host permissions. The only standing access is the content script declared for https://lichess.org/training/*, which draws the training overlay and reads that page's own markup to count a puzzle as correct or incorrect.

content.js contains the logo as one inline SVG string. It is written there by generate-icons.js from icons/logo.svg, which is in the repository (https://github.com/avendesta/lichess-woodpecker); it is plain text, not obfuscated.

How to test (no account needed):
1. Open https://lichess.org/training (anonymous puzzles work).
2. Click the extension's toolbar icon. The popup shows "Current puzzle #xxxxx". Click "+ New", type a name such as Test and press Enter, then press "Save" next to it (the button turns into a green check).
3. Reload https://lichess.org/training to get another puzzle, open the popup again and Save that one too.
4. In the popup press the lightning-bolt button next to the category. The tab moves to one of the saved puzzles and a "Woodpecker Training" panel appears at the bottom left of the page (timer, progress, Skip, Restart, Pause).
5. Press "Skip" until the cycle ends. A "Cycle 1 Complete" screen shows the counts, accuracy and time, with "Repeat" and "Exit".
6. Open the settings page (the gear in the popup). The Categories tab lists the saved puzzles; the Statistics tab shows the finished cycle.

The extension makes no network requests of its own and has no server; training only moves the tab to lichess.org/training/<id> addresses.
```

## 4. Version notes (shown on the add-on's page)

```text
Version 1.3.0: a new Settings tab (overlay theme, score-screen animations, Auto-next, table-slam animation), a scene behind the score screen, and a Shift+F board slam (fist or shake, or off). Auto-next moved from the overlay to Settings; your choice is kept.
```

For the very first submission use this instead:

```text
First release on Firefox Add-ons. Save Lichess puzzles into categories and train them in shuffled, repeated cycles with an on-page timer, progress and results, a score screen with first-try accuracy, pause and resume per category, statistics for every finished cycle, and backup and restore of your categories. Everything is stored on your device.
```

## 5. After you submit

- AMO validates, signs and (possibly) reviews the add-on, and emails you; the page says only that it "may be subject to further review", with no time promised.
- When it is approved, download the signed file from the version page, then update the README's Firefox section: it currently says Firefox is a temporary install only, which stops being true.
- **The add-on ID `lichess-woodpecker@extension` becomes permanent** once it is published (updates are matched by it). It is a valid ID. If you would rather have a different one, change `browser_specific_settings.gecko.id` in `manifest-firefox.json` **before** submitting.
- Later versions go through the add-on's own page (**Upload a New Version**), not "Submit a New Add-on", and every one must keep `data_collection_permissions`.

## 6. Pre-submit checklist

- [ ] `/release 1.3.0` done; the `.xpi` is version 1.3.0
- [ ] Validation shows 0 errors (2 version warnings expected)
- [ ] Platforms: desktop only; source code question answered **No**
- [ ] Name, URL, summary, description, categories, support details entered
- [ ] **License chosen** (decision needed: there is no LICENSE file)
- [ ] Icon from the package; five screenshots with captions
- [ ] Notes to reviewer pasted
- [ ] Submit version
