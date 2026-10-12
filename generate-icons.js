/**
 * Renders the extension's PNG icons from the logo, so every brand image comes from one file: icons/logo.svg.
 * Run: npm run generate-icons   (then commit the PNGs it writes)
 *
 * Writes icons/icon16.png, icon32.png, icon48.png and icon128.png: the toolbar, store and favicon icons.
 *
 * The logo's navy body disappears on a dark toolbar or tab strip, so each icon seats it on a light rounded tile
 * (the logo's own ivory) with transparent corners. The popup, the settings page and the training overlay use the same tile.
 *
 * It also rewrites the one line between the LOGO markers in content.js: the training overlay inlines the logo (ids prefixed),
 * because a file the page could load would have to be web-accessible and would let lichess.org detect the extension.
 *
 * Dev tooling only: it uses Playwright (already a devDependency) to rasterise the SVG, so nothing new ships.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const ROOT = __dirname;
const SIZES = [16, 32, 48, 128];

async function main() {
  // the logo is inlined (a page with no address cannot load a file), without the accessibility title that suits a standalone image
  const svg = fs.readFileSync(path.join(ROOT, "icons", "logo.svg"), "utf8")
    .replace(/<title[\s\S]*?<\/title>\s*/, "")
    .replace(/<desc[\s\S]*?<\/desc>\s*/, "")
    .replace(/\s(role|aria-labelledby)="[^"]*"/g, "")
    .replace("<svg ", '<svg style="height:78%;width:auto;display:block" aria-hidden="true" ');

  const browser = await chromium.launch();
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
        <div style="width:${size}px;height:${size}px;border-radius:22%;display:grid;place-items:center;overflow:hidden;
                    background:linear-gradient(180deg,#fffaf0 0%,#efece2 100%)">${svg}</div></body></html>`);
      const file = path.join(ROOT, "icons", `icon${size}.png`);
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      fs.writeFileSync(file, png);
      console.log(`Generated ${path.relative(ROOT, file)} (${png.length} bytes)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  inlineLogoIntoOverlay();
  console.log("Done!");
}

// icons/logo.svg as one string for content.js: no title/desc (it is decorative there), ids prefixed so they cannot clash
// with the page's own, comments and the whitespace between tags dropped.
function inlineLogoIntoOverlay() {
  const svg = fs.readFileSync(path.join(ROOT, "icons", "logo.svg"), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<title[\s\S]*?<\/title>/, "")
    .replace(/<desc[\s\S]*?<\/desc>/, "")
    .replace(/\s(role|aria-labelledby)="[^"]*"/g, "")
    .replace(/\bid="([^"]+)"/g, 'id="wpk-$1"')
    .replace(/url\(#([^)]+)\)/g, "url(#wpk-$1)")
    .replace("<svg ", '<svg aria-hidden="true" focusable="false" ')
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
  const file = path.join(ROOT, "content.js");
  const source = fs.readFileSync(file, "utf8");
  const block = /(\/\* LOGO:BEGIN \*\/\n)[\s\S]*?(\n\s*\/\* LOGO:END \*\/)/;
  if (!block.test(source)) throw new Error("content.js has no LOGO:BEGIN / LOGO:END markers");
  fs.writeFileSync(file, source.replace(block, (_, begin, end) => `${begin}  const LOGO_SVG = ${JSON.stringify(svg)};${end}`));
  console.log(`Inlined the logo into content.js (${svg.length} characters)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
