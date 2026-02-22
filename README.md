# Lichess Woodpecker 🐦

A powerful Chrome extension for Lichess puzzle training with Woodpecker-style repetition practice. Save puzzles into categories, train them in randomized order, and track your performance with detailed statistics.

## ✨ Features

### 🎯 Puzzle Management
- **One-click save** — Save any Lichess training puzzle to custom categories
- **Smart categories** — Create, rename, and delete unlimited categories
- **Duplicate prevention** — Never save the same puzzle twice
- **Quick actions** — Open, copy, or remove puzzles with one click
- **Global search** — Find puzzles instantly across all categories

### 🏋️ Woodpecker Training Mode
- **Randomized practice** — Train puzzles in shuffled order for effective learning
- **Session tracking** — Real-time timer and progress monitoring
- **Smart navigation** — Skip difficult puzzles or advance after solving
- **Cycle management** — Automatic reshuffling when all puzzles are completed
- **Train All** — Practice across all categories simultaneously

### 📊 Performance Analytics
- **Solved vs Skipped** — Track which puzzles you solved vs skipped
- **Success rates** — Color-coded performance indicators (green/yellow/red)
- **Time tracking** — Monitor completion time for each training cycle
- **Historical data** — View performance trends across categories
- **Statistics table** — Comprehensive breakdown in the options page

### 🎨 User Experience
- **Dark theme** — Easy on the eyes during long training sessions
- **Responsive overlay** — Non-intrusive training interface
- **Quick save dropdown** — Save puzzles without leaving the training page
- **Minimizable interface** — Focus on puzzles, not the UI
- **Cross-browser** — Works on Chrome and Firefox

## 🚀 Quick Start

### Installation

#### Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `lichess-woodpecker` folder
5. The woodpecker icon appears in your toolbar

#### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` inside the `lichess-woodpecker` folder

### Basic Usage

1. **Save Puzzles**
   - Visit any Lichess training page (`https://lichess.org/training/{id}`)
   - Click the woodpecker icon
   - Select or create a category
   - Click "Save Puzzle"

2. **Start Training**
   - Open the extension popup
   - Click the lightning bolt icon next to any category
   - Or click "Train All" to practice across all categories
   - Use the overlay to track progress and navigate puzzles

3. **Track Performance**
   - Complete full training cycles
   - View statistics in the options page
   - Monitor your improvement over time

## 📖 Detailed Features

### Training Interface
- **Progress bar** — Visual indication of cycle completion
- **Timer display** — Track session duration
- **Cycle counter** — See how many rounds you've completed
- **Solved/Skipped stats** — Real-time performance metrics
- **Skip button** — Move past difficult puzzles (counts as skipped)
- **Auto-advance** — Automatically proceed after solving puzzles

### Statistics Dashboard
- **Category breakdown** — Performance by puzzle category
- **Time analysis** — How long each training cycle takes
- **Success rates** — Percentage of puzzles solved vs skipped
- **Completion dates** — When each training cycle was finished
- **Historical tracking** — Up to 50 recent training sessions

### Smart Features
- **URL validation** — Only works on official Lichess training pages
- **Duplicate detection** — Prevents saving the same puzzle twice
- **Session persistence** — Training survives page refreshes
- **Extension context handling** — Graceful error recovery
- **Storage optimization** — Limits statistics to prevent bloat

## 🛠️ Technical Details

### Permissions
- `storage` — Save puzzles and categories locally
- `activeTab` — Access current tab when you click the extension
- `scripting` — Extract puzzle IDs from page content
- `tabs` — Navigate to training pages

### Data Storage
All data is stored locally in your browser:
- Puzzle IDs and categories
- Training session state
- Performance statistics
- User preferences

**No data is sent to any server. Everything stays on your device.**

### Browser Compatibility
- ✅ Chrome (Manifest V3)
- ✅ Firefox (with polyfill)
- ✅ Edge (Chromium-based)

## 📁 Project Structure

```
lichess-woodpecker/
├── manifest.json           # Extension configuration
├── background.js           # Service worker for storage and messaging
├── content.js             # Training overlay and puzzle detection
├── popup.html/js/css      # Extension popup interface
├── options.html/js/css    # Full manager and statistics page
├── icons/                 # Extension icons (16/48/128px)
└── scripts/               # Build and packaging utilities
```

## 🔧 Development

### Building
```bash
# Package for Chrome Web Store
npm run package

# Or package directly with Node
node scripts/package.js

# Generate icons (development)
npm run generate-icons
```

The packaging script creates a ZIP file ready for Chrome Web Store submission in the `release/` directory with all necessary files included.

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
- **Email**: avendestawork@gmail.com
- **Privacy**: See [Privacy Policy](PRIVACY_POLICY.md)

---

**Made with ❤️ for chess improvement enthusiasts**  
*Woodpecker training method adapted for digital practice*
