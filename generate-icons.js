/**
 * Simple PNG icon generator for the extension.
 * Creates minimal valid PNG files with a chess pawn design.
 * Run: node generate-icons.js
 *
 * Uses only Node.js built-ins (no dependencies).
 * Generates 16x16, 48x48, and 128x128 PNG icons.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function createPNG(width, height, fillFn) {
  // Build raw pixel data (RGBA)
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4); // filter byte + RGBA
    row[0] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fillFn(x, y, width, height);
      const offset = 1 + x * 4;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // IDAT chunk
  const idat = makeChunk("IDAT", compressed);

  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc ^ 0xffffffff;
}

// Draw a chess pawn icon
function drawPawn(x, y, w, h) {
  const bg = [26, 26, 46, 255]; // #1a1a2e
  const fg = [233, 69, 96, 255]; // #e94560

  const cx = w / 2;
  const cy = h / 2;
  const scale = w / 128;

  // Normalized coordinates relative to center
  const nx = (x - cx) / scale;
  const ny = (y - cy) / scale;

  // Rounded rectangle background
  const margin = 4 * scale;
  const radius = 16 * scale;
  if (x < margin || x >= w - margin || y < margin || y >= h - margin) {
    return [0, 0, 0, 0]; // transparent outside
  }

  // Check if inside rounded rect
  const inRect = isInRoundedRect(x, y, margin, margin, w - 2 * margin, h - 2 * margin, radius);
  if (!inRect) return [0, 0, 0, 0];

  // Draw pawn shape
  // Head (circle at top)
  const headR = 14;
  const headCy = -30;
  if (dist(nx, ny, 0, headCy) <= headR) {
    // Inner circle cutout
    if (dist(nx, ny, 0, headCy) <= 6) return bg;
    return fg;
  }

  // Neck
  if (Math.abs(nx) <= 10 && ny >= -22 && ny <= 2) {
    // Rounded top
    if (ny < -12 && dist(nx, ny, 0, -12) > 10) return bg;
    return fg;
  }

  // Body
  if (Math.abs(nx) <= 14 && ny >= 2 && ny <= 24) {
    return fg;
  }

  // Base top
  if (Math.abs(nx) <= 22 && ny >= 24 && ny <= 32) {
    return fg;
  }

  // Base bottom (ellipse)
  if (ny >= 28 && ny <= 38) {
    const ey = (ny - 33) / 5;
    const ex = nx / 22;
    if (ex * ex + ey * ey <= 1) return fg;
  }

  return bg;
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function isInRoundedRect(px, py, rx, ry, rw, rh, r) {
  // Check corners
  const corners = [
    [rx + r, ry + r],
    [rx + rw - r, ry + r],
    [rx + r, ry + rh - r],
    [rx + rw - r, ry + rh - r],
  ];
  if (px < rx + r && py < ry + r) return dist(px, py, corners[0][0], corners[0][1]) <= r;
  if (px > rx + rw - r && py < ry + r) return dist(px, py, corners[1][0], corners[1][1]) <= r;
  if (px < rx + r && py > ry + rh - r) return dist(px, py, corners[2][0], corners[2][1]) <= r;
  if (px > rx + rw - r && py > ry + rh - r) return dist(px, py, corners[3][0], corners[3][1]) <= r;
  return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
}

// Generate icons
const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, "icons");
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

sizes.forEach((size) => {
  const png = createPNG(size, size, drawPawn);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
});

console.log("Done!");
