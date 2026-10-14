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

  // The fist, seen from the palm side (there is no emoji for it): the drawing supplied by the project owner (front_facing_fist.svg,
  // viewBox 436x340), reduced to its paths (no title, ids or ground shadow: the animation casts its own). Static markup, parsed
  // with DOMParser (never through the HTML parser of the page) and never built from page data.
  const FIST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 436 340" width="100%" height="100%" aria-hidden="true"><path d="M66.0,58.0 C63.2,61.8 59.1,69.0 58.0,75.0 C56.9,81.0 60.0,96.2 58.0,101.0 C56.0,105.8 47.1,106.8 44.0,109.0 C40.9,111.2 38.0,113.8 36.0,117.0 C34.0,120.2 30.8,127.2 30.0,132.0 C29.2,136.8 29.0,146.1 30.0,151.0 C31.0,155.9 34.2,163.2 37.0,167.0 C39.8,170.8 49.0,175.5 50.0,178.0 C51.0,180.5 46.0,181.6 44.0,185.0 C42.0,188.4 37.1,197.0 36.0,202.0 C34.9,207.0 35.0,215.8 36.0,221.0 C37.0,226.2 39.5,233.8 43.0,239.0 C46.5,244.2 58.9,254.1 61.0,258.0 C63.1,261.9 58.4,262.4 58.0,267.0 C57.6,271.6 57.4,286.1 58.0,291.0 C58.6,295.9 59.9,298.9 62.0,302.0 C64.1,305.1 70.2,310.9 73.0,313.0 C75.8,315.1 77.5,315.9 82.0,317.0 C86.5,318.1 87.9,319.3 105.0,321.0 C122.1,322.7 184.8,328.4 204.0,329.0 C223.2,329.6 227.2,327.8 242.0,325.0 C256.8,322.2 296.6,311.8 310.0,309.0 C323.4,306.2 328.9,305.4 338.0,305.0 C347.1,304.6 368.0,306.6 375.0,306.0 C382.0,305.4 385.5,302.4 388.0,301.0 C390.5,299.6 391.5,298.2 393.0,296.0 C394.5,293.8 397.3,289.3 399.0,285.0 C400.7,280.7 402.8,276.2 405.0,265.0 C407.2,253.8 413.6,220.1 415.0,205.0 C416.4,189.9 415.4,166.0 415.0,157.0 C414.6,148.0 413.3,144.8 412.0,141.0 C410.7,137.2 408.9,132.4 406.0,130.0 C403.1,127.6 397.2,125.4 391.0,124.0 C384.8,122.6 377.3,131.8 362.0,120.0 C346.7,108.2 295.4,52.5 282.0,40.0 C268.6,27.5 276.9,34.4 266.0,31.0 C255.1,27.6 215.8,17.8 204.0,16.0 C192.2,14.2 186.5,16.9 182.0,18.0 C177.5,19.1 176.2,19.8 172.0,24.0 C167.8,28.2 159.7,45.2 152.0,48.0 C144.3,50.8 125.7,44.6 117.0,44.0 C108.3,43.4 95.5,43.4 90.0,44.0 C84.5,44.6 81.4,46.0 78.0,48.0 C74.6,50.0 68.8,54.2 66.0,58.0 Z" fill="#d09e3f" fill-rule="evenodd"/><path d="M66.0,59.0 C63.8,62.8 59.0,72.3 58.0,78.0 C57.0,83.7 59.3,96.4 59.0,100.0 C58.7,103.6 58.1,102.7 56.0,104.0 C53.9,105.3 46.8,107.2 44.0,109.0 C41.2,110.8 37.8,114.2 36.0,117.0 C34.2,119.8 31.8,124.8 31.0,129.0 C30.2,133.2 29.3,142.1 30.0,147.0 C30.7,151.9 33.2,159.8 36.0,164.0 C38.8,168.2 49.7,172.1 50.0,177.0 C50.3,181.9 40.0,194.7 38.0,199.0 C36.0,203.3 36.0,204.4 36.0,208.0 C36.0,211.6 37.2,221.1 38.0,225.0 C38.8,228.9 38.8,231.5 42.0,236.0 C45.2,240.5 58.8,249.9 61.0,257.0 C63.2,264.1 57.7,280.8 58.0,287.0 C58.3,293.2 60.8,297.5 63.0,301.0 C65.2,304.5 71.8,310.2 74.0,312.0 C76.2,313.8 79.7,315.5 79.0,314.0 C78.3,312.5 70.3,303.2 69.0,301.0 C67.7,298.8 69.0,298.0 70.0,298.0 C71.0,298.0 72.6,300.6 76.0,301.0 C79.4,301.4 83.6,302.4 94.0,301.0 C104.4,299.6 140.6,293.2 150.0,291.0 C159.4,288.8 158.6,287.2 161.0,285.0 C163.4,282.8 166.2,278.4 167.0,275.0 C167.8,271.6 168.1,264.4 167.0,261.0 C165.9,257.6 161.2,252.8 159.0,251.0 C156.8,249.2 157.6,248.1 151.0,248.0 C144.4,247.9 118.2,250.0 112.0,250.0 C105.8,250.0 109.8,248.3 107.0,248.0 C104.2,247.7 94.4,248.3 92.0,248.0 C89.6,247.7 80.2,247.3 90.0,246.0 C99.8,244.7 150.0,241.4 162.0,239.0 C174.0,236.6 173.1,233.1 176.0,229.0 C178.9,224.9 182.6,214.8 183.0,210.0 C183.4,205.2 181.2,198.4 179.0,195.0 C176.8,191.6 176.7,187.8 167.0,186.0 C157.3,184.2 122.0,183.4 110.0,182.0 C98.0,180.6 85.2,177.1 81.0,176.0 C76.8,174.9 67.5,174.1 80.0,174.0 C92.5,173.9 156.4,175.4 170.0,175.0 C183.6,174.6 174.8,173.0 177.0,171.0 C179.2,169.0 184.3,163.7 186.0,161.0 C187.7,158.3 188.9,155.9 189.0,152.0 C189.1,148.1 187.7,135.8 187.0,133.0 C186.3,130.2 185.4,131.3 184.0,132.0 C182.6,132.7 181.2,136.3 177.0,138.0 C172.8,139.7 159.5,144.0 154.0,144.0 C148.5,144.0 141.8,140.4 138.0,138.0 C134.2,135.6 129.1,129.9 127.0,127.0 C124.9,124.1 123.3,118.7 123.0,117.0 C122.7,115.3 123.5,114.0 125.0,115.0 C126.5,116.0 130.5,121.9 134.0,124.0 C137.5,126.1 144.7,129.6 150.0,130.0 C155.3,130.4 167.4,128.5 172.0,127.0 C176.6,125.5 180.6,121.2 183.0,119.0 C185.4,116.8 187.3,114.9 189.0,111.0 C190.7,107.1 192.1,94.9 195.0,91.0 C197.9,87.1 205.4,86.6 210.0,83.0 C214.6,79.4 225.2,67.0 228.0,65.0 C230.8,63.0 230.6,66.9 230.0,69.0 C229.4,71.1 224.4,77.5 224.0,80.0 C223.6,82.5 224.2,84.1 227.0,87.0 C229.8,89.9 237.6,97.5 244.0,101.0 C250.4,104.5 269.1,110.2 273.0,112.0 C276.9,113.8 276.5,113.6 272.0,114.0 C267.5,114.4 245.9,110.1 241.0,115.0 C236.1,119.9 237.1,141.3 237.0,149.0 C236.9,156.7 238.5,165.1 240.0,170.0 C241.5,174.9 244.6,180.1 248.0,184.0 C251.4,187.9 259.8,195.1 264.0,198.0 C268.2,200.9 276.3,203.7 278.0,205.0 C279.7,206.3 278.7,206.9 276.0,207.0 C273.3,207.1 264.2,205.6 259.0,206.0 C253.8,206.4 243.2,208.6 239.0,210.0 C234.8,211.4 231.7,213.8 229.0,216.0 C226.3,218.2 222.4,221.1 220.0,226.0 C217.6,230.9 212.8,244.6 212.0,251.0 C211.2,257.4 212.9,267.4 214.0,272.0 C215.1,276.6 218.0,281.2 220.0,284.0 C222.0,286.8 225.3,290.2 228.0,292.0 C230.7,293.8 233.7,296.0 239.0,297.0 C244.3,298.0 260.0,299.3 266.0,299.0 C272.0,298.7 277.0,297.0 282.0,295.0 C287.0,293.0 296.4,288.9 302.0,285.0 C307.6,281.1 317.4,272.5 322.0,267.0 C326.6,261.5 332.8,248.1 335.0,246.0 C337.2,243.9 337.4,248.1 338.0,252.0 C338.6,255.9 336.9,270.5 339.0,274.0 C341.1,277.5 347.5,276.9 353.0,277.0 C358.5,277.1 373.1,276.1 378.0,275.0 C382.9,273.9 384.6,272.1 388.0,269.0 C391.4,265.9 398.2,262.9 402.0,253.0 C405.8,243.1 413.0,210.0 415.0,198.0 C417.0,186.0 416.1,173.9 416.0,167.0 C415.9,160.1 414.8,153.3 414.0,149.0 C413.2,144.7 411.7,138.9 410.0,136.0 C408.3,133.1 404.2,129.5 402.0,128.0 C399.8,126.5 399.7,126.1 394.0,125.0 C388.3,123.9 375.3,130.8 361.0,120.0 C346.7,109.2 304.5,60.0 292.0,48.0 C279.5,36.0 279.6,37.5 272.0,34.0 C264.4,30.5 247.5,25.5 238.0,23.0 C228.5,20.5 210.3,17.0 204.0,16.0 C197.7,15.0 195.8,15.7 193.0,16.0 C190.2,16.3 186.8,16.9 184.0,18.0 C181.2,19.1 177.3,19.8 173.0,24.0 C168.7,28.2 164.2,45.2 153.0,48.0 C141.8,50.8 104.1,43.6 93.0,44.0 C81.9,44.4 77.8,48.9 74.0,51.0 C70.2,53.1 68.2,55.2 66.0,59.0 Z M94.0,108.0 C96.1,107.3 114.8,108.3 119.0,109.0 C123.2,109.7 123.6,112.2 124.0,113.0 C124.4,113.8 124.8,114.9 122.0,115.0 C119.2,115.1 107.9,115.0 104.0,114.0 C100.1,113.0 91.9,108.7 94.0,108.0 Z" fill="#efc852" fill-rule="evenodd"/><path d="M150.0,250.0 C148.5,249.3 144.3,248.6 144.0,251.0 C143.7,253.4 148.6,262.8 148.0,267.0 C147.4,271.2 141.0,278.8 140.0,281.0 C139.0,283.2 139.9,283.0 141.0,283.0 C142.1,283.0 146.0,282.7 148.0,281.0 C150.0,279.3 154.0,274.5 155.0,271.0 C156.0,267.5 155.7,258.9 155.0,256.0 C154.3,253.1 151.5,250.7 150.0,250.0 Z" fill="#f4d65e" fill-rule="evenodd"/><path d="M152.0,190.0 C151.6,192.8 156.7,206.7 156.0,212.0 C155.3,217.3 148.0,225.3 147.0,228.0 C146.0,230.7 147.7,230.9 149.0,231.0 C150.3,231.1 153.8,231.1 156.0,229.0 C158.2,226.9 164.0,220.3 165.0,216.0 C166.0,211.7 163.8,201.4 163.0,198.0 C162.2,194.6 160.5,193.1 159.0,192.0 C157.5,190.9 152.4,187.2 152.0,190.0 Z" fill="#f4d65e" fill-rule="evenodd"/><path d="M172.0,141.0 C170.9,140.2 167.1,141.2 166.0,143.0 C164.9,144.8 165.3,151.1 164.0,154.0 C162.7,156.9 157.7,162.2 157.0,164.0 C156.3,165.8 157.9,166.6 159.0,167.0 C160.1,167.4 163.5,167.7 165.0,167.0 C166.5,166.3 168.7,164.5 170.0,162.0 C171.3,159.5 173.7,151.9 174.0,149.0 C174.3,146.1 173.1,141.8 172.0,141.0 Z" fill="#f4d65e" fill-rule="evenodd"/><path d="M123.0,105.0 C123.0,106.1 123.5,110.0 125.0,112.0 C126.5,114.0 130.5,117.9 134.0,119.0 C137.5,120.1 147.1,120.3 150.0,120.0 C152.9,119.7 156.5,117.8 155.0,117.0 C153.5,116.2 143.2,115.8 139.0,114.0 C134.8,112.2 127.2,105.3 125.0,104.0 C122.8,102.7 123.0,103.9 123.0,105.0 Z" fill="#f4d65e" fill-rule="evenodd"/><path d="M410.0,136.0 C408.9,132.2 407.5,131.4 406.0,130.0 C404.5,128.6 405.2,127.4 399.0,126.0 C392.8,124.6 376.6,130.5 362.0,120.0 C347.4,109.5 306.9,62.6 295.0,51.0 C283.1,39.4 282.9,40.4 277.0,37.0 C271.1,33.6 262.5,29.8 253.0,27.0 C243.5,24.2 218.1,18.4 209.0,17.0 C199.9,15.6 193.2,16.0 188.0,17.0 C182.8,18.0 177.0,19.7 172.0,24.0 C167.0,28.3 159.7,45.2 152.0,48.0 C144.3,50.8 126.8,44.3 117.0,44.0 C107.2,43.7 89.1,44.0 82.0,46.0 C74.9,48.0 69.1,54.8 66.0,58.0 C62.9,61.2 61.3,65.1 60.0,69.0 C58.7,72.9 57.3,81.5 57.0,86.0 C56.7,90.5 60.2,97.4 58.0,101.0 C55.8,104.6 44.9,107.7 41.0,112.0 C37.1,116.3 31.4,126.0 30.0,132.0 C28.6,138.0 30.0,150.1 31.0,155.0 C32.0,159.9 34.3,163.8 37.0,167.0 C39.7,170.2 49.0,175.5 50.0,178.0 C51.0,180.5 46.0,181.6 44.0,185.0 C42.0,188.4 37.1,197.0 36.0,202.0 C34.9,207.0 35.0,215.8 36.0,221.0 C37.0,226.2 40.8,234.9 43.0,239.0 C45.2,243.1 49.3,247.6 52.0,250.0 C54.7,252.4 61.3,252.1 62.0,256.0 C62.7,259.9 57.3,272.4 57.0,278.0 C56.7,283.6 58.2,292.2 60.0,296.0 C61.8,299.8 69.2,304.4 70.0,305.0 C70.8,305.6 67.0,302.5 66.0,300.0 C65.0,297.5 63.4,290.9 63.0,287.0 C62.6,283.1 62.2,276.2 63.0,272.0 C63.8,267.8 67.7,259.5 69.0,257.0 C70.3,254.5 68.1,255.0 72.0,254.0 C75.9,253.0 97.7,251.1 97.0,250.0 C96.3,248.9 72.3,247.7 67.0,246.0 C61.7,244.3 61.2,241.1 59.0,238.0 C56.8,234.9 52.4,227.5 51.0,224.0 C49.6,220.5 49.0,216.8 49.0,213.0 C49.0,209.2 49.5,201.5 51.0,197.0 C52.5,192.5 54.4,183.5 60.0,181.0 C65.6,178.5 91.4,180.4 91.0,179.0 C90.6,177.6 63.3,173.8 57.0,171.0 C50.7,168.2 48.2,163.9 46.0,159.0 C43.8,154.1 40.9,141.6 41.0,136.0 C41.1,130.4 45.0,122.5 47.0,119.0 C49.0,115.5 49.1,112.1 55.0,111.0 C60.9,109.9 85.2,111.7 89.0,111.0 C92.8,110.3 85.1,107.3 82.0,106.0 C78.9,104.7 69.4,103.4 67.0,102.0 C64.6,100.6 64.7,100.1 65.0,96.0 C65.3,91.9 67.9,77.3 69.0,73.0 C70.1,68.7 70.1,68.2 73.0,65.0 C75.9,61.8 86.2,52.5 90.0,50.0 C93.8,47.5 92.3,47.1 100.0,47.0 C107.7,46.9 138.0,48.3 145.0,49.0 C152.0,49.7 150.1,50.0 150.0,52.0 C149.9,54.0 144.7,61.2 144.0,63.0 C143.3,64.8 143.0,64.4 145.0,65.0 C147.0,65.6 154.1,65.5 158.0,67.0 C161.9,68.5 168.4,78.5 173.0,76.0 C177.6,73.5 186.1,54.9 191.0,49.0 C195.9,43.1 202.3,36.7 208.0,34.0 C213.7,31.3 224.2,29.6 232.0,30.0 C239.8,30.4 256.2,34.6 264.0,37.0 C271.8,39.4 273.9,33.6 288.0,47.0 C302.1,60.4 348.9,120.1 365.0,133.0 C381.1,145.9 396.8,137.5 403.0,139.0 C409.2,140.5 407.5,141.5 409.0,144.0 C410.5,146.5 413.9,158.1 414.0,157.0 C414.1,155.9 411.1,139.8 410.0,136.0 Z" fill="#f4d65e" fill-rule="evenodd"/></svg>';

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
      const height = Math.round(width * 340 / 436); // the drawing's own proportions (its viewBox)
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
