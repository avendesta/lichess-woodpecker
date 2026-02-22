/**
 * Simple packaging script using Node.js built-in archiver.
 * Creates a standard ZIP file that works with Firefox.
 * Usage: node scripts/package-simple.js
 */

const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");

// Files to include
const INCLUDE = [
  "manifest.json",
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

  console.log(`Creating Firefox-compatible ZIP for Lichess Woodpecker v${version}...\n`);

  // Validate files exist
  const missing = INCLUDE.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length > 0) {
    console.error("ERROR: Missing files:");
    missing.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  // Ensure release directory exists
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const zipName = `lichess-woodpecker-v${version}.zip`;
  const zipPath = path.join(RELEASE_DIR, zipName);

  // Create output stream
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  output.on('close', () => {
    const stats = fs.statSync(zipPath);
    console.log(`Files included (${INCLUDE.length}):`);
    INCLUDE.forEach((f) => console.log(`  ✓ ${f}`));
    console.log(`\nOutput: release/${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
    console.log("Done! This ZIP should work with Firefox.");
  });

  archive.on('error', (err) => {
    throw err;
  });

  // Pipe archive data to the file
  archive.pipe(output);

  // Add files to archive
  INCLUDE.forEach(file => {
    const filePath = path.join(ROOT, file);
    archive.file(filePath, { name: file });
  });

  // Finalize the archive
  archive.finalize();
}

main();
