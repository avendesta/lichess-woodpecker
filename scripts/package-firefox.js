/**
 * Firefox Add-on packaging script.
 * Uses Node's built-in child_process to call system ZIP for better compatibility.
 * Usage: node scripts/package-firefox.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");

// Files and directories to include in the ZIP (relative to repo root).
const INCLUDE = [
  "manifest-firefox.json",
  "background.js",
  "browser-polyfill.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "shared.js",
  "options.html",
  "options.css",
  "options.js",
  "content.js",
  "slam.js",
  "content.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/logo.svg",
];

function main() {
  // Read version from manifest.json
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const version = manifest.version;
  if (!version) {
    console.error("ERROR: No version found in manifest.json");
    process.exit(1);
  }

  console.log(`Packaging Lichess Woodpecker v${version} for Firefox...\n`);

  // Validate all included files exist
  const missing = INCLUDE.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length > 0) {
    console.error("ERROR: Missing files:");
    missing.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  // Prepare release directory
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const zipName = `lichess-woodpecker-v${version}.xpi`;
  const zipPath = path.join(RELEASE_DIR, zipName);

  // Stage files with manifest-firefox.json renamed to manifest.json.
  // The staged dir (release/firefox) is also what `web-ext lint/run` targets.
  const stageDir = path.join(RELEASE_DIR, "firefox");
  fs.rmSync(stageDir, { recursive: true, force: true });
  INCLUDE.forEach((file) => {
    const destName = file === "manifest-firefox.json" ? "manifest.json" : file;
    const destPath = path.join(stageDir, destName);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), destPath);
  });

  fs.rmSync(zipPath, { force: true });
  try {
    if (process.platform === "win32") {
      const psScript = `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force`;
      execSync(`powershell -Command "${psScript}"`, { stdio: "inherit" });
    } else {
      execSync(`cd "${stageDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
    }
    const stats = fs.statSync(zipPath);
    console.log(`Files included (${INCLUDE.length}):`);
    INCLUDE.forEach((f) => console.log(`  ✓ ${f}`));
    console.log(`\nOutput: release/${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
    console.log("Staged dir: release/firefox (use with web-ext lint/run).");
  } catch (error) {
    console.error(`ZIP failed: ${error.message}\nZip release/firefox manually as .xpi.`);
    process.exit(1);
  }
}

main();
