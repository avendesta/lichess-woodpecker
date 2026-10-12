<p align="center">
  <img src="icons/icon128.png" alt="Lichess Woodpecker logo" width="96" height="96">
</p>

# Lichess Woodpecker

NOW AVAILABLE IN [GOOGLE WEB STORE](https://chromewebstore.google.com/detail/lichess-woodpecker/hiplnejlfcaelegbajdonblkcechfced)

A powerful browser extension for Lichess puzzle training with Woodpecker-style repetition practice. Save puzzles into categories, train them in randomized order, and track your performance with detailed statistics.

## ✨ Features

### 🎯 Puzzle Management
- **One-click save** — Open the popup on a Lichess puzzle and press **Save** next to any category; the popup shows the current puzzle and whether it is already saved (and in how many categories). With no puzzle detected it says so, and the card is a link ("Open Lichess puzzles"): click it to open Lichess puzzles in a new tab
- **Smart categories** — Create, rename, and delete unlimited categories in options page, which keeps itself up to date (save a puzzle from the popup and it appears there without a reload) and opens on two cards: how many categories you have and how many different puzzles are saved
- **Duplicate prevention** — Never save the same puzzle twice
- **Quick actions** — Open or remove puzzles with one click
- **Global search** — Find puzzles instantly across all categories

### 🏋️ Woodpecker Training Mode
- **Randomized practice** — Train puzzles in shuffled order for effective learning
- **Session tracking** — Real-time timer and progress monitoring
- **Smart navigation** — Skip difficult puzzles or advance after solving
- **Cycle management** — Automatic reshuffling when all puzzles are completed
- **Train All** — Practice across all categories simultaneously
- **Settings access** — Quick settings button in training overlay

### 📊 Performance Analytics
- **Correct / Incorrect / Skipped** — Each puzzle counts as correct only if solved with no wrong move; a wrong move (even if you then finish it) or viewing the solution counts as incorrect, and the overlay's Skip button counts as skipped. Using Get a hint doesn't count against you, following Lichess: a hinted puzzle you then solve cleanly is correct
- **First-try accuracy** — Color-coded (green/yellow/red) share of puzzles solved correctly on the first attempt
- **Time tracking** — Monitor completion time for each training cycle
- **Historical data** — View performance trends across categories
- **Statistics table** — A breakdown per training cycle with an icon on each column: Correct in green, Incorrect in red, Skipped in amber, and the first-try Accuracy beside them; it updates by itself as you train
- **Collapsible categories** — Organized view with default collapsed state

### 🎨 User Experience
- **Dark theme** — Easy on the eyes during long training sessions
- **Responsive overlay** — Non-intrusive training interface with minimize/close controls
- **Streamlined popup** — Current puzzle, a one-line total (how many categories, and how many different puzzles you have saved), a search box, **+ New** category, a scrollable list that stays compact however many categories you have, and a **⚡ Train** button per category (hover or focus it to see the label)
- **Direct session control** — The ✕ in the training overlay immediately ends the session (and discards its progress); use **Pause** to stop without losing your place
- **Cross-browser** — Works on Chrome (Manifest V3) and Firefox (Manifest V2)

## 🚀 Quick Start

### Installation

#### Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `lichess-woodpecker` folder
5. The woodpecker icon appears in your toolbar

#### Firefox (temporary install only)
Firefox is supported but the add-on is not signed, so it can only be loaded temporarily —
it is removed when Firefox restarts. A permanent install would require signing through
[addons.mozilla.org](https://addons.mozilla.org).

1. Download the `.xpi` from the [latest release](https://github.com/avendesta/lichess-woodpecker/releases), or build it with `npm run package:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select the `.xpi` file

### Basic Usage

1. **Save Puzzles**
   - Visit any Lichess training page (`https://lichess.org/training/`)
   - Click the woodpecker icon to open the popup
   - Press **Save** next to any category to save the current puzzle (it turns into a green check), or **+ New** to make a category first. Saved by mistake? Hover the green check (it turns into a red ⊗ saying "Remove from this category") and click it to take the puzzle out again
   - Or manage categories in the options page for bulk operations

2. **Start Training**
   - Open the extension popup
   - Click the ⚡ button next to any category (empty categories can't be trained)
   - Or click "Train all categories" at the bottom of the popup to practice across all categories
   - Use the training overlay to track progress and navigate puzzles
   - Need to stop? Press **⏸ Pause** in the overlay; pressing Train on that category (or Train all categories) again continues exactly where you left off

3. **Manage & Track**
   - Open options page (⚙️ button): the **Categories** tab manages your categories and puzzles, and the **Statistics** tab shows your training history (the 10 most recent cycles, with **Load more** for older ones, and **Clear Stats**; it updates by itself, so there is nothing to refresh). The title bar with the tabs and **Backup & Restore** stays in view while you scroll
   - Use the settings button in training overlay for quick access
   - Moving to another browser? **Backup & Restore** → **Export JSON** in one, then **Backup & Restore** → **Import JSON** in the other (see below)

## 📖 Detailed Features

### Training Interface
- **Progress bar** — Visual indication of cycle completion
- **Timer display** — Track session duration. Beside it, a small **pause** icon. Below, **Settings** on the left and **Restart** and **Skip** on the right, all the same compact height. Restart (back to puzzle 1 with the timer and counts reset) asks you to confirm first; Skip is muted blue. Hover or focus any overlay button for a tooltip saying what it does
- **Cycle counter** — See how many rounds you've completed
- **Pause and resume, per category** — Press the **pause** icon in the overlay to stop the clock and keep your place. The panel stays exactly as it was, so nothing jumps around; it just shows that it is paused: the title reads **Paused**, the progress bar turns amber and gets a **Paused** tag, Skip and Auto-next are greyed out, and the pause icon becomes a green **play** button that opens into **Continue** when you hover or focus it. Restart still works (it asks first and starts the cycle over, running). What is saved: the puzzle order, where you are, the counts, the cycle number and the time so far are saved under that category, so you can spread a long cycle over several days and train other categories in between. Each category can have its own paused cycle (its row in the popup shows **⏸ 87/200**). Pressing ⚡ on a category with a paused cycle simply continues it, with no question asked: it picks up the same puzzle and the paused time is not counted. To start a paused cycle over instead, continue it and press **Restart** in the overlay (it asks first; finished cycles and statistics are kept). The overlay's ✕ says **Close** while paused: it hides the overlay without losing anything, and a minimized overlay shows ⏸ in place of the dumbbell. Closing the browser without pausing keeps the clock running, the ✕ in the normal training view still ends the session and discards its progress, and a cycle that is running (not paused) is replaced if you start another one
- **One tab at a time** — A training session belongs to the tab you pressed Play in. Other Lichess tabs ignore it (so browsing puzzles elsewhere never hijacks your training, and two tabs can't overwrite each other's progress). If that tab is closed or the browser restarts, any Lichess training page shows a small **Resume** chip that moves the session there at the puzzle you were on
- **Matches Lichess's theme** — The overlay switches between a light and a dark look to match the Lichess page, and is usable from the keyboard with labelled buttons and visible focus
- **Auto-next** — A correct solve moves on to the next puzzle by itself after about a second, so you don't have to press Continue training on every puzzle. Mistakes and viewed solutions still wait for you, since those are the ones worth studying. Switch it off with the checkbox in the overlay (remembered across sessions). If you also have Lichess's own "Jump to next puzzle immediately" turned on, the extension still keeps your session on track, but mistakes then can't wait for you, so leave that Lichess setting off for training
- **Cycle score screen** — When you finish the last puzzle of a cycle, the overlay shows "Cycle N Complete" with the category and how many puzzles were processed, then your correct (green), incorrect (red) and skipped (amber) counts, first-try accuracy and time taken, and waits: **Repeat** to start the next cycle (reshuffled) or **Exit** to end the session. It keeps the overlay's usual frame (title bar with minimize and ✕, the settings gear) and its colours follow the Lichess theme. A scene plays behind the figures for as long as the score screen is up, depending on your first-try accuracy: fireworks and confetti for a perfect 100%, golden sparkles above 75%, floating blue particles from 50% to 75%, and a storm (clouds, rain and a dim flash now and then) below 50%. It never blocks a button and is skipped if your system asks for reduced motion
- **Slam the board (experimental)** — On a puzzle page, press **Shift+F** and the board is slammed down with a thud: the screen shakes, dust flies, and the pieces bounce and wobble before settling back. It only reacts to Shift+F (plain F still flips the board), never while you are typing in a text box, and does nothing if your system asks for reduced motion.
- **Correct/Incorrect/Skipped stats** — Real-time performance metrics during training
- **Skip button** — Move past difficult puzzles (counts as skipped)
- **Settings button** — Quick access to options page during training
- **Direct close** — Close button immediately ends training session
- **Minimize/restore** — Collapse overlay to focus on puzzles

### Statistics Dashboard
- **Category breakdown** — Performance by puzzle category with collapsible view
- **Time analysis** — How long each training cycle takes
- **First-try accuracy** — Percentage of puzzles solved without a wrong move (cycles recorded before this was tracked show a dash)
- **Completion dates** — When each training cycle was finished
- **Export and import** — **Backup & Restore** (top right of the options page) opens a small dialog with **Export JSON**, which saves your categories and their puzzle IDs to a file, and **Import JSON**, which reads such a file in another browser (or the same one) and shows what it would change before anything is saved. Import only ever *adds*: new categories are created, and new puzzles are added to categories that already exist (matched ignoring upper/lower case), so nothing you have is removed or overwritten and importing the same file twice changes nothing. Training statistics, paused cycles and category colours are not part of the file
- **Historical tracking** — Your 10 most recent training cycles (newest first) on the Statistics tab, 10 more each time you press **Load more**; it updates by itself, with no refresh button
- **Clear statistics** — Reset functionality for fresh start

### Smart Features
- **Reads the page, not the address** — The puzzle ID is taken from the puzzle shown on the page itself (its "Puzzle #xxxxx" link), so the address bar is never read or parsed; pages that aren't a puzzle simply have none
- **Duplicate detection** — Prevents saving the same puzzle twice
- **Session persistence** — Training survives page refreshes
- **Extension context handling** — Graceful error recovery
- **Storage optimization** — Limits statistics to prevent bloat
- **Save buttons** — Quick puzzle addition without popup forms; each category keeps a stable colour

## 🛠️ Technical Details

### Permissions
- `storage` — Save puzzles and categories locally
- `activeTab` — Access current tab when you click the extension
- `scripting` — Extract puzzle IDs from page content

No `tabs` permission: it would let the extension read the address and title of every open tab, and nothing here needs that (the puzzle ID comes from the page you click the extension on, via `activeTab`).

### Data Storage
All data is stored locally in your browser:
- Puzzle IDs and categories
- Training session state
- Performance statistics
- User preferences

**No data is sent to any server. Everything stays on your device.**

### Browser Compatibility
- ✅ Chrome (Manifest V3)
- ✅ Firefox (Manifest V2 with dedicated XPI package)
- ✅ Edge (Chromium-based)

## 📁 Project Structure

```
lichess-woodpecker/
├── manifest.json           # Chrome extension configuration (Manifest V3)
├── manifest-firefox.json    # Firefox extension configuration (Manifest V2)
├── background.js           # Service worker for storage and messaging
├── content.js             # Training overlay and puzzle detection
├── popup.html/js/css      # Extension popup interface (streamlined)
├── options.html/js/css    # Full manager and statistics page
├── icons/                 # logo.svg (the one source of every brand image) and the PNG icons made from it (16/32/48/128px)
└── scripts/               # Build and packaging utilities
    ├── package.js          # Chrome packaging script
    └── package-firefox.js  # Firefox packaging script
```

## 🔧 Development

### Building
```bash
# Package for Chrome Web Store
node scripts/package.js

# Package for Firefox
node scripts/package-firefox.js

# Generate icons (development)
npm run generate-icons
```

The packaging scripts read the version from `manifest.json` and create:
- `release/lichess-puzzle-saver-v<version>.zip` — upload to the Chrome Web Store
- `release/lichess-woodpecker-v<version>.xpi` — temporary install in Firefox (unsigned)
- `release/firefox/` — the staged, unpacked Firefox build that `web-ext lint` and `web-ext run` use

Pushing a `v<version>` tag builds both and attaches them to a GitHub Release. Store submission is manual.

### Local Testing
1. Load as unpacked extension
2. Enable Developer mode in browser
3. Select the project folder
4. Test on `https://lichess.org/training` pages

## 📊 Privacy

Lichess Woodpecker respects your privacy:

- ✅ **No tracking** — No analytics or telemetry
- ✅ **No network requests** — Works completely offline
- ✅ **Local storage only** — Data never leaves your browser
- ✅ **Minimal permissions** — Only requests what's necessary
- ✅ **Open source** — Code fully available for inspection

[View full Privacy Policy](PRIVACY_POLICY.md)

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - feel free to use, modify, and distribute.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/avendesta/lichess-woodpecker/issues)
- **Email**: avendesta2020@gmail.com
- **In the extension**: the `?` button in the settings page opens **Help & About** with these links, the privacy policy and the version
- **Privacy**: See [Privacy Policy](PRIVACY_POLICY.md)

---

**Made with ❤️ for chess improvement enthusiasts**  
*Woodpecker training method adapted for digital practice*
