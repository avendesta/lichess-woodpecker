const { test, expect } = require("./fixtures");

// EXPERIMENT: Shift+F slams the board (slam.js). The page below has the markup of a live Lichess puzzle page (recorded with the
// Playwright MCP): main.puzzle > .puzzle__board > .cg-wrap > cg-container > cg-board, every piece placed by an inline
// transform, which is why the slam may only animate translate / rotate / scale and never touch `transform`.

const SQUARES = [["black", "rook", 0, 0], ["black", "king", 563.5, 0], ["black", "pawn", 0, 80.5], ["black", "pawn", 322, 80.5], ["white", "pawn", 241.5, 483], ["white", "knight", 402.5, 483], ["white", "rook", 0, 563.5], ["white", "king", 483, 563.5]];
const boardPage = (extra = "") => `<!doctype html><html><body style="background:#161512;margin:0"><div class="is2d"><main class="puzzle puzzle-play">
  <div class="puzzle__board main-board"><div class="cg-wrap cgv1 orientation-white manipulable" style="position:absolute;width:644px;height:644px"><cg-container style="width:644px;height:644px;position:absolute"><cg-board style="display:block;position:relative;width:100%;height:100%">
    <square class="last-move" style="transform: translate(483px, 402.5px);"></square>
    ${SQUARES.map(([c, r, x, y]) => `<piece class="${c} ${r}" style="position:absolute;top:0;left:0;width:80.5px;height:80.5px;transform: translate(${x}px, ${y}px);"></piece>`).join("")}
  </cg-board></cg-container></div></div>
  ${extra}
</main></div></body></html>`;

const serveBoard = (context, html = boardPage()) => context.route("https://lichess.org/training/*", (r) => r.fulfill({ contentType: "text/html", body: html }));
const slamPage = async (context, html) => {
  await serveBoard(context, html);
  const page = await context.newPage();
  await page.goto("https://lichess.org/training/slam1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("cg-board")).toBeAttached();
  return page;
};
const slamming = (page) => page.evaluate(() => document.getAnimations().length);
const settled = (page) => page.waitForFunction(() => document.getAnimations().length === 0 && !document.querySelector("#wpk-slam-dust"), null, { timeout: 8000 });
const centres = (page) => page.evaluate(() => [...document.querySelectorAll("cg-board piece")].map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
const snapshot = (page) => page.evaluate(() => ({
  styles: [...document.querySelectorAll("cg-board > *")].map((e) => e.getAttribute("style")),
  rects: [...document.querySelectorAll("cg-board piece")].map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10); }),
  wrap: document.querySelector(".cg-wrap").getAttribute("style"),
  main: document.querySelector("main").getAttribute("style"),
}));

// The extension's content scripts live in their own JavaScript world; this lets a test stub what slam.js sees there (AudioContext).
async function inExtensionWorld(context, page) {
  const cdp = await context.newCDPSession(page);
  const list = [];
  cdp.on("Runtime.executionContextCreated", (e) => list.push(e.context));
  cdp.on("Runtime.executionContextsCleared", () => { list.length = 0; });
  await cdp.send("Runtime.enable");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("cg-board")).toBeAttached();
  await expect.poll(() => list.some((w) => w.name === "Lichess Woodpecker")).toBe(true);
  const id = list.filter((w) => w.name === "Lichess Woodpecker").pop().id;
  return (expression) => cdp.send("Runtime.evaluate", { expression, contextId: id, returnByValue: true }).then((r) => r.result.value);
}
const STUB_AUDIO = (broken) => `(() => {
  const seen = (globalThis.__slamAudio = { contexts: 0, started: 0 });
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect(n) { return n; }, start() { seen.started++; }, stop() {}, gain: param(), frequency: param(), type: "", buffer: null });
  window.AudioContext = class { constructor() { seen.contexts++; ${broken ? 'throw new Error("blocked");' : ""} this.state = "running"; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() { return Promise.resolve(); } createGain() { return node(); } createOscillator() { return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
    createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; } };
})()`;

test("Shift+F slams the board: board, screen, pieces and dust all move, then everything is exactly as it was", async ({ context }) => {
  const page = await slamPage(context);
  const before = await snapshot(page);
  expect(await slamming(page)).toBe(0);
  await page.keyboard.press("Shift+F");

  // while it plays: the board, the page's main element, every piece and a dust cloud are animated
  const during = await page.evaluate(() => ({
    board: document.querySelector(".cg-wrap").getAnimations().length,
    main: document.querySelector("main").getAnimations().length,
    pieces: [...document.querySelectorAll("cg-board piece")].map((p) => p.getAnimations().length),
    ghostOrSquare: [...document.querySelectorAll("cg-board square")].map((p) => p.getAnimations().length),
    dust: document.querySelectorAll("#wpk-slam-dust span").length,
  }));
  expect(during.board, "the board is slammed").toBeGreaterThan(0);
  expect(during.main, "the screen shakes").toBeGreaterThan(0);
  expect(during.pieces.every((n) => n > 0), `every piece wobbles: ${during.pieces}`).toBe(true);
  expect(during.dust, "a burst of dust").toBeGreaterThanOrEqual(12);

  // ...and when it is over, nothing is left behind: no animation, no dust, no inline style, every piece on its square
  await settled(page);
  expect(await snapshot(page)).toEqual(before);
});

