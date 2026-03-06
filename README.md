# Lichess Woodpecker 🐦

NOW AVAILABLE IN [GOOGLE WEB STORE](https://chromewebstore.google.com/detail/lichess-woodpecker/hiplnejlfcaelegbajdonblkcechfced)

A powerful browser extension for Lichess puzzle training with Woodpecker-style repetition practice. Save puzzles into categories, train them in randomized order, and track your performance with detailed statistics.

## ✨ Features

### 🎯 Puzzle Management
- **Quick save** — Save any Lichess training puzzle to custom categories via popup plus buttons
- **Smart categories** — Create, rename, and delete unlimited categories in options page
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
- **Solved vs Skipped** — Track which puzzles you solved vs skipped during training
- **Success rates** — Color-coded performance indicators (green/yellow/red)
- **Time tracking** — Monitor completion time for each training cycle
- **Historical data** — View performance trends across categories
- **Statistics table** — Comprehensive breakdown with refresh functionality
- **Collapsible categories** — Organized view with default collapsed state

### 🎨 User Experience
- **Dark theme** — Easy on the eyes during long training sessions
- **Responsive overlay** — Non-intrusive training interface with minimize/close controls
- **Streamlined popup** — Focused on viewing and quick actions
- **Direct session control** — Close button immediately ends training session
- **Cross-browser** — Works on Chrome (Manifest V3) and Firefox (Manifest V2)

## 🚀 Quick Start

### Installation

#### Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `lichess-woodpecker` folder
5. The woodpecker icon appears in your toolbar

#### Firefox
1. Download the `lichess-woodpecker-v1.1.0.xpi` file from the release directory
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…**
4. Select the `.xpi` file

### Basic Usage

1. **Save Puzzles**
   - Visit any Lichess training page (`https://lichess.org/training/`)
   - Click the woodpecker icon to open the popup
   - Click the **+** button next to any category to save the current puzzle
   - Or manage categories in the options page for bulk operations

2. **Start Training**
   - Open the extension popup
   - Click the lightning bolt icon next to any category
   - Or click the ⚡ "Train All" button to practice across all categories
   - Use the training overlay to track progress and navigate puzzles

3. **Manage & Track**
   - Open options page (⚙️ button) for full category management
   - View training statistics with refresh functionality
   - Use the settings button in training overlay for quick access

## 📖 Detailed Features

### Training Interface
- **Progress bar** — Visual indication of cycle completion
- **Timer display** — Track session duration with reset functionality
- **Cycle counter** — See how many rounds you've completed
- **Solved/Skipped stats** — Real-time performance metrics during training
- **Skip button** — Move past difficult puzzles (red, counts as skipped)
- **Settings button** — Quick access to options page during training
- **Direct close** — Close button immediately ends training session
- **Minimize/restore** — Collapse overlay to focus on puzzles

### Statistics Dashboard
- **Category breakdown** — Performance by puzzle category with collapsible view
- **Time analysis** — How long each training cycle takes
- **Success rates** — Percentage of puzzles solved vs skipped
- **Completion dates** — When each training cycle was finished
- **Historical tracking** — Recent training sessions with refresh button
- **Clear statistics** — Reset functionality for fresh start

### Smart Features
- **URL validation** — Only works on official Lichess training pages
- **Duplicate detection** — Prevents saving the same puzzle twice
- **Session persistence** — Training survives page refreshes
- **Extension context handling** — Graceful error recovery
- **Storage optimization** — Limits statistics to prevent bloat
- **Plus button saving** — Quick puzzle addition without popup forms

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
├── icons/                 # Extension icons (16/48/128px)
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

The packaging scripts create:
- `lichess-puzzle-saver-v1.1.0.zip` for Chrome Web Store
- `lichess-woodpecker-v1.1.0.xpi` for Firefox distribution

Both packages include all necessary files and are ready for submission to their respective stores.

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
