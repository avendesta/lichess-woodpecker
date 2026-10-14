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
const settled = (page) => page.waitForFunction(() => document.getAnimations().length === 0 && !document.querySelector("[data-wpk-slam-dust], [data-wpk-fist]"), null, { timeout: 8000 });
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
  const seen = (globalThis.__slamAudio = { contexts: 0, started: 0, compressors: 0, silenced: 0 });
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect(n) { return n; }, start() { seen.started++; }, stop(when) { if (when === undefined) seen.silenced++; }, gain: param(), frequency: param(), type: "", buffer: null });
  window.AudioContext = class { constructor() { seen.contexts++; ${broken ? 'throw new Error("blocked");' : ""} this.state = "running"; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume() { return Promise.resolve(); } createGain() { return node(); } createDynamicsCompressor() { seen.compressors++; return node(); } createOscillator() { return node(); } createBiquadFilter() { return node(); } createBufferSource() { return node(); }
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
    dust: document.querySelectorAll("[data-wpk-slam-dust] span").length,
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

const delays = (page) => page.evaluate(() => ({
  boardAnims: document.querySelector(".cg-wrap").getAnimations().length,
  mainAnims: document.querySelector("main").getAnimations().length,
  mainDelay: document.querySelector("main").getAnimations()[0]?.effect.getTiming().delay,
  boardElapsed: document.querySelector(".cg-wrap").getAnimations()[0]?.currentTime,
  pieces: [...document.querySelectorAll("cg-board piece")].map((p) => p.getAnimations().length),
  clouds: document.querySelectorAll("[data-wpk-slam-dust]").length,
}));

test("pressing it again while it plays slams again at once, with a quicker wind-up, instead of waiting or doubling up", async ({ context }) => {
  const page = await slamPage(context);
  await page.keyboard.press("Shift+F");
  const first = await delays(page);
  expect(first.mainDelay, "the first slam keeps its full wind-up").toBe(300);
  await page.waitForTimeout(150);
  await page.keyboard.press("Shift+F");
  const second = await delays(page);
  expect(second.boardAnims, "one board animation, not two").toBe(1);
  expect(second.mainAnims, "one shake, not two").toBe(1);
  expect(second.pieces.every((n) => n === 1), `one wobble per piece: ${second.pieces}`).toBe(true);
  expect(second.boardElapsed, "it started afresh, at once").toBeLessThan(80);
  expect(second.mainDelay, "a quick wind-up on a repeat").toBeLessThanOrEqual(150);
  expect(second.clouds, "the first cloud is still fading, the second is thrown up").toBe(2);
  await settled(page);
});

test("mashing Shift+F: every press slams, nothing piles up, and the board ends exactly where it began", async ({ context }) => {
  const page = await slamPage(context);
  const before = await snapshot(page);
  let worstClouds = 0;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Shift+F");
    const d = await delays(page);
    expect(d.boardAnims, `press ${i + 1}: one board animation`).toBe(1);
    expect(d.pieces.every((n) => n === 1), `press ${i + 1}: one wobble per piece`).toBe(true);
    expect(d.boardElapsed, `press ${i + 1}: started at once`).toBeLessThan(80);
    worstClouds = Math.max(worstClouds, d.clouds);
    await page.waitForTimeout(70);
  }
  expect(worstClouds, "at most three dust clouds alive at once").toBeLessThanOrEqual(3);
  await settled(page);
  expect(await snapshot(page), "everything back exactly as it was").toEqual(before);
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
  expect(await page.locator("[data-wpk-slam-dust]").count()).toBe(0);
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
  await page.keyboard.press("Shift+F"); // a second press, straight away: its own thud
  expect(await world("globalThis.__slamAudio.started"), "each press has its own thud").toBeGreaterThanOrEqual(4);
  expect(await world("globalThis.__slamAudio.compressors"), "one shared compressor keeps stacked thuds from clipping").toBe(1);
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
  expect(await page.locator("[data-wpk-slam-dust]").count()).toBe(0);
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
  await expect(page.locator("[data-wpk-slam-dust]"), "no dust left after a cancel").toHaveCount(0, { timeout: 1000 });
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
  expect(await page.locator("[data-wpk-slam-dust]").count()).toBe(0);
  await world("window.DOMMatrixReadOnly = globalThis.__real; 1");
  await page.keyboard.press("Shift+F");
  expect(await slamming(page), "usable again").toBeGreaterThan(0);
  await settled(page);
});

test("a repeat slam measures the board at rest, so its dust starts at the board's real sides, not at the swollen, lifted ones", async ({ context }) => {
  const page = await slamPage(context);
  const rest = await page.evaluate(() => { const r = document.querySelector(".cg-wrap").getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
  await page.keyboard.press("Shift+F");
  // freeze the board at the top of its wind-up (scaled up 6.5%): its box is clearly wider than the resting one
  await page.evaluate(() => document.querySelector(".cg-wrap").getAnimations().forEach((a) => { a.pause(); a.currentTime = 200; }));
  const lifted = await page.evaluate(() => document.querySelector(".cg-wrap").getBoundingClientRect().width);
  expect(lifted - rest.width, "the board really is swollen when the second press arrives").toBeGreaterThan(20);
  await page.keyboard.press("Shift+F");
  // the newest cloud: from the tenth puff on they sit on the board's sides (centre x = left + 4 or right - 4)
  const centres = await page.evaluate(() => {
    const clouds = [...document.querySelectorAll("[data-wpk-slam-dust]")];
    return [...clouds[clouds.length - 1].querySelectorAll("span")].slice(9).map((s) => parseFloat(s.style.left) + parseFloat(s.style.width) / 2);
  });
  expect(centres.length).toBeGreaterThan(3);
  for (const x of centres) {
    const off = Math.min(Math.abs(x - (rest.left + 4)), Math.abs(x - (rest.right - 4)));
    expect(off, `a side puff starts ${off.toFixed(1)}px from the resting side`).toBeLessThan(1.5);
  }
  await settled(page);
});

// ---- The second animation: Shift+H, a giant fist hits the board; pieces tilt, hop or topple sideways (with a click), then stand back up ----

const fistTiming = (page) => page.evaluate(() => ({
  boardAnims: document.querySelector(".cg-wrap").getAnimations().length,
  mainAnims: document.querySelector("main").getAnimations().length,
  pieces: [...document.querySelectorAll("cg-board piece")].map((p) => p.getAnimations().length),
  fists: document.querySelectorAll("[data-wpk-fist]").length,
  dust: document.querySelectorAll("[data-wpk-slam-dust]").length,
  boardElapsed: document.querySelector(".cg-wrap").getAnimations()[0]?.currentTime,
  mainDelay: document.querySelector("main").getAnimations()[0]?.effect.getTiming().delay,
}));
// what each piece does: the largest turn in its animation
const turns = (page) => page.evaluate(() => [...document.querySelectorAll("cg-board piece")].map((p) => Math.max(0, ...p.getAnimations().flatMap((a) => a.effect.getKeyframes().map((k) => Math.abs(parseFloat(k.rotate) || 0))))));

test("Shift+H: a fist lands on the dimmed board, the table shakes, and when it is over everything is exactly as it was", async ({ context }) => {
  const page = await slamPage(context);
  const before = await snapshot(page);
  await page.keyboard.press("Shift+H");
  const d = await fistTiming(page);
  expect(d.fists, "one fist scene").toBe(1);
  expect(d.dust, "this is the fist, not the thud slam: no dust cloud").toBe(0);
  expect(d.boardAnims).toBe(1);
  expect(d.mainAnims, "the screen shakes").toBe(1);
  expect(d.pieces.every((n) => n === 1), `every piece reacts: ${d.pieces}`).toBe(true);
  const scene = await page.evaluate(() => {
    const box = document.querySelector("[data-wpk-fist]");
    const hand = box.querySelector("[data-wpk-fist-hand]");
    const board = document.querySelector(".cg-wrap").getBoundingClientRect();
    return {
      svg: !!hand.querySelector("svg"), paths: hand.querySelectorAll("svg path").length, text: hand.textContent,
      events: getComputedStyle(box).pointerEvents, hidden: box.getAttribute("aria-hidden"), position: getComputedStyle(box).position,
      big: hand.getBoundingClientRect().width, boardWidth: board.width,
      hasDim: !!box.querySelector("[data-wpk-fist-dim]"), hasShadow: !!box.querySelector("[data-wpk-fist-shadow]"), dust: box.querySelectorAll("[data-wpk-fist-dust]").length,
    };
  });
  expect(scene.svg, "a drawn fist (there is no emoji for it)").toBe(true);
  expect(scene.paths, "with its fingers and thumb").toBeGreaterThanOrEqual(6);
  expect(scene.text, "no emoji glyph").toBe("");
  expect(scene.events, "never takes a click").toBe("none");
  expect(scene.hidden).toBe("true");
  expect(scene.position).toBe("fixed");
  expect(scene.big, "a big fist").toBeGreaterThan(scene.boardWidth * 0.4);
  expect(scene.hasDim, "the board is dimmed under it").toBe(true);
  expect(scene.hasShadow, "it casts a shadow on the board").toBe(true);
  expect(scene.dust, "and the hit throws up dust").toBeGreaterThanOrEqual(12);
  await settled(page);
  await expect(page.locator("[data-wpk-fist]")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test("the pieces answer the fist in three ways: most tilt, some hop, some topple onto their side (the click is a silent placeholder for now)", async ({ context }) => {
  const page = await slamPage(context);
  const world = await inExtensionWorld(context, page);
  await world(STUB_AUDIO(false));
  await page.keyboard.press("Shift+H");
  const t = await turns(page);
  const toppled = t.filter((d) => d >= 70).length;
  const tilted = t.filter((d) => d >= 8 && d < 70).length;
  const hopped = t.filter((d) => d < 8).length;
  expect(toppled, `some topple (${t.map((d) => Math.round(d))})`).toBeGreaterThanOrEqual(1);
  expect(toppled, "but not all of them").toBeLessThan(t.length / 2);
  expect(tilted, "most only tilt").toBeGreaterThan(toppled);
  expect(hopped, "a few just hop").toBeGreaterThanOrEqual(1);
  expect(toppled + tilted + hopped).toBe(t.length);
  // only the thud of the hit (a tone and a noise burst): the click of a falling piece is a placeholder for now, silent
  expect(await world("globalThis.__slamAudio.started"), "no click sound yet, just the thud").toBe(2);
  expect(await world("globalThis.__slamAudio.contexts")).toBe(1);
  await settled(page);
});

test("while the pieces tilt and topple they stay about their own squares (a fallen piece lies well within a square of where it stood), then they all stand back up", async ({ context }) => {
  const page = await slamPage(context);
  const before = await centres(page);
  await page.keyboard.press("Shift+H");
  await page.evaluate(() => { for (const a of document.getAnimations()) if (!a.effect.target.matches("cg-board piece")) a.cancel(); window.__pieceAnims = document.getAnimations(); }); // kept: an animation paused past its end is no longer listed by getAnimations()
  let worst = 0;
  const total = await page.evaluate(() => Math.max(...window.__pieceAnims.map((a) => a.effect.getComputedTiming().endTime)));
  for (let t = 300; t < total; t += 90) {
    await page.evaluate((ms) => window.__pieceAnims.forEach((a) => { a.pause(); a.currentTime = ms; }), t);
    const now = await centres(page);
    for (let i = 0; i < now.length; i++) worst = Math.max(worst, Math.hypot(now[i][0] - before[i][0], now[i][1] - before[i][1]));
  }
  expect(worst, `the furthest a piece strays: ${worst.toFixed(1)}px (a square is 80px)`).toBeLessThan(60);
  expect(worst, "and they really do move").toBeGreaterThan(12);
  await page.evaluate(() => window.__pieceAnims.forEach((a) => { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime; }));
  const end = await centres(page);
  for (let i = 0; i < end.length; i++) expect(Math.hypot(end[i][0] - before[i][0], end[i][1] - before[i][1]), `piece ${i} is back on its square`).toBeLessThan(0.6);
  await page.evaluate(() => window.__pieceAnims.forEach((a) => a.cancel()));
  await settled(page);
});

test("Shift+H is its own key: Shift+F is still the thud slam, plain H and modified or typed H do nothing, and the two never run together", async ({ context }) => {
  const page = await slamPage(context, boardPage('<input id="chat" type="text">'));
  for (const key of ["h", "H", "Control+Shift+H", "Alt+Shift+H", "Meta+Shift+H"]) {
    await page.keyboard.press(key);
    expect(await slamming(page), `${key} does nothing`).toBe(0);
  }
  await page.focus("#chat");
  await page.keyboard.press("Shift+H");
  expect(await slamming(page), "typing a capital H does nothing").toBe(0);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+F");
  expect((await fistTiming(page)).fists, "Shift+F does not summon the fist").toBe(0);
  expect((await fistTiming(page)).dust, "Shift+F is the dust slam").toBe(1);
  await page.keyboard.press("Shift+H"); // switching style mid-slam: the old one is cancelled, one animation per target
  const d = await fistTiming(page);
  expect(d.boardAnims).toBe(1);
  expect(d.mainAnims).toBe(1);
  expect(d.pieces.every((n) => n === 1), `no doubled animations: ${d.pieces}`).toBe(true);
  expect(d.fists).toBe(1);
  await page.keyboard.press("Shift+F");
  const e = await fistTiming(page);
  expect(e.fists, "the fist is taken away at once when the other slam starts").toBe(0);
  expect(e.pieces.every((n) => n === 1)).toBe(true);
  await settled(page);
});

test("mashing Shift+H: each press brings a fresh fist at once, only one scene at a time, and the board ends where it began", async ({ context }) => {
  const page = await slamPage(context);
  const before = await snapshot(page);
  await page.keyboard.press("Shift+H");
  expect((await fistTiming(page)).mainDelay, "the first press has the full wind-up").toBeGreaterThanOrEqual(300);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(90);
    await page.keyboard.press("Shift+H");
    const d = await fistTiming(page);
    expect(d.fists, `press ${i + 2}: one fist scene`).toBe(1);
    expect(d.boardAnims).toBe(1);
    expect(d.pieces.every((n) => n === 1), `press ${i + 2}: one reaction per piece`).toBe(true);
    expect(d.boardElapsed, "started at once").toBeLessThan(80);
    expect(d.mainDelay, "a quicker wind-up on a repeat").toBeLessThanOrEqual(200);
  }
  await settled(page);
  expect(await snapshot(page)).toEqual(before);
});

test("the fist animates only translate, rotate, scale and opacity, and does nothing with reduced motion, no board, or no audio", async ({ context }) => {
  const page = await slamPage(context);
  await page.keyboard.press("Shift+H");
  const props = await page.evaluate(() => [...new Set(document.getAnimations().flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k))))].filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)));
  expect(props.filter((p) => !["translate", "rotate", "scale", "opacity"].includes(p)), `animated: ${props}`).toEqual([]);
  await settled(page);

  const calm = await slamPage(context);
  await calm.emulateMedia({ reducedMotion: "reduce" });
  await calm.keyboard.press("Shift+H");
  await calm.waitForTimeout(300);
  expect(await slamming(calm), "reduced motion: nothing").toBe(0);
  expect(await calm.locator("[data-wpk-fist]").count()).toBe(0);

  const world = await inExtensionWorld(context, page);
  await world(STUB_AUDIO(true)); // an AudioContext that throws
  await page.keyboard.press("Shift+H");
  expect((await fistTiming(page)).fists, "still plays, silently").toBe(1);
  await settled(page);
});