test("the slam animates only translate, rotate, scale and opacity: never transform, which chessground uses to place every piece", async ({ context }) => {
  const page = await slamPage(context);
  await page.keyboard.press("Shift+F");
  const props = await page.evaluate(() => [...new Set(document.getAnimations().flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k))))].filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)));
  expect(props.length).toBeGreaterThan(0);
  expect(props.filter((p) => !["translate", "rotate", "scale", "opacity"].includes(p)), `animated: ${props}`).toEqual([]);
  expect(props).not.toContain("transform");
  // a piece in the middle of the wobble still sits on its square (the inline transform is untouched)
  expect(await page.evaluate(() => [...document.querySelectorAll("cg-board piece")].map((p) => p.style.transform))).toEqual(SQUARES.map(([, , x, y]) => `translate(${x}px, ${y}px)`));
  await settled(page);
});

test("while they wobble the pieces stay at their squares: each one bounces and tilts about itself, it is never swung around the board", async ({ context }) => {
  const page = await slamPage(context);
  const before = await centres(page);
  await page.keyboard.press("Shift+F");
  // look at the pieces alone (the board and the screen have their own motion): freeze them at several moments of the wobble
  await page.evaluate(() => { for (const a of document.getAnimations()) if (!a.effect.target.matches("cg-board piece")) a.cancel(); });
  let worst = 0;
  for (const t of [330, 400, 480, 560, 640, 720, 800, 900]) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), t);
    const now = await centres(page);
    for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.hypot(now[i][0] - before[i][0], now[i][1] - before[i][1]));
  }
  expect(worst, `the furthest a piece strays from its square: ${worst.toFixed(1)}px (a piece is 80px wide)`).toBeLessThan(32);
  expect(worst, "and they really do move").toBeGreaterThan(5);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.cancel()));
  await settled(page);
});

test("only Shift+F does it: plain F, Ctrl/Alt/Meta+Shift+F, a held key and typing in a text box do nothing", async ({ context }) => {
  const page = await slamPage(context, boardPage('<input id="chat" type="text"><textarea id="note"></textarea><div id="ce" contenteditable="true">x</div>'));
  for (const key of ["f", "F", "Control+Shift+F", "Alt+Shift+F", "Meta+Shift+F", "Shift+G", "Shift"]) {
    await page.keyboard.press(key);
    expect(await slamming(page), `${key} does nothing`).toBe(0);
  }
  // a held key repeats keydown with repeat: true
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F", code: "KeyF", shiftKey: true, repeat: true, bubbles: true })));
  expect(await slamming(page), "a repeating key does nothing").toBe(0);
  // typing a capital F into a text field is typing, not a slam
  for (const sel of ["#chat", "#note", "#ce"]) {
    await page.focus(sel);
    await page.keyboard.press("Shift+F");
    expect(await slamming(page), `typing in ${sel} does nothing`).toBe(0);
  }
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "and the real key still works afterwards").toBeGreaterThan(0);
  await settled(page);
});

test("pressing it again while it plays does not stack the effect", async ({ context }) => {
  const page = await slamPage(context);
  await page.keyboard.press("Shift+F");
  const first = await slamming(page);
  await page.keyboard.press("Shift+F");
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "no extra animations").toBe(first);
  expect(await page.locator("#wpk-slam-dust").count(), "one dust cloud").toBe(1);
  await settled(page);
  await page.keyboard.press("Shift+F"); // and once it is over it works again
  expect(await slamming(page)).toBeGreaterThan(0);
  await settled(page);
});

test("people who asked for reduced motion get nothing: no motion and no sound", async ({ context }) => {
  const page = await slamPage(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const world = await inExtensionWorld(context, page);
  await world(STUB_AUDIO(false));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(300);
  expect(await slamming(page)).toBe(0);
  expect(await page.locator("#wpk-slam-dust").count()).toBe(0);
  expect(await world("globalThis.__slamAudio.contexts"), "no sound either").toBe(0);
});

test("the slam comes with a thud, and a blocked or missing audio API never stops the visuals", async ({ context }) => {
  const page = await slamPage(context);
  const world = await inExtensionWorld(context, page);
  await world(STUB_AUDIO(false));
  await page.keyboard.press("Shift+F");
  expect(await slamming(page)).toBeGreaterThan(0);
  expect(await world("globalThis.__slamAudio.contexts"), "one audio context").toBe(1);
  expect(await world("globalThis.__slamAudio.started"), "the thud (a low tone and a burst of noise)").toBeGreaterThanOrEqual(2);
  await settled(page);
  await page.keyboard.press("Shift+F");
  await settled(page);
  expect(await world("globalThis.__slamAudio.contexts"), "the audio context is reused").toBe(1);

  await world(STUB_AUDIO(true)); // an AudioContext that throws (autoplay blocked, no audio device)
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "still slams, silently").toBeGreaterThan(0);
  await settled(page);
});

