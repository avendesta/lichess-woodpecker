/**
 * EXPERIMENT: Shift+F slams the board. The board rises, comes down hard with a thud, the screen shakes, a burst of dust is
 * thrown up and the pieces bounce, wobble and tilt before settling exactly where they were. To remove the feature, delete
 * this file and its line in the two manifests and the two package lists.
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
  let audio = null;
  let master = null; // one compressor all the thuds go through, so thuds on top of each other do not clip
  let current = null; // the slam that is playing: { animations, over }
  const clouds = []; // live dust clouds, oldest first

  const rand = (min, max) => min + Math.random() * (max - min);

  /** A synthesized thud: a low sine dropping in pitch, and a short low-passed burst of noise for the impact. Never throws. */
  function thud(impact) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) {
        audio = new AC();
        master = audio.createDynamicsCompressor();
        master.connect(audio.destination);
      }
      if (audio.state === "suspended") audio.resume();
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
    } catch (_) {
      // autoplay blocked, no audio device: the slam goes on without the sound
    }
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

  function slam() {
    const board = document.querySelector(".puzzle__board .cg-wrap") || document.querySelector(".cg-wrap");
    if (!board) return;

    // a press while the last slam is still playing restarts it at once, with a quicker wind-up: the old board, shake and
    // wobble are cancelled (two animations of the same property would not add up, they would replace each other); the old
    // dust is left to drift away. This comes before the board is measured, which must be at rest (not lifted and scaled).
    const repeat = !!current && !current.over;
    if (current) current.animations.forEach((a) => { try { a.cancel(); } catch (_) { /* already gone */ } });
    const rect = board.getBoundingClientRect();
    if (!rect.width || !rect.height) { current = null; return; }
    const impact = repeat ? REPEAT_IMPACT : IMPACT;
    const total = impact + SETTLE;
    const mine = { animations: [], over: false };
    current = mine;
    const play = (el, keyframes, options) => { mine.animations.push(el.animate(keyframes, options)); };
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

    // the screen: a short, damped shake of the page's main element (not html/body: the extension's overlay is fixed to those)
    const main = document.querySelector("main");
    if (main) {
      play(main, [
        { translate: "0 0", offset: 0 },
        { translate: "-8px 6px", offset: 0.1 },
        { translate: "7px -5px", offset: 0.22 },
        { translate: "-5px 4px", offset: 0.34 },
        { translate: "4px -3px", offset: 0.48 },
        { translate: "-2px 2px", offset: 0.64 },
        { translate: "1px -1px", offset: 0.8 },
        { translate: "0 0", offset: 1 },
      ], { duration: 520, delay: impact, easing: "ease-out" });
    }

    // the pieces: a bounce and a tilt that damp out, rippling outwards from the middle of the board.
    // A piece is placed by an inline `transform: translate(x, y)`, and the individual `rotate` property turns the piece about
    // the middle of its UNplaced box (the board's corner), swinging a far piece through hundreds of pixels. So each tilt comes
    // with the translation that puts the turning point back at the piece's own centre: (I - R(angle)) . (x, y).
    const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const half = Math.hypot(rect.width, rect.height) / 2;
    // (a piece chessground is sliding right now is left alone: the tilt is worked out from where it stands at this moment)
    for (const piece of board.querySelectorAll("cg-board piece:not(.ghost):not(.dragging):not(.anim):not(.fading)")) {
      const box = piece.getBoundingClientRect();
      const u = (box.width || 80) / 80; // the board's size, so a small board does not fly apart
      const away = Math.min(1, Math.hypot(box.left + box.width / 2 - centre.x, box.top + box.height / 2 - centre.y) / half);
      const m = new DOMMatrixReadOnly(getComputedStyle(piece).transform); // where chessground put it: (m.e, m.f)
      const sign = Math.random() < 0.5 ? -1 : 1;
      const lift = (10 + Math.random() * 9) * u;
      const tilt = 7 + Math.random() * 7;
      const pose = (degrees, up, offset) => {
        const r = (degrees * Math.PI) / 180;
        const dx = m.e - (m.e * Math.cos(r) - m.f * Math.sin(r));
        const dy = m.f - (m.e * Math.sin(r) + m.f * Math.cos(r));
        return { translate: `${dx.toFixed(2)}px ${(dy - up).toFixed(2)}px`, rotate: `${degrees.toFixed(2)}deg`, offset };
      };
      play(piece, [
        pose(0, 0, 0),
        pose(sign * tilt, lift, 0.22),
        pose(-sign * tilt * 0.65, -2 * u, 0.46),
        pose(sign * tilt * 0.3, lift * 0.28, 0.7),
        pose(0, 0, 1),
      ], { duration: 720, delay: impact + away * 150, easing: "ease-out" });
    }

    cloud = dust(rect, impact);
    thud(impact);
    } catch (_) {
      // anything unexpected (an odd computed transform, a Lichess change): stop what started, leave nothing, stay usable.
      // (Not through `finished`: asking a cancelled animation for it gives a new promise that never settles.)
      mine.animations.forEach((a) => { try { a.cancel(); } catch (__) { /* already gone */ } });
      if (cloud) { cloud.animations.forEach((a) => { try { a.cancel(); } catch (__) { /* already gone */ } }); cloud.box.remove(); }
      mine.over = true;
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

  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.code !== "KeyF" || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target;
    if (target && target.closest && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]"))) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    slam();
  }, true);
})();