test("restarting the fist silences what the cancelled one had scheduled: the thud of a hit that never lands", async ({ context }) => {
  const page = await slamPage(context);
  const world = await inExtensionWorld(context, page);
  await world(STUB_AUDIO(false));
  await page.keyboard.press("Shift+H");
  const first = await world("globalThis.__slamAudio.started");
  expect(first, "the first press scheduled the thud (a tone and a noise burst)").toBe(2);
  expect(await world("globalThis.__slamAudio.silenced")).toBe(0);
  await page.waitForTimeout(60);
  await page.keyboard.press("Shift+H");
  expect(await world("globalThis.__slamAudio.silenced"), "every source of the first press was stopped").toBe(first);
  await settled(page);
});

test("the fist comes down from above to the middle of the board, its shadow tightens as it touches, and the dust bursts at the hit", async ({ context }) => {
  const page = await slamPage(context);
  await page.keyboard.press("Shift+H");
  const at = (ms) => page.evaluate((t) => {
    window.__fistAnims = window.__fistAnims || document.getAnimations();
    window.__fistAnims.forEach((a) => { a.pause(); a.currentTime = t; });
    const b = document.querySelector(".cg-wrap").getBoundingClientRect();
    const h = document.querySelector("[data-wpk-fist-hand]").getBoundingClientRect();
    const sh = document.querySelector("[data-wpk-fist-shadow]");
    const dust = [...document.querySelectorAll("[data-wpk-fist-dust]")].map((e) => Number(getComputedStyle(e).opacity));
    return { handBottom: h.bottom, handCentreY: h.top + h.height / 2, handCentreX: h.left + h.width / 2, boardTop: b.top, boardCentreX: b.left + b.width / 2, boardCentreY: b.top + b.height / 2, shadow: Number(getComputedStyle(sh).opacity), dust: Math.max(...dust), dustSeen: dust.filter((o) => o > 0.1).length };
  }, ms);
  const start = await at(0);
  expect(start.handBottom, "it starts above the board").toBeLessThan(start.boardTop);
  expect(start.shadow, "no shadow while it is high").toBeLessThan(0.05);
  expect(start.dust, "no dust yet").toBe(0);
  const near = await at(250);
  expect(near.handCentreY, "on its way down").toBeGreaterThan(start.handCentreY);
  expect(near.handCentreY, "not there yet").toBeLessThan(near.boardCentreY - 20);
  expect(near.shadow, "the shadow is appearing as it nears").toBeGreaterThan(start.shadow);
  const hit = await at(380);
  expect(Math.abs(hit.handCentreX - hit.boardCentreX), "it lands in the middle (across)").toBeLessThan(6);
  expect(Math.abs(hit.handCentreY - hit.boardCentreY), "and in the middle (down)").toBeLessThan(10);
  expect(hit.shadow, "the shadow is at its darkest as it touches").toBeGreaterThan(0.5);
  expect(hit.shadow).toBeGreaterThan(near.shadow);
  const after = await at(560);
  expect(after.dustSeen, "dust is thrown up after the hit").toBeGreaterThanOrEqual(10);
  const gone = await at(1400);
  expect(gone.handCentreY, "then the fist lifts away").toBeLessThan(hit.boardCentreY - 100);
  await page.evaluate(() => window.__fistAnims.forEach((a) => a.cancel()));
  await settled(page);
});

test("the fist survives a failure part-way through: it stops cleanly and the next Shift+H works", async ({ context }) => {
  const page = await slamPage(context);
  const world = await inExtensionWorld(context, page);
  await world("globalThis.__real = window.DOMMatrixReadOnly; window.DOMMatrixReadOnly = function () { throw new Error('boom'); }; 1");
  await page.keyboard.press("Shift+H");
  await expect.poll(() => slamming(page)).toBe(0);
  expect(await page.locator("[data-wpk-fist]").count(), "no fist left behind").toBe(0);
  await world("window.DOMMatrixReadOnly = globalThis.__real; 1");
  await page.keyboard.press("Shift+H");
  expect((await fistTiming(page)).fists).toBe(1);
  await settled(page);
});