test("with no board on the page (Lichess changed, or another puzzle page) it quietly does nothing", async ({ context }) => {
  await serveBoard(context, "<!doctype html><html><body><main class='puzzle'><p>no board here</p></main></body></html>");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("https://lichess.org/training/slam1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main p")).toBeAttached();
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(300);
  expect(await slamming(page)).toBe(0);
  expect(await page.locator("#wpk-slam-dust").count()).toBe(0);
  expect(errors).toEqual([]);
});

test("it works with no training session at all, and it leaves a showing overlay where it is", async ({ context, seedStorage }) => {
  // an unowned session shows the Resume chip: the overlay is on the page while the board slams
  await seedStorage({ lichessNotes: { categories: { Drill: ["slam1"] }, meta: { version: 1, updatedAt: 0 } }, trainingSession: { ownerTabId: null, category: "Drill", queue: ["https://lichess.org/training/slam1"], currentIndex: 0, completedInCycle: 0, totalPuzzles: 1, cycleCount: 1, timerStartedAt: Date.now() - 1000, isMinimized: false } });
  const page = await slamPage(context);
  const chip = page.locator("#lpn-woodpecker-overlay .wpk-resume");
  await expect(chip).toBeVisible({ timeout: 15_000 });
  const rect = () => page.locator("#lpn-woodpecker-overlay").boundingBox();
  const at = await rect();
  await page.keyboard.press("Shift+F");
  expect(await slamming(page)).toBeGreaterThan(0);
  await page.waitForTimeout(250); // mid-slam
  expect(await rect(), "the overlay does not shake with the page").toEqual(at);
  await settled(page);
  await expect(chip).toBeVisible();
});

test("slam.js asks for nothing new: no permission, the same page match, and it is packaged", async () => {
  const fs = require("fs");
  const path = require("path");
  const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
  for (const f of ["manifest.json", "manifest-firefox.json"]) {
    const m = read(f);
    expect(m.content_scripts.map((c) => c.matches), `${f}: same match`).toEqual([["https://lichess.org/training/*"]]);
    expect(m.content_scripts[0].js, `${f}: slam.js is a content script`).toContain("slam.js");
    expect(m.permissions.slice().sort(), `${f}: no new permission`).toEqual(["activeTab", "scripting", "storage"]);
  }
  const src = fs.readFileSync(path.join(__dirname, "..", "slam.js"), "utf8");
  expect(src, "no innerHTML").not.toMatch(/innerHTML/);
  expect(src, "no network").not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/);
  for (const f of ["scripts/package.js", "scripts/package-firefox.js"]) expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), `${f} ships slam.js`).toContain('"slam.js"');
});

test("a piece that chessground is sliding is left alone, and cancelling the slam takes the dust away at once", async ({ context }) => {
  const page = await slamPage(context);
  await page.evaluate(() => document.querySelector("cg-board piece").classList.add("anim"));
  await page.keyboard.press("Shift+F");
  const animated = await page.evaluate(() => [...document.querySelectorAll("cg-board piece")].map((p) => p.getAnimations().length > 0));
  expect(animated[0], "the sliding piece is not wobbled").toBe(false);
  expect(animated.slice(1).every(Boolean), "the others are").toBe(true);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.cancel()));
  await expect(page.locator("#wpk-slam-dust"), "no dust left after a cancel").toHaveCount(0, { timeout: 1000 });
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "and it can be used again straight away").toBeGreaterThan(0);
  await settled(page);
});

test("something unexpected inside a slam never leaves it stuck: it stops cleanly and the next Shift+F works", async ({ context }) => {
  const page = await slamPage(context);
  const world = await inExtensionWorld(context, page);
  // make a step of the slam throw part-way through (after the board and the screen were already set moving)
  await world("globalThis.__real = window.DOMMatrixReadOnly; window.DOMMatrixReadOnly = function () { throw new Error('boom'); }; 1");
  await page.keyboard.press("Shift+F");
  await expect.poll(() => slamming(page), { message: "everything that had started is stopped" }).toBe(0);
  expect(await page.locator("#wpk-slam-dust").count()).toBe(0);
  await world("window.DOMMatrixReadOnly = globalThis.__real; 1");
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "usable again").toBeGreaterThan(0);
  await settled(page);
});
