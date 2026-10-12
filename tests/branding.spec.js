const { test, expect } = require("./fixtures");
const fs = require("fs");
const path = require("path");

// The logo (icons/logo.svg) is the one source for every brand image: the toolbar and store icons, the favicon, and the
// logo in the popup, the settings page and the training overlay. Its navy base disappears on a dark background, so
// everywhere it appears it sits on a light rounded tile.

const ROOT = path.join(__dirname, "..");
const SIZES = [16, 32, 48, 128];
const logoPaths = () => [...fs.readFileSync(path.join(ROOT, "icons", "logo.svg"), "utf8").matchAll(/\sd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());

// Decode a PNG in the browser (the test runner has no image library) and hand back its pixels.
async function pixelsOf(context, file) {
  const page = await context.newPage();
  const b64 = fs.readFileSync(path.join(ROOT, "icons", file)).toString("base64");
  const out = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, px: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
  }, b64);
  await page.close();
  return { ...out, at: (x, y) => out.px.slice((y * out.w + x) * 4, (y * out.w + x) * 4 + 4) };
}

test("the toolbar, store and favicon icons are the logo on a light rounded tile, at every size", async ({ context }) => {
  for (const size of SIZES) {
    const icon = await pixelsOf(context, `icon${size}.png`);
    expect([icon.w, icon.h], `icon${size}.png size`).toEqual([size, size]);
    expect(icon.at(0, 0)[3], `icon${size} corner is transparent (a rounded tile)`).toBeLessThan(40);
    const [r, g, b, a] = icon.at(Math.round(size * 0.5), Math.round(size * 0.06));
    expect(a, `icon${size} has its tile`).toBeGreaterThan(200);
    expect(Math.min(r, g, b), `icon${size} tile is light`).toBeGreaterThan(200);
    const colours = new Set();
    for (let i = 0; i < icon.px.length; i += 4) colours.add(`${icon.px[i] >> 5}${icon.px[i + 1] >> 5}${icon.px[i + 2] >> 5}${icon.px[i + 3] > 128}`);
    expect(colours.size, `icon${size} is more than a flat tile`).toBeGreaterThan(4);
    if (size >= 48) { // big enough to see the logo's own colours
      let red = 0, blue = 0, navy = 0;
      for (let i = 0; i < icon.px.length; i += 4) {
        const [pr, pg, pb, pa] = icon.px.slice(i, i + 4);
        if (pa > 200 && pr > 225 && pg < 110 && pb < 110) red++;
        if (pa > 200 && pb > 190 && pr < 90 && pg > 80) blue++;
        if (pa > 200 && pr < 30 && pg < 50 && pb < 90) navy++;
      }
      expect(red, `icon${size} shows the red crest`).toBeGreaterThan(10);
      expect(blue, `icon${size} shows the blue wing`).toBeGreaterThan(10);
      expect(navy, `icon${size} shows the navy body`).toBeGreaterThan(20);
    }
  }
});

test("both manifests use the same icon set, including 32px, and every file exists", async () => {
  const chrome = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const firefox = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest-firefox.json"), "utf8"));
  for (const set of [chrome.icons, chrome.action.default_icon, firefox.icons, firefox.browser_action.default_icon]) {
    expect(Object.keys(set).sort((a, b) => a - b)).toEqual(SIZES.map(String));
    for (const file of Object.values(set)) expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
  }
});

test("the popup and the settings page show the logo on its tile, loaded, where the hand-drawn mark used to be", async ({ context, extPage, extensionUrl }) => {
  const options = await context.newPage();
  await options.goto(extensionUrl("options.html"));
  for (const page of [extPage, options]) {
    await expect(page.locator("svg.logo")).toHaveCount(0); // the old drawn mark is gone
    const tile = page.locator(".logo-tile");
    const img = tile.locator("img");
    await expect(img).toBeVisible();
    expect(await img.getAttribute("src")).toMatch(/icons\/logo\.svg$/);
    expect(await img.evaluate((el) => el.complete && el.naturalWidth > 0), "the logo actually loads").toBe(true);
    expect(await img.getAttribute("alt")).toBe(""); // decorative: the title next to it carries the name
    const style = await tile.evaluate((el) => { const s = getComputedStyle(el); const m = s.backgroundColor.match(/\d+/g).map(Number); return { min: Math.min(...m.slice(0, 3)), radius: parseFloat(s.borderTopLeftRadius) }; });
    expect(style.min, "a light tile, so the navy base shows on the dark page").toBeGreaterThan(200);
    expect(style.radius).toBeGreaterThanOrEqual(5);
    const [t, title] = await Promise.all([tile.boundingBox(), page.locator("h1").boundingBox()]);
    expect(t.x + t.width, "the logo comes before the title").toBeLessThanOrEqual(title.x + 1);
    expect(t.height).toBeGreaterThanOrEqual(26);
  }
});

test("the settings page has a favicon made from the logo, in two sizes, and both load", async ({ context, extensionUrl }) => {
  const page = await context.newPage();
  await page.goto(extensionUrl("options.html"));
  const icons = await page.locator('link[rel="icon"]').evaluateAll((els) => els.map((el) => ({ href: el.getAttribute("href"), sizes: el.getAttribute("sizes"), type: el.getAttribute("type") })));
  expect(icons.map((i) => i.href)).toEqual(["icons/icon32.png", "icons/icon48.png"]);
  expect(icons.map((i) => i.sizes)).toEqual(["32x32", "48x48"]);
  for (const i of icons) {
    expect(i.type).toBe("image/png");
    const ok = await page.evaluate(async (href) => (await fetch(href)).ok, i.href);
    expect(ok, i.href).toBe(true);
  }
});
