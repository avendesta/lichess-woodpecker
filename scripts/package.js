/**
 * Chrome Web Store packaging script.
 * Reads the version from manifest.json, copies only runtime files into a
 * staging directory, and produces a ZIP at ./release/lichess-puzzle-saver-v<version>.zip
 *
 * Usage: node scripts/package.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");

// Files and directories to include in the ZIP (relative to repo root).
// Only runtime assets needed by Chrome — no dev files, docs, or markdown.
const INCLUDE = [
  "manifest.json",
  "background.js",
  "browser-polyfill.js",
  "extract-puzzle.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively delete a directory. */
function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Ensure a directory exists. */
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Minimal ZIP creator using Node built-ins only.
 * Produces a valid ZIP file from an array of {relativePath, absolutePath} entries.
 */
function createZip(entries, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const data = fs.readFileSync(entry.absolutePath);
    const nameBuffer = Buffer.from(entry.relativePath, "utf8");
    const crc = crc32(data);
    const compressedData = zlib.deflateRawSync(data);

    // Local file header (30 bytes + name + compressed data)
    const local = Buffer.alloc(30 + nameBuffer.length + compressedData.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4);         // version needed
    local.writeUInt16LE(0, 6);          // flags
    local.writeUInt16LE(8, 8);          // compression: deflate
    local.writeUInt16LE(0, 10);         // mod time
    local.writeUInt16LE(0, 12);         // mod date
    local.writeUInt32LE(crc, 14);       // crc32
    local.writeUInt32LE(compressedData.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22);           // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26);     // name length
    local.writeUInt16LE(0, 28);                     // extra length
    nameBuffer.copy(local, 30);
    compressedData.copy(local, 30 + nameBuffer.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(8, 10);         // compression: deflate
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);       // crc32
    central.writeUInt32LE(compressedData.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24);           // uncompressed size
    central.writeUInt16LE(nameBuffer.length, 28);     // name length
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    nameBuffer.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirData = Buffer.concat(centralHeaders);
  const centralDirOffset = offset;

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);                    // signature
  eocd.writeUInt16LE(0, 4);                              // disk number
  eocd.writeUInt16LE(0, 6);                              // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);                  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);                 // total entries
  eocd.writeUInt32LE(centralDirData.length, 12);          // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);               // central dir offset
  eocd.writeUInt16LE(0, 20);                              // comment length

  const zipBuffer = Buffer.concat([...localHeaders, centralDirData, eocd]);
  fs.writeFileSync(outputPath, zipBuffer);
}

/** CRC32 implementation. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Read version from manifest.json
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const version = manifest.version;
  if (!version) {
    console.error("ERROR: No version found in manifest.json");
    process.exit(1);
  }

  console.log(`Packaging Lichess Puzzle Notes v${version}...\n`);

  // Validate all included files exist
  const missing = INCLUDE.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length > 0) {
    console.error("ERROR: Missing files:");
    missing.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  // Prepare release directory
  mkdirp(RELEASE_DIR);

  const zipName = `lichess-puzzle-saver-v${version}.zip`;
  const zipPath = path.join(RELEASE_DIR, zipName);

  // Build entries list
  const entries = INCLUDE.map((relativePath) => ({
    relativePath: relativePath.replace(/\\/g, "/"),
    absolutePath: path.join(ROOT, relativePath),
  }));

  // Create ZIP
  createZip(entries, zipPath);

  const stats = fs.statSync(zipPath);
  console.log(`Files included (${entries.length}):`);
  entries.forEach((e) => console.log(`  ✓ ${e.relativePath}`));
  console.log(`\nOutput: release/${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log("Done! Upload this ZIP to the Chrome Web Store.");
}

main();
