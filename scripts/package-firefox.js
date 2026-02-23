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
  "options.html",
  "options.css",
  "options.js",
  "content.js",
  "content.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
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

  try {
    // Try using system zip command first (more reliable)
    if (process.platform === "win32") {
      // Windows: use PowerShell's Compress-Archive
      const fileList = INCLUDE.map(f => `"${path.join(ROOT, f)}"`).join(" ");
      const psScript = `
        $files = ${fileList}
        $zipPath = "${zipPath}"
        Compress-Archive -Path $files -DestinationPath $zipPath -Force
      `;
      execSync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    } else {
      // Unix-like systems: use zip command
      const fileList = INCLUDE.map(f => f).join(" ");
      execSync(`cd "${ROOT}" && zip -r "${zipPath}" ${fileList}`, { stdio: 'inherit' });
    }

    const stats = fs.statSync(zipPath);
    console.log(`Files included (${INCLUDE.length}):`);
    INCLUDE.forEach((f) => console.log(`  ✓ ${f}`));
    console.log(`\nOutput: release/${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
    console.log("Done! Upload this XPI to Firefox Add-ons or use for temporary installation.");

  } catch (error) {
    console.error("System ZIP failed, falling back to manual ZIP creation...");
    
    // Fallback: create a simple directory structure and let user ZIP manually
    const tempDir = path.join(RELEASE_DIR, `temp-${version}`);
    
    // Remove temp dir if exists
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Copy files to temp directory
    INCLUDE.forEach(file => {
      const srcPath = path.join(ROOT, file);
      let destPath = path.join(tempDir, file);
      
      // Rename manifest-firefox.json to manifest.json
      if (file === "manifest-firefox.json") {
        destPath = path.join(tempDir, "manifest.json");
      }
      
      // Create directory if needed
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      fs.copyFileSync(srcPath, destPath);
    });
    
    console.log(`\nFiles copied to: ${tempDir}`);
    console.log("Please manually ZIP this directory as .xpi and upload to Firefox.");
    console.log("Or install temporarily by loading the directory in Firefox about:debugging");
  }
}

main();
