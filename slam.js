/**
 * EXPERIMENT: two ways to slam the board, each on its own key. Shift+F: the board rises, comes down hard with a thud, the
 * screen shakes, a burst of dust is thrown up and the pieces bounce, wobble and tilt before settling exactly where they were.
 * Shift+H: a giant fist hits the dimmed board, the table shakes, most pieces tilt, a few hop, some topple onto their side with
 * a click, then they all stand back up. To remove the feature, delete this file and its line in the two manifests and the two
 * package lists.
 *
 * A second content script, independent of the training overlay (content.js installs nothing on a page with no session of
 * ours, and this has to work on every puzzle page). Everything is the Web Animations API, so every effect cleans itself up
 * when it ends; only the individual `translate`, `rotate`, `scale` and `opacity` properties are animated, never `transform`,
 * because chessground places every piece with an inline `transform`. Nothing is read from the page but the board's geometry.
 * People who asked for reduced motion get nothing, not even the sound.
 */
(() => {
  "use strict";

  const IMPACT = 300; // ms into the first slam when the board hits: the shake, the dust, the wobble and the thud start here
  const REPEAT_IMPACT = 110; // a press while the last slam is still playing hits almost at once
  const SETTLE = 700; // ms from the impact until everything has come to rest
  const MAX_CLOUDS = 3; // dust clouds alive at once; mashing the key cannot grow the page
  const FIST_IMPACT = 380; // the same, for the fist
  const FIST_REPEAT_IMPACT = 120;
  let audio = null;
  let master = null; // one compressor all the sounds go through, so thuds and clicks on top of each other do not clip
  let current = null; // the slam that is playing: { animations, over, box }
  const sounds = []; // the audio sources scheduled by the slam that is playing, so a restart can silence them
  const clouds = []; // live dust clouds, oldest first

  const rand = (min, max) => min + Math.random() * (max - min);

  // The fist, seen from the palm side (there is no emoji for it): four curled fingers on the left, the thumb folded across on the
  // right, drawn in flat yellows. Static markup, parsed with DOMParser (never through the HTML parser of the page, and never built from page data).
  const FIST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 516 370" width="100%" height="100%" aria-hidden="true"><path fill="#E4B13F" d="M62 118C30 128 28 176 42 196C26 214 34 262 54 274C46 300 66 336 100 338C150 344 215 330 262 316C300 335 360 330 410 300C452 276 470 220 466 170C464 140 450 124 420 118C380 98 330 60 300 40C262 14 205 8 170 36C152 50 140 62 128 78C104 82 78 96 62 118Z"/><path fill="#D39E39" d="M205 120C230 112 262 120 290 92C268 150 262 198 292 224C250 226 236 262 244 300C222 304 190 292 180 262C196 250 204 220 200 190C198 160 200 136 205 120Z"/><path fill="#F0C84F" d="M82 100C50 104 38 138 44 158C48 176 66 186 92 184C140 182 196 176 222 160C240 148 236 122 214 114C180 104 120 94 82 100Z"/><path fill="#F0C84F" d="M70 156C44 160 40 196 46 214C52 232 76 240 100 238C150 236 208 228 236 212C252 200 246 172 224 166C184 156 112 150 70 156Z"/><path fill="#F0C84F" d="M70 214C46 220 44 252 52 268C60 284 86 292 112 290C160 288 214 280 240 266C256 254 248 228 226 222C186 214 114 208 70 214Z"/><path fill="#F0C84F" d="M92 268C72 272 66 300 76 316C86 330 112 336 136 334C176 330 218 322 238 310C248 300 242 282 226 278C196 270 130 262 92 268Z"/><path fill="#F0C84F" d="M300 64C332 90 372 114 410 128C446 134 466 150 468 180C470 226 452 270 410 298C372 322 322 330 286 316C250 312 238 280 244 252C250 224 282 214 304 214C330 214 340 190 330 160C322 134 292 120 282 96C276 82 286 68 300 64Z"/><path fill="#F4D25E" d="M168 40C196 14 252 14 288 40C300 50 312 60 322 70C294 62 262 56 238 66C212 78 196 96 176 98C146 100 134 76 142 62C148 54 158 48 168 40Z"/><path fill="#E4B13F" opacity=".55" d="M236 66C262 56 294 62 322 70C300 84 270 88 248 84C236 80 232 72 236 66Z"/><path fill="#FBE79A" opacity=".7" d="M178 66C196 50 224 44 250 48C226 54 202 66 190 84C182 82 174 76 178 66Z"/><path fill="none" stroke="#FBE79A" stroke-width="7" stroke-linecap="round" opacity=".75" d="M184 126C200 128 212 134 214 148M188 188C204 190 216 196 218 210M196 252C210 254 220 260 222 272"/><path fill="none" stroke="#D39E39" stroke-width="6" stroke-linecap="round" opacity=".8" d="M84 150C130 154 190 156 228 168M80 210C132 216 192 220 236 226M96 262C140 268 190 272 232 282"/></svg>';

  /** The one audio context and compressor, made on the first key press (a user gesture). Throws if there is no audio. */
  function graph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio) {
      audio = new AC();
      master = audio.createDynamicsCompressor();
      master.connect(audio.destination);
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  }

  /** A synthesized thud: a low sine dropping in pitch, and a short low-passed burst of noise for the impact. Never throws. */
  function thud(impact) {
    try {
      if (!graph()) return;
      const t = audio.currentTime + impact / 1000;

      const tone = audio.createOscillator();
      const toneGain = audio.createGain();
      tone.type = "sine";
      tone.frequency.setValueAtTime(140, t);
      tone.frequency.exponentialRampToValueAtTime(38, t + 0.3);
      toneGain.gain.setValueAtTime(0.0001, t);
      toneGain.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
      toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      tone.connect(toneGain).connect(master);
      tone.start(t);
      tone.stop(t + 0.4);
      sounds.push(tone);

      const length = Math.floor(audio.sampleRate * 0.14);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const noise = audio.createBufferSource();
      const lowpass = audio.createBiquadFilter();
      const noiseGain = audio.createGain();
      noise.buffer = buffer;
      lowpass.type = "lowpass";
      lowpass.frequency.value = 520;
      noiseGain.gain.value = 0.45;
      noise.connect(lowpass).connect(noiseGain).connect(master);
      noise.start(t);
      sounds.push(noise);
    } catch (_) {
      // autoplay blocked, no audio device: the slam goes on without the sound
    }
  }

  /**
   * PLACEHOLDER: the sound of a chess piece landing on its side, `delay` ms from now. The first attempt (a noise tick and a
   * blip) did not sound good, so it was taken out; the animation still calls this once per toppling piece (at most 8 a press),
   * so a better sound can be added here later without touching anything else. A sound added here must be pushed on `sounds`
   * (so a restart can silence it), go through `master`, and never throw.
   */
  function click(delay) { // eslint-disable-line no-unused-vars
    void delay;
  }

  /** A cloud of dust thrown up along the board's lower edges. Returns its animations. */
  function dust(rect, impact) {
    const box = document.createElement("div");
    box.setAttribute("data-wpk-slam-dust", "");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden";
    const animations = [];
    for (let i = 0; i < 16; i++) {
      const puff = document.createElement("span");
      const size = rand(38, 84);
      let x;
      let y;
      let dx;
      let dy;
      if (i < 9) { // along the bottom edge, drifting down and outwards
        x = rect.left + rand(0.04, 0.96) * rect.width;
        y = rect.bottom - 6;
        dx = (x - (rect.left + rect.width / 2)) * rand(0.1, 0.35);
        dy = rand(18, 46);
      } else { // up the lower half of the sides, drifting outwards
        const left = i % 2 === 0;
        x = left ? rect.left + 4 : rect.right - 4;
        y = rect.bottom - rand(0.02, 0.4) * rect.height;
        dx = (left ? -1 : 1) * rand(34, 90);
        dy = rand(-14, 16);
      }
      puff.style.cssText = `position:absolute;left:${(x - size / 2).toFixed(1)}px;top:${(y - size / 2).toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;border-radius:50%;background:radial-gradient(circle at 40% 40%,rgba(238,228,212,0.95),rgba(238,228,212,0) 70%);opacity:0`;
      box.appendChild(puff);
      animations.push(puff.animate([
        { translate: "0 0", scale: "0.3", opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.18 },
        { translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px`, scale: `${rand(1.6, 2.4).toFixed(2)}`, opacity: 0, offset: 1 },
      ], { duration: rand(650, 950), delay: impact + rand(0, 70), easing: "ease-out", fill: "both" }));
    }
    document.body.appendChild(box);
    return { box, animations };
  }

  /**
   * What every effect starts with. A press while the last one is still playing (of either kind) restarts at once, with a
   * quicker wind-up: the old board, shake, wobble and fist are cancelled (two animations of the same property would not add up,
   * they would replace each other), the old dust is left to drift away. This is done before the board is measured, which must
   * be at rest (not lifted and scaled). Returns null when there is nothing to animate.
   */
  function begin(first, quick) {
    const board = document.querySelector(".puzzle__board .cg-wrap") || document.querySelector(".cg-wrap");
    if (!board) return null;
    const repeat = !!current && !current.over;
    if (current) {
      current.animations.forEach((a) => { try { a.cancel(); } catch (_) { /* already gone */ } });
      if (current.box) current.box.remove();
    }
    // the sounds the cancelled slam had scheduled (a thud, the clicks of pieces that will now never fall) go with it
    for (const source of sounds.splice(0)) { try { source.stop(); } catch (_) { /* already finished */ } }
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) { current = null; return null; }
    const mine = { animations: [], over: false, box: null };
    current = mine;
    return {
      board, rect, mine,
      impact: repeat ? quick : first,
      play: (el, keyframes, options) => { mine.animations.push(el.animate(keyframes, options)); },
    };
  }

  /** Stop what a failed effect started and leave nothing behind. (Not through `finished`: after a cancel it never settles.) */
  function abandon(mine, cloud) {
    for (const source of sounds.splice(0)) { try { source.stop(); } catch (_) { /* already finished */ } }
    mine.animations.forEach((a) => { try { a.cancel(); } catch (_) { /* already gone */ } });
    if (mine.box) mine.box.remove();
    if (cloud) { cloud.animations.forEach((a) => { try { a.cancel(); } catch (_) { /* already gone */ } }); cloud.box.remove(); }
    mine.over = true;
  }

  /** The screen: a short, damped shake of the page's main element (not html/body: the extension's overlay is fixed to those). */
  function shakeScreen(play, impact, strength) {
    const main = document.querySelector("main");
    if (!main) return;
    const k = strength;
    const px = (x, y) => `${(x * k).toFixed(1)}px ${(y * k).toFixed(1)}px`;
    play(main, [
      { translate: "0 0", offset: 0 },
      { translate: px(-8, 6), offset: 0.1 },
      { translate: px(7, -5), offset: 0.22 },
      { translate: px(-5, 4), offset: 0.34 },
      { translate: px(4, -3), offset: 0.48 },
      { translate: px(-2, 2), offset: 0.64 },
      { translate: px(1, -1), offset: 0.8 },
      { translate: "0 0", offset: 1 },
    ], { duration: 520 + (k > 1 ? 120 : 0), delay: impact, easing: "ease-out" });
  }

  /**
   * A piece is placed by an inline `transform: translate(x, y)`, and the individual `rotate` property turns the piece about
   * the middle of its UNplaced box (the board's corner), swinging a far piece through hundreds of pixels. So each tilt comes
   * with the translation that puts the turning point back at the piece's own centre: (I - R(angle)) . (x, y), here with an
   * extra (dx, dy) on top. `m` is where chessground put the piece, read from its computed transform.
   */
  const placed = (m, degrees, dx, dy, offset) => {
    const r = (degrees * Math.PI) / 180;
    const cx = m.e - (m.e * Math.cos(r) - m.f * Math.sin(r));
    const cy = m.f - (m.e * Math.sin(r) + m.f * Math.cos(r));
    return { translate: `${(cx + dx).toFixed(2)}px ${(cy + dy).toFixed(2)}px`, rotate: `${degrees.toFixed(2)}deg`, offset };
  };
  /**
   * A path of poses [offset, degrees, dx, dy] as keyframes. `rotate` and `translate` are interpolated separately and in a straight
   * line, but the compensation in `placed` follows a circle as the angle grows, so a big turn between two keyframes would drag a
   * piece far from the board's corner along the chord (a 60 degree turn is 40px off for a piece 330px from the corner). Big
   * turns are cut into steps of at most 10 degrees.
   */
  const track = (m, poses) => {
    const frames = [];
    poses.forEach((to, i) => {
      if (i === 0) { frames.push(placed(m, to[1], to[2], to[3], to[0])); return; }
      const from = poses[i - 1];
      const steps = Math.max(1, Math.ceil(Math.abs(to[1] - from[1]) / 10));
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        frames.push(placed(m, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f, from[3] + (to[3] - from[3]) * f, from[0] + (to[0] - from[0]) * f));
      }
    });
    return frames;
  };
  /** The pieces that can move: not a ghost, not one being dragged, not one chessground is sliding right now (its tilt is worked out from where it stands at this moment). */
  const movablePieces = (board) => [...board.querySelectorAll("cg-board piece:not(.ghost):not(.dragging):not(.anim):not(.fading)")];

  /** Shift+F: the board rises, drops with a thud, the screen shakes, dust flies, the pieces bounce and wobble. */
  function slam() {
    const run = begin(IMPACT, REPEAT_IMPACT);
    if (!run) return;
    const { board, rect, mine, impact, play } = run;
    const total = impact + SETTLE;
    let cloud = null;
    try {
      // the board: rises and tips, comes down hard, squashes, and settles (keyframe offsets are in ms of the whole slam)
      const at = (ms) => ms / total;
      play(board, [
        { translate: "0 0", scale: "1", rotate: "0deg", offset: 0 },
        { translate: "0 -30px", scale: "1.065", rotate: "-1.2deg", offset: at(impact * 2 / 3), easing: "cubic-bezier(0.55, 0, 1, 0.45)" },
        { translate: "0 6px", scale: "0.97 0.95", rotate: "0.5deg", offset: at(impact), easing: "ease-out" },
        { translate: "0 -7px", scale: "1.012", rotate: "-0.25deg", offset: at(impact + 130) },
        { translate: "0 2px", scale: "0.994", rotate: "0.1deg", offset: at(impact + 280) },
        { translate: "0 0", scale: "1", rotate: "0deg", offset: 1 },
      ], { duration: total, easing: "ease-in-out" });

      shakeScreen(play, impact, 1);

      // the pieces: a bounce and a tilt that damp out, rippling outwards from the middle of the board
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const half = Math.hypot(rect.width, rect.height) / 2;
      for (const piece of movablePieces(board)) {
        const box = piece.getBoundingClientRect();
        const u = (box.width || 80) / 80; // the board's size, so a small board does not fly apart
        const away = Math.min(1, Math.hypot(box.left + box.width / 2 - centre.x, box.top + box.height / 2 - centre.y) / half);
        const m = new DOMMatrixReadOnly(getComputedStyle(piece).transform);
        const sign = Math.random() < 0.5 ? -1 : 1;
        const lift = (10 + Math.random() * 9) * u;
        const tilt = 7 + Math.random() * 7;
        play(piece, [
          placed(m, 0, 0, 0, 0),
          placed(m, sign * tilt, 0, -lift, 0.22),
          placed(m, -sign * tilt * 0.65, 0, 2 * u, 0.46),
          placed(m, sign * tilt * 0.3, 0, -lift * 0.28, 0.7),
          placed(m, 0, 0, 0, 1),
        ], { duration: 720, delay: impact + away * 150, easing: "ease-out" });
      }

      cloud = dust(rect, impact);
      thud(impact);
    } catch (_) {
      abandon(mine, cloud);
      return;
    }

    // the slam is over when its board, shake and wobble are; its dust is taken away when the dust is done. Both ask for
    // `finished` right now, before anything can cancel them.
    Promise.allSettled(mine.animations.map((a) => a.finished)).then(() => { mine.over = true; });
    clouds.push(cloud);
    Promise.allSettled(cloud.animations.map((a) => a.finished)).then(() => {
      cloud.box.remove();
      const i = clouds.indexOf(cloud);
      if (i >= 0) clouds.splice(i, 1);
    });
    while (clouds.length > MAX_CLOUDS) { // mashing the key: the oldest cloud goes at once
      const old = clouds.shift();
      old.animations.forEach((a) => { try { a.cancel(); } catch (_) { /* already gone */ } });
      old.box.remove();
    }
  }

  /** Shift+H: a giant fist hits the dimmed board; most pieces tilt, a few hop, some topple onto their side (a click each) and stand back up. */
  function fist() {
    const run = begin(FIST_IMPACT, FIST_REPEAT_IMPACT);
    if (!run) return;
    const { board, rect, mine, impact, play } = run;
    const total = impact + 1100;
    const at = (ms) => ms / total;
    try {
      // the scene: a dimmer over the board, the fist, its shadow on the board and the dust of the hit, in one fixed,
      // click-through, hidden-from-assistive-tech layer
      const box = document.createElement("div");
      box.setAttribute("data-wpk-fist", "");
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden";
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dim = document.createElement("span");
      dim.setAttribute("data-wpk-fist-dim", "");
      dim.style.cssText = `position:fixed;left:${rect.left.toFixed(1)}px;top:${rect.top.toFixed(1)}px;width:${rect.width.toFixed(1)}px;height:${rect.height.toFixed(1)}px;background:rgba(0,0,0,0.5);opacity:0`;
      const width = Math.round(rect.width * 0.62);
      const height = Math.round(width * 370 / 516);
      // the shadow on the board, under the fist: wide and faint while it is high, tight and dark as it touches
      const shadow = document.createElement("span");
      shadow.setAttribute("data-wpk-fist-shadow", "");
      const shadowW = Math.round(width * 0.8);
      const shadowH = Math.round(height * 0.16);
      shadow.style.cssText = `position:fixed;left:${(cx - shadowW / 2).toFixed(1)}px;top:${(cy + height * 0.42 - shadowH / 2).toFixed(1)}px;width:${shadowW}px;height:${shadowH}px;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,0.85),rgba(0,0,0,0) 70%);opacity:0`;
      const hand = document.createElement("span");
      hand.setAttribute("data-wpk-fist-hand", "");
      hand.style.cssText = `position:fixed;display:block;width:${width}px;height:${height}px;left:${(cx - width / 2).toFixed(1)}px;top:${(cy - height / 2).toFixed(1)}px;filter:drop-shadow(0 6px 5px rgba(0,0,0,0.35));opacity:0`;
      hand.appendChild(document.importNode(new DOMParser().parseFromString(FIST_SVG, "image/svg+xml").documentElement, true));
      box.append(dim, shadow, hand);
      // the dust of the hit: puffs thrown outwards from the fist's base along the board, in a flattened ring
      const puffs = [];
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2 + rand(-0.15, 0.15);
        const size = rand(40, 78);
        const reach = rand(width * 0.35, width * 0.62);
        const puff = document.createElement("span");
        puff.setAttribute("data-wpk-fist-dust", "");
        puff.style.cssText = `position:fixed;left:${(cx - size / 2).toFixed(1)}px;top:${(cy + height * 0.4 - size / 2).toFixed(1)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;border-radius:50%;background:radial-gradient(circle at 40% 40%,rgba(238,228,212,0.95),rgba(238,228,212,0) 70%);opacity:0`;
        box.appendChild(puff);
        puffs.push({ puff, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach * 0.38 });
      }
      mine.box = box; // before it is attached, so a failure to attach still gets cleaned up
      document.body.appendChild(box);

      play(dim, [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: at(impact * 0.7) },
        { opacity: 1, offset: at(impact + 650) },
        { opacity: 0, offset: 1 },
      ], { duration: total, easing: "linear" });
      // the fist comes down from above the board to its middle, accelerating, presses in a little, stays, and lifts away
      const fall = Math.round(rect.height * 0.8 + height / 2);
      play(hand, [
        { translate: `0 ${-fall}px`, scale: "1.12", opacity: 1, offset: 0, easing: "cubic-bezier(0.5, 0, 0.9, 0.55)" }, // accelerating down
        { translate: "0 0", scale: "1", opacity: 1, offset: at(impact), easing: "ease-out" },
        { translate: "0 7px", scale: "0.97", opacity: 1, offset: at(impact + 70) },
        { translate: "0 0", scale: "1", opacity: 1, offset: at(impact + 150) },
        { translate: "0 0", scale: "1", opacity: 1, offset: at(impact + 560) },
        { translate: `0 ${-Math.round(fall * 0.7)}px`, scale: "1.1", opacity: 0, offset: 1 },
      ], { duration: total, easing: "linear" }); // (easing is per keyframe: an easing on the whole animation would shift when the keyframes happen)
      play(shadow, [
        { scale: "1.9 1.6", opacity: 0, offset: 0, easing: "ease-in" },
        { scale: "1.5 1.3", opacity: 0.2, offset: at(impact * 0.6), easing: "ease-in" },
        { scale: "1", opacity: 0.7, offset: at(impact), easing: "ease-out" },
        { scale: "1.06", opacity: 0.55, offset: at(impact + 560), easing: "ease-in" },
        { scale: "1.7 1.5", opacity: 0, offset: 1 },
      ], { duration: total, easing: "linear" });
      for (const { puff, dx, dy } of puffs) {
        play(puff, [
          { translate: "0 0", scale: "0.3", opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.2 },
          { translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px`, scale: `${rand(1.5, 2.3).toFixed(2)}`, opacity: 0, offset: 1 },
        ], { duration: rand(650, 950), delay: impact + rand(0, 60), easing: "ease-out", fill: "both" });
      }

      // the table: a recoil and a harder shake of the board and the screen at the hit
      play(board, [
        { translate: "0 0", scale: "1", offset: 0 },
        { translate: "0 10px", scale: "0.985", offset: 0.08 },
        { translate: "-9px 6px", scale: "0.99", offset: 0.22 },
        { translate: "8px -5px", scale: "1", offset: 0.36 },
        { translate: "-5px 4px", offset: 0.5 },
        { translate: "3px -2px", offset: 0.68 },
        { translate: "0 0", scale: "1", offset: 1 },
      ], { duration: 650, delay: impact, easing: "ease-out" });
      shakeScreen(play, impact, 1.5);

      // the pieces: a fixed share of them in each way (not left to chance, so there is always something of each kind)
      const pieces = movablePieces(board);
      const order = pieces.map((_, i) => i).sort(() => Math.random() - 0.5);
      const toppling = new Set(order.slice(0, pieces.length >= 2 ? Math.max(1, Math.round(pieces.length * 0.3)) : 0));
      const hopping = new Set(order.slice(toppling.size, toppling.size + (pieces.length >= 4 ? Math.max(1, Math.round(pieces.length * 0.15)) : 0)));
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const half = Math.hypot(rect.width, rect.height) / 2;
      let clicks = 0;
      pieces.forEach((piece, index) => {
        const box = piece.getBoundingClientRect();
        const square = box.width || 80;
        const u = square / 80;
        const away = Math.min(1, Math.hypot(box.left + box.width / 2 - centre.x, box.top + box.height / 2 - centre.y) / half);
        const m = new DOMMatrixReadOnly(getComputedStyle(piece).transform);
        const sign = Math.random() < 0.5 ? -1 : 1;
        const lift = (10 + Math.random() * 9) * u;
        const delay = impact + away * 120 + Math.random() * 50;
        if (toppling.has(index)) {
          const duration = 1500;
          const angle = sign * (84 + Math.random() * 6);
          const side = sign * square * 0.32;
          const down = square * 0.2;
          play(piece, track(m, [
            [0, 0, 0, 0],
            [0.1, sign * 28, side * 0.15, -lift],
            [0.26, angle, side, down], // lands on its side
            [0.31, angle * 0.93, side * 1.04, down * 0.9], // a small bounce
            [0.37, angle, side, down],
            [0.74, angle, side, down], // lies there a moment
            [0.88, sign * 25, side * 0.3, -lift * 0.8], // and stands back up
            [1, 0, 0, 0],
          ]), { duration, delay, easing: "ease-out" });
          if (clicks++ < 8) click(delay + duration * 0.26);
        } else if (hopping.has(index)) {
          play(piece, track(m, [
            [0, 0, 0, 0],
            [0.12, sign * 3, 0, -lift * 1.2],
            [0.35, 0, 0, 2 * u],
            [0.55, sign * 1.5, 0, -lift * 0.3],
            [1, 0, 0, 0],
          ]), { duration: 700, delay, easing: "ease-out" });
        } else {
          const tilt = 12 + Math.random() * 13;
          play(piece, track(m, [
            [0, 0, 0, 0],
            [0.1, sign * tilt, 0, -lift * 0.6],
            [0.3, -sign * tilt * 0.6, 0, 3 * u],
            [0.55, sign * tilt * 0.25, 0, -lift * 0.2],
            [1, 0, 0, 0],
          ]), { duration: 900, delay, easing: "ease-out" });
        }
      });

      thud(impact);
    } catch (_) {
      abandon(mine, null);
      return;
    }
    Promise.allSettled(mine.animations.map((a) => a.finished)).then(() => {
      mine.over = true;
      if (mine.box) mine.box.remove();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.repeat || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const effect = e.code === "KeyF" ? slam : e.code === "KeyH" ? fist : null;
    if (!effect) return;
    const target = e.target;
    if (target && target.closest && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]"))) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    effect();
  }, true);
})();
