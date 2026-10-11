(() => {
  'use strict';

  /* ───────────────────────── scene manager ───────────────────────── */
  const scenes = {
    current: 'scene-intro',
    go(id) {
      if (this.current === id) return;
      document.querySelectorAll('.scene').forEach(s => s.classList.toggle('is-active', s.id === id));
      this.current = id;
      document.dispatchEvent(new CustomEvent('scene:enter', { detail: id }));
    }
  };

  /* ───────────────────────── audio ───────────────────────── */
  const bgm = document.getElementById('bgm');
  const MUSIC_VOL = 0.18;   // background music level (0–1): soft and soothing
  let ac = null;
  let musicStarted = false;

  function audioCtx() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function startMusic() {
    if (musicStarted) return;
    musicStarted = true;
    bgm.volume = 0;
    const p = bgm.play();
    if (p && p.catch) p.catch(() => { /* no file yet — silent */ });
    const target = MUSIC_VOL, steps = 40;
    let i = 0;
    const t = setInterval(() => {
      i++;
      bgm.volume = Math.min(target, (i / steps) * target);
      if (i >= steps) clearInterval(t);
    }, 60);
  }

  // bow-string twang, synthesised so no file is needed
  function sfxTwang(strength = 1) {
    try {
      const a = audioCtx(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(260 + 80 * strength, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.28);
      g.gain.setValueAtTime(0.22 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.4);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + 0.45);
    } catch (_) {}
  }

  // soft "pop" when the heart bursts
  // a buffer of shaped noise: `shape(u)` is the envelope over 0..1
  function noiseSource(a, seconds, shape) {
    const len = Math.floor(a.sampleRate * seconds), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * shape(i / len);
    const s = a.createBufferSource(); s.buffer = buf; return s;
  }

  // soft harp shimmer — a quick run of rising notes, pure tones only (no noise, so nothing harsh)
  function sfxSparkle(vol = 0.07) {
    try {
      const a = audioCtx(), t = a.currentTime;
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.5, 1567.98];   // C major pentatonic, two octaves
      notes.forEach((f, i) => {
        const d = i * 0.045;
        const o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = f;
        o2.type = 'triangle'; o2.frequency.value = f * 2; // a faint octave for sparkle
        const g2 = a.createGain(); g2.gain.value = 0.18;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(vol, t + d + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
        o.connect(g); o2.connect(g2).connect(g); g.connect(a.destination);
        o.start(t + d); o2.start(t + d); o.stop(t + d + 0.95); o2.stop(t + d + 0.95);
      });
    } catch (_) {}
  }

  // used for bursts and reveals
  function sfxPop() { sfxSparkle(); }

  // a real firework: whoosh up, low boom, then a scatter of crackles
  function sfxFirework(big = true) {
    try {
      const a = audioCtx(), t = a.currentTime;
      if (big) {
        const w = noiseSource(a, 0.5, u => Math.sin(u * Math.PI));
        const wf = a.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 2;
        wf.frequency.setValueAtTime(250, t); wf.frequency.exponentialRampToValueAtTime(1900, t + 0.45);
        const wg = a.createGain(); wg.gain.value = 0.12;
        w.connect(wf).connect(wg).connect(a.destination); w.start(t);
      }
      const b = t + (big ? 0.45 : 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, b); o.frequency.exponentialRampToValueAtTime(36, b + 0.5);
      g.gain.setValueAtTime(0.0001, b); g.gain.exponentialRampToValueAtTime(0.4, b + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, b + 0.8);
      o.connect(g).connect(a.destination); o.start(b); o.stop(b + 0.85);
      const body = noiseSource(a, 0.7, u => Math.pow(1 - u, 2.5));
      const bf = a.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 500;
      const bg = a.createGain(); bg.gain.value = 0.22;
      body.connect(bf).connect(bg).connect(a.destination); body.start(b);
      for (let i = 0; i < 12; i++) {
        const c = noiseSource(a, 0.02, u => 1 - u);
        const cf = a.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 2500;
        const cg = a.createGain(); cg.gain.value = 0.05 + Math.random() * 0.04;
        c.connect(cf).connect(cg).connect(a.destination); c.start(b + 0.1 + Math.random() * 0.9);
      }
    } catch (_) {}
  }

  function buzz(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  /* ───────────────────────── particles (canvas) ───────────────────────── */
  const fx = document.getElementById('fx');
  const ctx = fx.getContext('2d');
  const parts = [];
  let fxRunning = false;
  let W = 0, H = 0;

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    fx.width = W * dpr; fx.height = H * dpr;
    fx.style.width = W + 'px'; fx.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function heartPath(c, s) {
    // unit heart centred at origin, height ≈ s
    c.beginPath();
    c.moveTo(0, s * 0.45);
    c.bezierCurveTo(0, s * 0.45, -s * 0.5, s * 0.12, -s * 0.5, -s * 0.18);
    c.bezierCurveTo(-s * 0.5, -s * 0.38, -s * 0.33, -s * 0.5, -s * 0.2, -s * 0.5);
    c.bezierCurveTo(-s * 0.09, -s * 0.5, -s * 0.02, -s * 0.43, 0, -s * 0.33);
    c.bezierCurveTo(s * 0.02, -s * 0.43, s * 0.09, -s * 0.5, s * 0.2, -s * 0.5);
    c.bezierCurveTo(s * 0.33, -s * 0.5, s * 0.5, -s * 0.38, s * 0.5, -s * 0.18);
    c.bezierCurveTo(s * 0.5, s * 0.12, 0, s * 0.45, 0, s * 0.45);
    c.closePath();
  }

  const PALETTE = ['#ff5c8a', '#ff8fab', '#ffc2d1', '#e63968', '#ffd6a5', '#ffffff', '#ffb3c6'];

  function burst(x, y, n = 110) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 8;
      parts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 2.5,
        g: 0.13,
        drag: 0.985,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
        size: 5 + Math.random() * 9,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        color: PALETTE[(Math.random() * PALETTE.length) | 0],
        kind: Math.random() < 0.65 ? 'heart' : 'dot'
      });
    }
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(tickFx); }
  }

  function tickFx() {
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.3));
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'heart') { heartPath(ctx, p.size); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(0, 0, p.size * 0.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(tickFx);
    else { fxRunning = false; ctx.clearRect(0, 0, W, H); }
  }

  /* ───────────────────────── scene 1 · bow & arrow ───────────────────────── */
  const scene1 = document.getElementById('scene-intro');
  const svg = document.getElementById('bowSvg');
  const limbEl = document.getElementById('limb');
  const stringEl = document.getElementById('string');
  const arrowG = document.getElementById('arrow');
  const shaftEl = document.getElementById('shaft');
  const fletchEl = document.getElementById('fletch');
  const tipEl = document.getElementById('tip');
  const heartEl = document.getElementById('targetHeart');
  const hintEl = document.getElementById('hint');

  const bow = { x: 0, y: 0, L: 60, d: { x: 1, y: 0 }, p: { x: 0, y: 1 }, pull: 0, lat: 0, maxPull: 60 };
  let state = 'idle';            // idle | pulling | flying | done
  let drag = null;               // { id, x, y }
  let snapRaf = 0;
  let flight = null;             // { from, ctrl, to, t0, dur }

  function heartCenter() {
    const r = heartEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    bow.L = Math.max(46, Math.min(W, H) * 0.155);
    bow.x = W * 0.25;
    bow.y = H * 0.735;
    const h = heartCenter();
    const dx = h.x - bow.x, dy = h.y - bow.y, len = Math.hypot(dx, dy) || 1;
    bow.d = { x: dx / len, y: dy / len };
    bow.p = { x: -bow.d.y, y: bow.d.x };
    bow.maxPull = bow.L * 1.05;
    draw();
  }

  function gripPoint() {
    // apex of the limb curve (quadratic bezier at t = .5)
    return { x: bow.x + bow.d.x * bow.L * 0.215, y: bow.y + bow.d.y * bow.L * 0.215 };
  }

  function nockPoint() {
    const back = bow.L * 0.1 + bow.pull;
    return {
      x: bow.x - bow.d.x * back + bow.p.x * bow.lat,
      y: bow.y - bow.d.y * back + bow.p.y * bow.lat
    };
  }

  function placeArrow(n, aim, len) {
    const tip = { x: n.x + aim.x * len, y: n.y + aim.y * len };
    const deg = Math.atan2(aim.y, aim.x) * 180 / Math.PI;
    shaftEl.setAttribute('x1', n.x); shaftEl.setAttribute('y1', n.y);
    shaftEl.setAttribute('x2', tip.x - aim.x * 6); shaftEl.setAttribute('y2', tip.y - aim.y * 6);
    // fletching: two short feathers angled back from the nock
    const f = 11, s = 5;
    const px = -aim.y, py = aim.x;
    const feather = (back, len) =>
      `M${n.x + aim.x * back} ${n.y + aim.y * back} L${n.x + aim.x * (back - len) + px * s} ${n.y + aim.y * (back - len) + py * s}` +
      `M${n.x + aim.x * back} ${n.y + aim.y * back} L${n.x + aim.x * (back - len) - px * s} ${n.y + aim.y * (back - len) - py * s}`;
    fletchEl.setAttribute('d', feather(2, f + 2) + feather(9, f + 2));
    // heart tip, its point facing forward
    const scale = 0.19;
    tipEl.setAttribute('transform',
      `translate(${tip.x - aim.x * 8} ${tip.y - aim.y * 8}) rotate(${deg - 90}) scale(${scale}) translate(-50 -47)`);
  }

  function draw() {
    const { x, y, L, d, p } = bow;
    const t1 = { x: x + p.x * L - d.x * L * 0.12, y: y + p.y * L - d.y * L * 0.12 };
    const t2 = { x: x - p.x * L - d.x * L * 0.12, y: y - p.y * L - d.y * L * 0.12 };
    const c = { x: x + d.x * L * 0.55, y: y + d.y * L * 0.55 };
    limbEl.setAttribute('d', `M${t1.x} ${t1.y} Q${c.x} ${c.y} ${t2.x} ${t2.y}`);

    const n = nockPoint();
    stringEl.setAttribute('d', `M${t1.x} ${t1.y} L${n.x} ${n.y} L${t2.x} ${t2.y}`);

    if (state === 'idle' || state === 'pulling') {
      const g = gripPoint();
      let ax = g.x - n.x, ay = g.y - n.y;
      const al = Math.hypot(ax, ay) || 1;
      ax /= al; ay /= al;
      placeArrow(n, { x: ax, y: ay }, L * 1.9);
    }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // phones only allow fullscreen after a touch — her first touch is the bow, so that's the moment
  let wentFullscreen = false;
  function goFullscreen() {
    if (wentFullscreen) return;
    wentFullscreen = true;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => { try { screen.orientation.lock('portrait').catch(() => {}); } catch (_) {} }).catch(() => {});
    } catch (_) {}
  }

  function onDown(e) {
    if (state !== 'idle') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType !== 'mouse') goFullscreen();
    cancelAnimationFrame(snapRaf);
    state = 'pulling';
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { scene1.setPointerCapture(e.pointerId); } catch (_) {}
    scene1.classList.add('grabbing');
    audioCtx(); // unlock audio on first touch
  }

  function onMove(e) {
    if (state !== 'pulling' || !drag || e.pointerId !== drag.id) return;
    const vx = e.clientX - drag.x, vy = e.clientY - drag.y;
    const pull = clamp(-(vx * bow.d.x + vy * bow.d.y), 0, bow.maxPull);
    const lat = clamp((vx * bow.p.x + vy * bow.p.y) * 0.35, -bow.L * 0.45, bow.L * 0.45);
    bow.pull = pull; bow.lat = lat;
    hintEl.classList.toggle('is-hidden', pull > 8);
    draw();
  }

  function onUp(e) {
    if (state !== 'pulling' || !drag || e.pointerId !== drag.id) return;
    scene1.classList.remove('grabbing');
    drag = null;
    const strength = bow.pull / bow.maxPull;
    if (strength < 0.32) { state = 'idle'; snapBack(); hintEl.classList.remove('is-hidden'); return; }
    shoot(strength);
  }

  function snapBack() {
    const p0 = bow.pull, l0 = bow.lat, t0 = performance.now();
    const step = (now) => {
      const t = (now - t0) / 1000;
      const k = Math.exp(-7 * t) * Math.cos(26 * t);
      bow.pull = p0 * k; bow.lat = l0 * k;
      draw();
      if (t < 0.6) snapRaf = requestAnimationFrame(step);
      else { bow.pull = 0; bow.lat = 0; draw(); }
    };
    snapRaf = requestAnimationFrame(step);
  }

  function shoot(strength) {
    state = 'flying';
    hintEl.classList.add('is-hidden');
    sfxTwang(strength);
    buzz(12);
    startMusic();

    const n = nockPoint();
    const h = heartCenter();
    const g = gripPoint();
    let ax = g.x - n.x, ay = g.y - n.y;
    const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;

    // the string whips back while the arrow is in the air
    snapBack();

    const to = { x: h.x, y: h.y + h.r * 0.1 };
    const dist = Math.hypot(to.x - n.x, to.y - n.y);
    // gentle arc: push the control point along the initial aim, then lift it a little
    const ctrl = {
      x: n.x + ax * dist * 0.5 - (to.y - n.y) * 0.08,
      y: n.y + ay * dist * 0.5 - 40
    };
    flight = { from: n, ctrl, to, t0: performance.now(), dur: 520 + (1 - strength) * 160 };
    requestAnimationFrame(tickFlight);
  }

  function tickFlight(now) {
    if (!flight) return;
    const f = flight;
    let u = (now - f.t0) / f.dur;
    if (u >= 1) { flight = null; hit(); return; }
    const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65; // slight ease-in
    const q = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
    const x = q(f.from.x, f.ctrl.x, f.to.x, e);
    const y = q(f.from.y, f.ctrl.y, f.to.y, e);
    // tangent for orientation
    const tx = 2 * (1 - e) * (f.ctrl.x - f.from.x) + 2 * e * (f.to.x - f.ctrl.x);
    const ty = 2 * (1 - e) * (f.ctrl.y - f.from.y) + 2 * e * (f.to.y - f.ctrl.y);
    const tl = Math.hypot(tx, ty) || 1;
    const aim = { x: tx / tl, y: ty / tl };
    const len = bow.L * 1.9;
    placeArrow({ x: x - aim.x * len, y: y - aim.y * len }, aim, len);
    requestAnimationFrame(tickFlight);
  }

  function hit() {
    state = 'done';
    const h = heartCenter();
    heartEl.classList.add('is-hit');
    buzz([20, 30, 60]);
    setTimeout(() => {
      sfxPop();
      burst(h.x, h.y, 120);
      heartEl.classList.remove('is-hit');
      heartEl.classList.add('is-gone');
      arrowG.style.transition = 'opacity .25s';
      arrowG.style.opacity = '0';
      const flash = document.createElement('div');
      flash.className = 'flash go';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 800);
      setTimeout(() => scenes.go('scene-two'), 950);
    }, 420);
  }

  scene1.addEventListener('pointerdown', onDown);
  scene1.addEventListener('pointermove', onMove);
  scene1.addEventListener('pointerup', onUp);
  scene1.addEventListener('pointercancel', onUp);
  scene1.addEventListener('contextmenu', e => e.preventDefault());

  /* ───────────────────────── scene 2 · I love you ───────────────────────── */
  // split the title into letters so each one can animate in on its own
  (() => {
    let i = 0;
    document.querySelectorAll('#scene-two [data-split]').forEach(line => {
      const text = line.textContent;
      line.textContent = '';
      for (const ch of text) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        s.style.setProperty('--i', i++);
        line.appendChild(s);
      }
    });
  })();

  let scene2Ready = false;
  const cinema = document.getElementById('cinema');
  document.addEventListener('scene:enter', e => {
    // letterbox bars frame this scene only; they slide out again on the way to the next
    cinema.classList.toggle('is-on', e.detail === 'scene-two');
    if (e.detail === 'scene-two') setTimeout(() => { scene2Ready = true; }, 4600);
  });
  document.getElementById('scene-two').addEventListener('pointerup', () => {
    if (!scene2Ready) return;
    buzz(10);
    scenes.go('scene-three');
  });

  /* ───────────────────────── scene 3 · heart tree ───────────────────────── */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const svgEl = (tag, attrs = {}) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // classic heart curve, y flipped so "up" is negative like SVG
  function heartCurve(t) {
    return {
      x: 16 * Math.pow(Math.sin(t), 3),
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    };
  }

  // The tree is laid out for the screen shape: a tall phone canvas or a wide desktop one,
  // so on a laptop it fills the screen the way the reference does instead of staying phone-sized.
  const CANOPY = { cx: 205, cy: 305, s: 10.2 };    // canopy centre + scale (viewBox units)
  const TRUNK_TOP = { x: 205, y: 470 };
  const VB = { w: 390, h: 844, base: 232, landscape: false };
  const leafSpots = [];                             // reused for falling hearts

  function layoutTree() {
    const landscape = window.innerWidth > window.innerHeight * 1.05;
    VB.landscape = landscape;
    if (landscape) { VB.w = 1300; CANOPY.cx = 650; CANOPY.cy = 262; CANOPY.s = 16.5; }
    else           { VB.w = 390;  CANOPY.cx = 205; CANOPY.cy = 305; CANOPY.s = 10.2; }
    TRUNK_TOP.x = CANOPY.cx;
    TRUNK_TOP.y = CANOPY.cy + 16.2 * CANOPY.s;       // just inside the heart's bottom tip
    VB.base = CANOPY.cx + 27 * (CANOPY.s / 10.2);
    document.getElementById('treeSvg').setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
  }

  function buildTree() {
    layoutTree();
    const branches = document.getElementById('branches');
    const canopy = document.getElementById('canopy');
    branches.innerHTML = ''; canopy.innerHTML = ''; leafSpots.length = 0;
    const k = CANOPY.s / 10.2;                       // size factor vs the phone layout
    const wk = Math.pow(k, 0.6);                     // strokes grow a little slower than lengths

    // Hand-traced from the reference: a smooth trunk, three limbs, each forking twice, tips tapering to points.
    // Coordinates are in heart units (fork point = 0,0 · y up · heart canopy centred at 0,16.2).
    // [x0,y0, c1x,c1y, c2x,c2y, x1,y1, baseWidth, tipWidth, startTime, duration]
    const T = [
      // trunk
      [2.6, -42, 3.0, -30, 0.8, -12, 0, 0, 1.7, 1.05, 0.10, 0.9],
      // three limbs: out, then up
      [0, 0, -3.2, 3.2, -8.0, 6.5, -8.5, 10, 1.05, 0.62, 1.00, 0.7],
      [0, 0, 3.2, 3.2, 7.6, 6.2, 8.0, 9.5, 1.05, 0.62, 1.05, 0.7],
      [0, 0, 0.6, 4, 0.6, 8, 0.5, 12, 0.80, 0.45, 1.10, 0.7],
      // second level · left
      [-8.5, 10, -10.5, 12.5, -14.3, 14.5, -14.5, 18, 0.62, 0.36, 1.70, 0.6],
      [-8.5, 10, -9, 13, -9.8, 16.5, -9.5, 20, 0.58, 0.34, 1.75, 0.6],
      [-8.5, 10, -7, 12.5, -5, 14, -5, 17, 0.52, 0.30, 1.80, 0.6],
      // second level · right
      [8, 9.5, 10, 12, 13.8, 14.2, 14.5, 17.5, 0.62, 0.36, 1.70, 0.6],
      [8, 9.5, 8.6, 13, 9.6, 16.5, 9.5, 20, 0.58, 0.34, 1.75, 0.6],
      [8, 9.5, 6.5, 12, 4.8, 13.8, 4.5, 16.5, 0.52, 0.30, 1.80, 0.6],
      // second level · centre
      [0.5, 12, -0.2, 15, -2.2, 18, -3, 21, 0.45, 0.26, 1.80, 0.6],
      [0.5, 12, 1.2, 15, 3, 18.5, 3.5, 21.5, 0.45, 0.26, 1.85, 0.6],
      // twigs · left
      [-14.5, 18, -15.2, 19.5, -15.5, 20.8, -15.3, 21.8, 0.36, 0.06, 2.30, 0.45],
      [-14.5, 18, -13.5, 19.8, -12.6, 21.2, -12.5, 22.5, 0.36, 0.06, 2.35, 0.45],
      [-9.5, 20, -10.4, 22, -11.4, 23.6, -11.5, 25, 0.34, 0.06, 2.35, 0.45],
      [-9.5, 20, -9.2, 22, -8.4, 24, -8, 25.5, 0.34, 0.06, 2.40, 0.45],
      [-9.5, 20, -8.4, 21.2, -7, 22.4, -6.5, 23.5, 0.30, 0.06, 2.45, 0.4],
      [-5, 17, -5.6, 18.8, -6, 20.2, -6, 21.5, 0.30, 0.06, 2.40, 0.4],
      [-5, 17, -4, 18.2, -2.9, 18.9, -2.5, 19.5, 0.30, 0.06, 2.45, 0.4],
      // twigs · right
      [14.5, 17.5, 15.2, 19, 15.5, 20.4, 15.3, 21.5, 0.36, 0.06, 2.30, 0.45],
      [14.5, 17.5, 13.6, 19.3, 12.7, 21, 12.5, 22.5, 0.36, 0.06, 2.35, 0.45],
      [9.5, 20, 10.4, 22, 11.4, 23.6, 11.5, 25, 0.34, 0.06, 2.35, 0.45],
      [9.5, 20, 9.2, 22, 8.4, 24, 8, 25.5, 0.34, 0.06, 2.40, 0.45],
      [9.5, 20, 8.4, 21.2, 7, 22.4, 6.5, 23.5, 0.30, 0.06, 2.45, 0.4],
      [4.5, 16.5, 5.2, 18.2, 5.8, 19.8, 6, 21.5, 0.30, 0.06, 2.40, 0.4],
      [4.5, 16.5, 3.5, 17.8, 2.7, 18.8, 2.5, 19.5, 0.30, 0.06, 2.45, 0.4],
      // twigs · centre
      [-3, 21, -3.8, 22.5, -4.4, 23.6, -4.5, 24.5, 0.26, 0.06, 2.50, 0.4],
      [-3, 21, -2.5, 22.2, -2.1, 23, -2, 23.5, 0.26, 0.06, 2.55, 0.35],
      [3.5, 21.5, 4.2, 23, 4.9, 24.2, 5, 25, 0.26, 0.06, 2.50, 0.4],
      [3.5, 21.5, 3, 22.6, 2.6, 23.5, 2.5, 24, 0.26, 0.06, 2.55, 0.35],
      // little side twigs along the limbs
      [-7.05, 6.9, -8.2, 8.4, -9.3, 10.4, -9.5, 12, 0.30, 0.06, 2.00, 0.45],
      [6.7, 6.6, 7.8, 8, 8.9, 10, 9, 11.6, 0.30, 0.06, 2.05, 0.45],
      [0.5, 6, 1.6, 7.4, 2.7, 9.2, 3, 10.5, 0.26, 0.06, 2.00, 0.4]
    ];

    const S = CANOPY.s, cx = CANOPY.cx, top = TRUNK_TOP.y;
    const f = n => n.toFixed(1);
    const P = (x, y) => [cx + x * S, top - y * S];                 // heart units → viewBox px
    const bez = (b, t) => {
      const u = 1 - t, a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      return [a * b[0] + bb * b[2] + c * b[4] + d * b[6], a * b[1] + bb * b[3] + c * b[5] + d * b[7]];
    };
    // Each branch is drawn as a chain of short round-capped strokes whose width shrinks
    // towards the tip — a smooth taper that still "grows" segment by segment.
    const segs = [];
    for (const b of T) {
      let len = 0, prev = bez(b, 0);
      for (let i = 1; i <= 16; i++) { const p = bez(b, i / 16); len += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
      const M = Math.max(3, Math.round(len / 1.1));
      const w0 = b[8], w1 = b[9], start = b[10], dur = b[11];
      for (let i = 0; i < M; i++) {
        const t0 = i / M, t1 = (i + 1) / M, tm = (t0 + t1) / 2;
        const A = P(...bez(b, t0)), C = P(...bez(b, tm)), D = P(...bez(b, t1));
        const w = (w1 + (w0 - w1) * Math.pow(1 - tm, 1.15)) * 10.2 * wk;
        const qx = 2 * C[0] - (A[0] + D[0]) / 2, qy = 2 * C[1] - (A[1] + D[1]) / 2;
        segs.push({ d: `M${f(A[0])} ${f(A[1])} Q${f(qx)} ${f(qy)} ${f(D[0])} ${f(D[1])}`, w, delay: start + dur * t0, dur: dur / M });
      }
    }
    // thick parts first so thin tips sit on top of them
    segs.sort((a, b) => b.w - a.w);
    for (const s of segs) {
      const p = svgEl('path', { d: s.d, 'stroke-width': s.w.toFixed(2), pathLength: 1 });
      p.style.animationDelay = s.delay.toFixed(3) + 's';
      p.style.animationDuration = s.dur.toFixed(3) + 's';
      p.style.animationTimingFunction = 'linear';
      branches.appendChild(p);
    }
    // hearts fill the heart-shaped canopy, budding outward from the trunk.
    // Laid on a jittered hex grid (not at random) so coverage is even and solid, with the
    // hearts bigger than the grid step so they always overlap — no holes, like the reference.
    const bound = new Float32Array(360).fill(0);
    for (let i = 0; i < 1440; i++) {
      const t = i / 1440 * Math.PI * 2;
      const X = 16 * Math.pow(Math.sin(t), 3);
      const Y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const a = ((Math.atan2(Y, X) * 180 / Math.PI) + 360) % 360 | 0;
      bound[a] = Math.max(bound[a], Math.hypot(X, Y));
    }
    for (let i = 0; i < 360; i++) if (!bound[i]) bound[i] = Math.max(bound[(i + 359) % 360], bound[(i + 1) % 360]);
    const inside = (hx, hy, shrink) => {
      const a = ((Math.atan2(hy, hx) * 180 / Math.PI) + 360) % 360 | 0;
      return Math.hypot(hx, hy) < bound[a] * shrink;
    };
    const weights = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4];
    const spots = [];
    const push = (hx, hy, size) => spots.push({
      x: CANOPY.cx + hx * S, y: CANOPY.cy - hy * S,
      size, rot: rnd(-28, 28), c: weights[(Math.random() * weights.length) | 0]
    });
    // Like the reference: bigger hearts, clustered and overlapping, with the odd peek-through
    // to the twigs, and a fluffy edge where some hearts poke past the outline.
    const step = 1.45;                                 // grid spacing, heart units
    for (let row = 0, hy = -17.5; hy <= 12.8; hy += step * 0.866, row++) {
      for (let hx = -16.8 + (row % 2 ? step / 2 : 0); hx <= 16.8; hx += step) {
        const jx = hx + rnd(-0.38, 0.38) * step, jy = hy + rnd(-0.38, 0.38) * step;
        if (!inside(jx, jy, 1.0 + rnd(-0.03, 0.06))) continue;
        if (Math.random() < 0.1) continue;             // a few gaps so the branches show through
        push(jx, jy, (1.5 + Math.pow(Math.random(), 1.4) * 1.5) * S);
      }
    }
    // hearts along the outline, loosely, so the silhouette reads as a heart but stays fluffy
    for (let i = 0; i < 80; i++) {
      if (Math.random() < 0.2) continue;
      const t = i / 80 * Math.PI * 2 + rnd(-0.03, 0.03);
      const X = 16 * Math.pow(Math.sin(t), 3), Y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      const r = rnd(0.95, 1.04);
      push(X * r, Y * r, rnd(1.6, 2.5) * S);
    }
    // bigger hearts drawn last so they sit on top, like the reference
    spots.sort((a, b) => a.size - b.size);
    const maxD = Math.max(...spots.map(s => Math.hypot(s.x - TRUNK_TOP.x, s.y - TRUNK_TOP.y)));
    for (const sp of spots) {
      const d = Math.hypot(sp.x - TRUNK_TOP.x, sp.y - TRUNK_TOP.y) / maxD;
      const delay = 3.3 + d * 1.3 + Math.random() * 0.3;   // buds open once the twigs are drawn
      const outer = svgEl('g', { transform: `translate(${sp.x.toFixed(1)} ${sp.y.toFixed(1)}) rotate(${sp.rot.toFixed(1)})` });
      const inner = svgEl('g', { class: 'leaf' });
      inner.style.animationDelay = delay.toFixed(2) + 's';
      const use = svgEl('use', { x: -sp.size / 2, y: -sp.size / 2, width: sp.size, height: sp.size, fill: `url(#lf${sp.c})` });
      use.setAttributeNS(XLINK, 'xlink:href', '#leaf');
      use.setAttribute('href', '#leaf');
      inner.appendChild(use); outer.appendChild(inner); canopy.appendChild(outer);
      leafSpots.push(sp);
    }
  }

  function buildDrifts() {
    const box = document.getElementById('drifts');
    box.innerHTML = '';
    const colors = ['#ffb3c6', '#ff8fab', '#ffd1dc', '#ff9a3c', '#ffd23f'];
    for (let i = 0; i < 12; i++) {
      const s = svgEl('svg', { viewBox: '0 0 100 95' });
      const u = svgEl('use', { fill: colors[i % colors.length] });
      u.setAttributeNS(XLINK, 'xlink:href', '#leaf'); u.setAttribute('href', '#leaf');
      s.appendChild(u);
      const size = rnd(9, 22);
      // mostly along the edges so they frame the tree
      const left = Math.random() < 0.5 ? rnd(2, 26) : rnd(72, 96);
      s.style.cssText = `left:${left}%;width:${size}px;height:${size}px;` +
        `animation-duration:${rnd(9, 16).toFixed(1)}s;animation-delay:${(-rnd(0, 14)).toFixed(1)}s`;
      box.appendChild(s);
    }
  }

  let fallTimer = 0;
  function startFalling() {
    stopFalling();
    const fallers = document.getElementById('fallers');
    fallTimer = setInterval(() => {
      if (document.hidden || !leafSpots.length) return;
      const sp = leafSpots[(Math.random() * leafSpots.length) | 0];
      const outer = svgEl('g', { transform: `translate(${sp.x.toFixed(1)} ${sp.y.toFixed(1)})` });
      const inner = svgEl('g', { class: 'fall' });
      const use = svgEl('use', { x: -sp.size / 2, y: -sp.size / 2, width: sp.size, height: sp.size, fill: `url(#lf${sp.c})` });
      use.setAttributeNS(XLINK, 'xlink:href', '#leaf'); use.setAttribute('href', '#leaf');
      inner.appendChild(use); outer.appendChild(inner); fallers.appendChild(outer);
      setTimeout(() => outer.remove(), 4400);
    }, 1400);
  }
  function stopFalling() { clearInterval(fallTimer); fallTimer = 0; }

  buildTree();
  buildDrifts();
  // split the card title into letters for the typewriter
  document.querySelectorAll('[data-type]').forEach(el => {
    const text = el.textContent; el.textContent = '';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch'; s.textContent = ch; s.style.setProperty('--i', i);
      el.appendChild(s);
    });
  });

  // the svg "meets" the viewport, so work out where the trunk base lands and sway around it
  function placeTreeOrigin() {
    const svg = document.getElementById('treeSvg');
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / VB.w, r.height / VB.h);
    const cw = VB.w * scale;
    const ox = (r.width - cw) / 2 + VB.base * scale;
    svg.style.transformOrigin = `${ox}px ${r.height * 1.02}px`;
  }
  placeTreeOrigin();
  let treeResizeT = 0;
  window.addEventListener('resize', () => {
    placeTreeOrigin();
    clearTimeout(treeResizeT);
    treeResizeT = setTimeout(() => {
      // phone turned sideways / window reshaped: rebuild for the new canvas shape
      if ((window.innerWidth > window.innerHeight * 1.05) !== VB.landscape) { buildTree(); placeTreeOrigin(); }
    }, 250);
  });

  let scene3Ready = false;
  document.addEventListener('scene:enter', e => {
    if (e.detail === 'scene-three') {
      setTimeout(startFalling, 5200);
      setTimeout(() => { scene3Ready = true; }, 6000);
    } else {
      stopFalling();
    }
  });
  document.getElementById('scene-three').addEventListener('pointerup', () => {
    if (!scene3Ready) return;
    buzz(10);
    scenes.go('scene-four');
  });

  /* ───────────────────────── scene 4 · gift box ───────────────────────── */
  const giftScene = document.getElementById('scene-four');
  let giftOpened = false;
  giftScene.addEventListener('pointerup', () => {
    if (giftOpened || scenes.current !== 'scene-four') return;
    giftOpened = true;
    buzz(15);
    giftScene.classList.add('is-shaking');
    setTimeout(() => {
      giftScene.classList.remove('is-shaking');
      giftScene.classList.add('is-opening');
      const r = document.getElementById('giftSvg').getBoundingClientRect();
      sfxPop();
      buzz([20, 30, 50]);
      burst(r.left + r.width / 2, r.top + r.height * 0.5, 90);
    }, 520);
    setTimeout(() => scenes.go('scene-five'), 1250);
  });

  /* ───────────────────────── scene 5 · rose rain ───────────────────────── */
  const roseScene = document.getElementById('scene-five');
  const ROSE_COLORS = ['#ef7f9f', '#e3996f', '#f6efe3', '#ef7f9f', '#e3996f', '#f6efe3', '#f29ab5'];

  function buildRoses() {
    const field = document.getElementById('roseField');
    field.innerHTML = '';
    const W = window.innerWidth, H = window.innerHeight;
    const size = Math.max(58, Math.min(W / 5.2, 92));
    const cols = Math.ceil(W / size) + 1;
    const rowH = size * 0.86;
    const rows = Math.ceil(H / rowH) + 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const s = svgEl('svg', { class: 'rose', viewBox: '0 0 100 100' });
        const u = svgEl('use'); u.setAttributeNS(XLINK, 'xlink:href', '#rose'); u.setAttribute('href', '#rose');
        s.appendChild(u);
        const x = col * size - size / 2 + (row % 2 ? size / 2 : 0) + rnd(-6, 6);
        const y = row * rowH - size / 2 + rnd(-5, 5);
        // bottom rows land first so the screen fills upward; top rows leave first
        const drop = (rows - 1 - row) * 0.09 + Math.random() * 0.45;
        const exit = row * 0.05 + Math.random() * 0.35;
        s.style.cssText = `--size:${size}px;--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;` +
          `--r:${rnd(-28, 28).toFixed(1)}deg;--s:${rnd(.9, 1.1).toFixed(2)};` +
          `--d:${drop.toFixed(2)}s;--e:${exit.toFixed(2)}s;color:${ROSE_COLORS[(Math.random() * ROSE_COLORS.length) | 0]}`;
        field.appendChild(s);
      }
    }
  }
  buildRoses();
  window.addEventListener('resize', () => { if (scenes.current !== 'scene-five') buildRoses(); });

  document.addEventListener('scene:enter', e => {
    if (e.detail !== 'scene-five') return;
    buzz([8, 60, 8, 60, 8]);
    // roses fill the screen, hold a beat, then pour off the bottom while the next scene is already underneath
    setTimeout(() => {
      scenes.go('scene-six');
      roseScene.classList.add('is-leaving');
      setTimeout(() => roseScene.classList.remove('is-leaving'), 1700);
    }, 3400);
  });

  /* ───────────────────────── scene 6 · from me to you ───────────────────────── */
  (() => {
    const line = document.querySelector('#scene-six [data-split]');
    const text = line.textContent; line.textContent = '';
    [...text].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch'; s.textContent = ch; s.style.setProperty('--i', i);
      line.appendChild(s);
    });
    const img = document.getElementById('noteImg');
    const useImg = () => document.getElementById('noteArt').classList.add('has-img');
    img.addEventListener('load', useImg);
    if (img.complete && img.naturalWidth > 0) useImg(); // already cached before the script ran
  })();

  let scene6Ready = false;
  document.addEventListener('scene:enter', e => {
    if (e.detail === 'scene-six') setTimeout(() => { scene6Ready = true; }, 3400);
  });
  document.getElementById('scene-six').addEventListener('pointerup', () => {
    if (!scene6Ready || scenes.current !== 'scene-six') return;
    buzz(10);
    scenes.go('scene-seven');
  });

  /* ───────────────────────── scene 7 · rose wreath ───────────────────────── */
  (() => {
    const w = document.getElementById('wreath');
    const n = 10;
    for (let i = 0; i < n; i++) {
      const s = svgEl('svg', { viewBox: '0 0 100 100' });
      const u = svgEl('use'); u.setAttributeNS(XLINK, 'xlink:href', '#rose'); u.setAttribute('href', '#rose');
      s.appendChild(u);
      const big = i % 2 === 0;
      s.style.cssText = `--size:${big ? 46 : 38}px;--a:${(i / n * 360).toFixed(1)}deg;--tilt:${rnd(-25, 25).toFixed(1)}deg;` +
        `color:${big ? '#ef7f9f' : '#f6efe3'}`;
      w.appendChild(s);
    }
  })();
  const wreathScene = document.getElementById('scene-seven');
  document.addEventListener('scene:enter', e => {
    if (e.detail !== 'scene-seven') return;
    wreathScene.classList.remove('is-out');
    setTimeout(() => wreathScene.classList.add('is-out'), 3000);
    setTimeout(() => scenes.go('scene-eight'), 3650);
  });

  /* ───────────────────────── scene 8 · photo wall ───────────────────────── */
  // drop her photos into assets/photos/ as 1.jpg … 8.jpg (any of jpg/jpeg/png)
  const PHOTO_COUNT = 8;
  function buildPhotoWall() {
    const wall = document.getElementById('photoWall');
    wall.innerHTML = '';
    const W = window.innerWidth, H = window.innerHeight;
    const cols = W > 700 ? 4 : 2;
    const rows = Math.ceil(PHOTO_COUNT / cols);
    const areaH = H * 0.66;
    const cellW = W / cols, cellH = areaH / rows;
    const order = [...Array(PHOTO_COUNT).keys()].sort(() => Math.random() - 0.5); // scrambled drop order
    for (let i = 0; i < PHOTO_COUNT; i++) {
      const col = i % cols, row = (i / cols) | 0;
      const portrait = Math.random() < 0.65;
      const w = Math.min(cellW * (portrait ? 0.72 : 0.86), 220);
      const h = portrait ? w * 1.22 : w * 0.78;
      const x = clamp(col * cellW + (cellW - w) / 2 + rnd(-cellW * 0.1, cellW * 0.1), 8, W - w - 8);
      const y = H * 0.03 + row * cellH + (cellH - h) / 2 + rnd(-cellH * 0.1, cellH * 0.1);
      const card = document.createElement('figure');
      card.className = 'pcard';
      card.style.cssText = `--w:${w.toFixed(0)}px;--h:${h.toFixed(0)}px;--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;` +
        `--r:${rnd(-11, 11).toFixed(1)}deg;--d:${(0.3 + order[i] * 0.3).toFixed(2)}s;z-index:${order[i]}`;
      const img = document.createElement('img');
      img.alt = '';
      img.addEventListener('load', () => card.classList.add('has-img'));
      // try jpg, then jpeg, then png
      const exts = ['jpg', 'jpeg', 'png', 'JPG', 'PNG'];
      let k = 0;
      img.addEventListener('error', () => { k++; if (k < exts.length) img.src = `assets/photos/${i + 1}.${exts[k]}`; });
      img.src = `assets/photos/${i + 1}.${exts[0]}`;
      const ph = document.createElement('div');
      ph.className = 'ph';
      const hs = svgEl('svg', { viewBox: '0 0 100 95' });
      const hu = svgEl('use', { fill: '#fff' }); hu.setAttributeNS(XLINK, 'xlink:href', '#leaf'); hu.setAttribute('href', '#leaf');
      hs.appendChild(hu); ph.appendChild(hs);
      card.appendChild(img); card.appendChild(ph);
      wall.appendChild(card);
    }
  }
  buildPhotoWall();
  window.addEventListener('resize', () => { if (scenes.current !== 'scene-eight') buildPhotoWall(); });

  let scene8Ready = false;
  document.addEventListener('scene:enter', e => {
    if (e.detail === 'scene-eight') setTimeout(() => { scene8Ready = true; }, 4400);
  });
  document.getElementById('scene-eight').addEventListener('pointerup', () => {
    if (!scene8Ready || scenes.current !== 'scene-eight') return;
    buzz(10);
    scenes.go('scene-nine');
  });

  /* ═══════════════════════════ THE MUSEUM ═══════════════════════════ */

  // ---- shared photo loading (real file if present, pretty placeholder if not) ----
  const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'JPG', 'PNG'];
  const photoCache = new Map();
  function placeholderImage(n) {
    const c = document.createElement('canvas'); c.width = 600; c.height = 600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 600, 600);
    g.addColorStop(0, '#ffd6e0'); g.addColorStop(.55, '#ffb8c9'); g.addColorStop(1, '#ffc9a8');
    x.fillStyle = g; x.fillRect(0, 0, 600, 600);
    x.save(); x.translate(300, 290); x.fillStyle = 'rgba(255,255,255,.55)'; heartPath(x, 260); x.fill(); x.restore();
    x.fillStyle = 'rgba(120,40,70,.55)'; x.font = '600 26px Jost, sans-serif'; x.textAlign = 'center';
    x.fillText(`photo ${n}`, 300, 470);
    return c.toDataURL('image/png');
  }
  function getPhoto(i) {
    if (photoCache.has(i)) return photoCache.get(i);
    const p = new Promise(resolve => {
      let k = 0;
      const tryNext = () => {
        if (k >= PHOTO_EXTS.length) return resolve(placeholderImage(i + 1));
        const im = new Image();
        im.onload = () => resolve(im.src);
        im.onerror = () => { k++; tryNext(); };
        im.src = `assets/photos/${i + 1}.${PHOTO_EXTS[k]}`;
      };
      tryNext();
    });
    photoCache.set(i, p);
    return p;
  }

  // ---- room progress dots ----
  const ROOM_SCENES = ['scene-ten', 'scene-eleven', 'scene-twelve', 'scene-fourteen'];
  const ROOM_COUNT = ROOM_SCENES.length;
  document.getElementById('roomCount').textContent = ROOM_COUNT;
  document.querySelectorAll('.museum[data-room]').forEach(sec => {
    const room = +sec.dataset.room;
    const box = sec.querySelector('.room-dots');
    if (!box) return;
    for (let r = 1; r <= ROOM_COUNT; r++) {
      const i = document.createElement('i');
      if (r < room) i.className = 'done';
      else if (r === room) i.className = 'current';
      box.appendChild(i);
    }
  });

  // ---- extra sounds ----
  function sfxKnock() {
    try {
      const a = audioCtx(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.18);
      const len = Math.floor(a.sampleRate * 0.05), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const s = a.createBufferSource(); s.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const ng = a.createGain(); ng.gain.value = 0.5;
      s.connect(f).connect(ng).connect(a.destination); s.start(t);
    } catch (_) {}
  }
  function sfxTick(freq = 1200) {
    try {
      const a = audioCtx(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.16);
    } catch (_) {}
  }
  function sfxPaper() {
    try {
      const a = audioCtx(), t = a.currentTime;
      const len = Math.floor(a.sampleRate * 0.4), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) { const u = i / len; d[i] = (Math.random() * 2 - 1) * Math.sin(u * Math.PI) * 0.6; }
      const s = a.createBufferSource(); s.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
      const g = a.createGain(); g.gain.value = 0.18;
      s.connect(f).connect(g).connect(a.destination); s.start(t);
    } catch (_) {}
  }

  // ---- scene 9 · the door ----
  const doorFrame = document.getElementById('doorFrame');
  const door = document.getElementById('door');
  const knockDots = document.querySelectorAll('#knocks i');
  let knocks = 0, doorOpen = false;
  door.addEventListener('pointerdown', () => {
    if (doorOpen || scenes.current !== 'scene-nine') return;
    knocks++;
    sfxKnock(); buzz(30);
    door.classList.remove('is-knock'); void door.offsetWidth; door.classList.add('is-knock');
    if (knockDots[knocks - 1]) knockDots[knocks - 1].classList.add('on');
    if (knocks >= 3) {
      doorOpen = true;
      setTimeout(() => {
        doorFrame.classList.add('is-open');
        sfxPop(); buzz([15, 40, 25]);
        document.getElementById('doorFoot').textContent = 'walking you in…';
      }, 550);
      setTimeout(() => scenes.go('scene-ten'), 5400);
    }
  });

  // ---- room 1 · scratch-off gallery ----
  // which photos hang in the gallery (1-based numbers), and an optional title for each
  const GALLERY_PHOTOS = [8];                            // the scratch-off photo (assets/photos/8.jpg — the blue-kurta garden one)
  const GALLERY_FALLBACK = 6;                            // only used if that file ever goes missing
  const GALLERY_TITLES = ['Us, on a special day'];       // title shown under the frame
  const frameInner = document.getElementById('frameInner');
  const galImg = document.getElementById('galImg');
  const scratch = document.getElementById('scratch');
  const sctx = scratch.getContext('2d');
  const galRevealed = new Array(GALLERY_PHOTOS.length).fill(false);
  let galIndex = 0, scratching = false, scratchLast = null, scratchMoves = 0;
  if (GALLERY_PHOTOS.length < 2) document.querySelector('.gal-nav').classList.add('is-hidden');

  function paintCover() {
    const r = frameInner.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scratch.width = Math.round(r.width * dpr); scratch.height = Math.round(r.height * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    const g = sctx.createLinearGradient(0, 0, r.width, r.height);
    g.addColorStop(0, '#efc3a9'); g.addColorStop(.5, '#dfa07a'); g.addColorStop(1, '#f3cfb0');
    sctx.fillStyle = g; sctx.fillRect(0, 0, r.width, r.height);
    sctx.fillStyle = 'rgba(255,255,255,.2)';
    for (let i = 0; i < 40; i++) {
      sctx.save(); sctx.translate(rnd(0, r.width), rnd(0, r.height)); sctx.rotate(rnd(-.5, .5));
      heartPath(sctx, rnd(8, 18)); sctx.fill(); sctx.restore();
    }
  }
  function showGallery(i) {
    galIndex = i;
    const n = GALLERY_PHOTOS.length;
    document.getElementById('galCount').textContent = `${i + 1} / ${n}`;
    document.getElementById('galTitle').textContent = GALLERY_TITLES[i] || 'Untitled';
    document.getElementById('galMeta').textContent = n > 1 ? `Moment ${i + 1} · from the secret collection` : 'from the secret collection';
    if (!galRevealed[i]) {
      // cover first, instantly (no fade-in), so the photo is never seen before it's hidden
      paintCover();
      scratch.style.transition = 'none';
      frameInner.classList.remove('is-revealed');
      void scratch.offsetWidth;
      scratch.style.transition = '';
    } else {
      frameInner.classList.add('is-revealed');
    }
    getPhoto(GALLERY_PHOTOS[i] - 1).then(src => {
      if (galIndex !== i) return;
      if (src.startsWith('data:')) getPhoto(GALLERY_FALLBACK - 1).then(s2 => { if (galIndex === i) galImg.src = s2; });
      else galImg.src = src;
    });
  }
  function scratchPoint(e) {
    const r = scratch.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function scratchAt(p) {
    sctx.globalCompositeOperation = 'destination-out';
    sctx.lineWidth = 46; sctx.lineCap = 'round'; sctx.lineJoin = 'round';
    sctx.strokeStyle = '#000';
    sctx.beginPath();
    sctx.moveTo(scratchLast ? scratchLast.x : p.x, scratchLast ? scratchLast.y : p.y);
    sctx.lineTo(p.x, p.y);
    sctx.stroke();
    scratchLast = p;
  }
  function revealedRatio() {
    const { width, height } = scratch;
    const data = sctx.getImageData(0, 0, width, height).data;
    let clear = 0, total = 0;
    for (let y = 0; y < height; y += 6) for (let x = 0; x < width; x += 6) {
      total++; if (data[(y * width + x) * 4 + 3] < 128) clear++;
    }
    return clear / total;
  }
  scratch.addEventListener('pointerdown', e => {
    scratching = true; scratchLast = null; scratchMoves = 0;
    try { scratch.setPointerCapture(e.pointerId); } catch (_) {}
    frameInner.classList.add('is-scratching');
    scratchAt(scratchPoint(e));
  });
  scratch.addEventListener('pointermove', e => {
    if (!scratching) return;
    scratchAt(scratchPoint(e));
    if (++scratchMoves % 10 === 0 && revealedRatio() > 0.5) {
      scratching = false;
      galRevealed[galIndex] = true;
      frameInner.classList.add('is-revealed');
      sfxPop(); buzz([10, 30, 20]);
    }
  });
  const endScratch = () => { scratching = false; scratchLast = null; frameInner.classList.remove('is-scratching'); };
  scratch.addEventListener('pointerup', endScratch);
  scratch.addEventListener('pointercancel', endScratch);
  document.getElementById('galPrev').addEventListener('click', () => { sfxTick(900); showGallery((galIndex - 1 + GALLERY_PHOTOS.length) % GALLERY_PHOTOS.length); });
  document.getElementById('galNext').addEventListener('click', () => { sfxTick(1100); showGallery((galIndex + 1) % GALLERY_PHOTOS.length); });
  document.getElementById('galDone').addEventListener('click', () => { buzz(10); scenes.go('scene-eleven'); });
  document.addEventListener('scene:enter', e => { if (e.detail === 'scene-ten') setTimeout(() => showGallery(0), 50); });
  window.addEventListener('resize', () => { if (scenes.current === 'scene-ten' && !galRevealed[galIndex]) paintCover(); });

  // ---- room 2 · 9-piece swap puzzle ----
  const PUZZLE_PHOTO = 6;                 // which photo (1-based) "fell apart" — the green shirt, thumbs-up one
  const puzzle = document.getElementById('puzzle');
  const puzzlePeek = document.getElementById('puzzlePeek');
  let order = [], tiles = [], pzMoves = 0, pzSolved = false, pzSelected = -1, pzTimer = 0, pzStart = 0;

  function pzPlace() {
    tiles.forEach((t, idx) => {
      const p = order.indexOf(idx);
      t.style.transform = `translate(${(p % 3) * 100}%, ${((p / 3) | 0) * 100}%)`;
    });
  }
  function pzShuffle() {
    // gentle: just one or two pieces swapped out of place, so it's a sweet moment, not a chore
    order = [...Array(9).keys()];
    const pick = (avoid) => { let p; do { p = (Math.random() * 9) | 0; } while (avoid.includes(p)); return p; };
    const a = pick([]), b = pick([a]);
    [order[a], order[b]] = [order[b], order[a]];
    if (Math.random() < 0.6) {
      const c = pick([a, b]), d = pick([a, b, c]);
      [order[c], order[d]] = [order[d], order[c]];
    }
  }
  // if she's stuck for a while, light up the two pieces that need swapping
  let pzHintTimer = 0;
  const pzHintEl = document.getElementById('pzHint');
  function pzClearHint() {
    tiles.forEach(t => t.classList.remove('is-hint'));
    pzHintEl.classList.remove('is-on');
  }
  function pzArmHint() {
    clearTimeout(pzHintTimer); pzClearHint();
    if (pzSolved) return;
    pzHintTimer = setTimeout(() => {
      if (pzSolved) return;
      const wrongPos = order.findIndex((v, i) => v !== i);
      if (wrongPos < 0) return;
      const tileIdx = order[wrongPos];            // this piece belongs at position tileIdx
      tiles[tileIdx].classList.add('is-hint');
      tiles[order[tileIdx]].classList.add('is-hint');   // …and this one is sitting in its spot
      pzHintEl.textContent = 'Psst… tap the two glowing pieces';
      pzHintEl.classList.add('is-on');
      sfxTick(900); buzz(8);
    }, 15000);
  }
  function pzCheck() {
    if (!order.every((v, i) => v === i)) return;
    pzSolved = true;
    clearInterval(pzTimer);
    clearTimeout(pzHintTimer); pzClearHint();
    puzzle.classList.add('is-solved');
    const r = puzzle.getBoundingClientRect();
    setTimeout(() => { sfxPop(); buzz([20, 40, 60]); burst(r.left + r.width / 2, r.top + r.height / 2, 110); }, 350);
    setTimeout(() => document.getElementById('pzDone').classList.remove('is-hidden'), 1300);
  }
  function pzSwap(pa, pb) {
    if (pa === pb) return;
    [order[pa], order[pb]] = [order[pb], order[pa]];
    pzMoves++;
    document.getElementById('pzMoves').textContent = pzMoves;
    sfxTick(700); buzz(8);
    pzPlace();
    pzCheck();
    pzArmHint();
  }
  function buildPuzzle(src) {
    puzzle.innerHTML = ''; tiles = []; pzMoves = 0; pzSolved = false; pzSelected = -1;
    puzzle.classList.remove('is-solved');
    document.getElementById('pzMoves').textContent = '0';
    document.getElementById('pzDone').classList.add('is-hidden');
    puzzlePeek.style.backgroundImage = `url("${src}")`;
    pzShuffle();
    for (let idx = 0; idx < 9; idx++) {
      const t = document.createElement('div'); t.className = 'tile';
      const inner = document.createElement('div');
      inner.style.backgroundImage = `url("${src}")`;
      inner.style.backgroundPosition = `${(idx % 3) * 50}% ${((idx / 3) | 0) * 50}%`;
      t.appendChild(inner);
      t.dataset.idx = idx;
      tiles.push(t); puzzle.appendChild(t);
    }
    pzPlace();
    pzArmHint();
  }
  // tap-to-swap and pzDrag-to-swap share one pointer flow
  let pzDrag = null;
  puzzle.addEventListener('pointerdown', e => {
    if (pzSolved) return;
    const t = e.target.closest('.tile'); if (!t) return;
    pzDrag = { tile: t, idx: +t.dataset.idx, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
    try { puzzle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  puzzle.addEventListener('pointermove', e => {
    if (!pzDrag || e.pointerId !== pzDrag.id) return;
    const dx = e.clientX - pzDrag.x0, dy = e.clientY - pzDrag.y0;
    if (!pzDrag.moved && Math.hypot(dx, dy) < 8) return;
    if (!pzDrag.moved) {
      pzDrag.moved = true;
      pzDrag.tile.classList.add('is-dragging');
      tiles.forEach(t => t.classList.remove('is-selected')); pzSelected = -1;
      const cell = puzzle.getBoundingClientRect().width / 3;
      const p = order.indexOf(pzDrag.idx);
      pzDrag.bx = (p % 3) * cell; pzDrag.by = ((p / 3) | 0) * cell;
    }
    pzDrag.tile.style.transform = `translate(${pzDrag.bx + dx}px, ${pzDrag.by + dy}px)`;
  });
  const endDrag = e => {
    if (!pzDrag || e.pointerId !== pzDrag.id) return;
    const d = pzDrag; pzDrag = null;
    const pos = order.indexOf(d.idx);
    if (d.moved) {
      const r = puzzle.getBoundingClientRect(), cell = r.width / 3;
      const col = clamp(((e.clientX - r.left) / cell) | 0, 0, 2), row = clamp(((e.clientY - r.top) / cell) | 0, 0, 2);
      const target = row * 3 + col;
      requestAnimationFrame(() => { d.tile.classList.remove('is-dragging'); target !== pos ? pzSwap(pos, target) : pzPlace(); });
    } else {
      // plain tap: select, then swap with the next tapped tile
      if (pzSelected < 0) { pzSelected = pos; d.tile.classList.add('is-selected'); sfxTick(1000); }
      else if (pzSelected === pos) { pzSelected = -1; d.tile.classList.remove('is-selected'); }
      else { const a = pzSelected; pzSelected = -1; tiles.forEach(t => t.classList.remove('is-selected')); pzSwap(a, pos); }
    }
  };
  puzzle.addEventListener('pointerup', endDrag);
  puzzle.addEventListener('pointercancel', endDrag);
  const peekBtn = document.getElementById('pzPeek');
  const peekOn = e => { e.preventDefault(); puzzlePeek.classList.add('is-on'); };
  const peekOff = () => puzzlePeek.classList.remove('is-on');
  peekBtn.addEventListener('pointerdown', peekOn);
  peekBtn.addEventListener('pointerup', peekOff);
  peekBtn.addEventListener('pointercancel', peekOff);
  peekBtn.addEventListener('pointerleave', peekOff);
  peekBtn.addEventListener('contextmenu', e => e.preventDefault());
  document.getElementById('pzDone').addEventListener('click', () => { buzz(10); scenes.go('scene-twelve'); });
  document.addEventListener('scene:enter', e => {
    if (e.detail !== 'scene-eleven') return;
    getPhoto(PUZZLE_PHOTO - 1).then(buildPuzzle);
    clearInterval(pzTimer); pzStart = Date.now();
    document.getElementById('pzTime').textContent = '0:00';
    pzTimer = setInterval(() => {
      const s = ((Date.now() - pzStart) / 1000) | 0;
      document.getElementById('pzTime').textContent = `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  });

  // ---- room 3 · envelope ----
  const envelope = document.getElementById('envelope');
  let envOpened = false;
  envelope.addEventListener('pointerup', () => {
    if (envOpened || scenes.current !== 'scene-twelve') return;
    envOpened = true;
    envelope.classList.add('is-open');
    sfxPaper(); buzz(15);
    setTimeout(() => scenes.go('scene-thirteen'), 1900);
  });

  // ---- room 3 · the letter (edit these lines — they're your words to her) ----
  const LETTER = [
    'Hey Tisuu rani ❤️',
    "I don't think I tell you this enough, but meeting you has been the best thing that's ever happened to me.",
    "Thank you for being patient with me, for making me laugh, for listening to my endless talks, and for loving me even on the days I'm difficult.",
    "No matter how busy life gets, I hope you always remember one thing… you'll always be my favourite person, babe. 🫶",
    'Happy birthday, my Tisuu rani. I love you more than words can ever explain. ❤️',
    '— Rupu'
  ];
  (() => {
    const paper = document.getElementById('paper');
    LETTER.forEach((line, i) => {
      const p = document.createElement('p');
      p.textContent = line;
      p.style.setProperty('--d', (0.5 + i * 0.55) + 's');
      if (i === LETTER.length - 1) p.className = 'sign';
      paper.appendChild(p);
    });
  })();
  // voice note: the player is always there; drop assets/voice/letter.mp3 and it plays
  (() => {
    const box = document.getElementById('voice');
    const au = document.getElementById('voiceAudio');
    const btn = document.getElementById('voicePlay');
    const wave = document.getElementById('voiceWave');
    const time = document.getElementById('voiceTime');
    const fmt = s => `${(s / 60) | 0}:${String((s % 60) | 0).padStart(2, '0')}`;
    const BARS = 30, bars = [];
    for (let i = 0; i < BARS; i++) {
      const b = document.createElement('i');
      const h = 5 + Math.abs(Math.sin(i * 0.9) * 9 + Math.sin(i * 2.3) * 4);
      b.style.setProperty('--h', h.toFixed(1) + 'px'); b.style.setProperty('--i', i);
      wave.appendChild(b); bars.push(b);
    }
    const setProgress = p => bars.forEach((b, i) => b.classList.toggle('on', i / BARS < p));
    let ready = false;
    au.addEventListener('loadedmetadata', () => { ready = true; time.textContent = fmt(au.duration); });
    // the music steps aside completely while her voice note plays, then eases back in
    let fadeT = 0;
    const fadeMusic = (to, ms, done) => {
      clearInterval(fadeT);
      const from = bgm.volume, steps = Math.max(1, Math.round(ms / 40));
      let i = 0;
      fadeT = setInterval(() => {
        i++; bgm.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
        if (i >= steps) { clearInterval(fadeT); done && done(); }
      }, 40);
    };
    const musicOff = () => fadeMusic(0, 400, () => bgm.pause());
    const musicOn = () => { if (musicStarted) { bgm.play().catch(() => {}); fadeMusic(MUSIC_VOL, 900); } };
    btn.addEventListener('click', () => {
      if (!ready) { box.classList.remove('is-nudge'); void box.offsetWidth; box.classList.add('is-nudge'); return; }
      if (au.paused) { au.play().catch(() => {}); musicOff(); }
      else au.pause();
    });
    au.addEventListener('play', () => { btn.classList.add('is-playing'); box.classList.add('is-playing'); });
    au.addEventListener('pause', () => { btn.classList.remove('is-playing'); box.classList.remove('is-playing'); musicOn(); });
    au.addEventListener('ended', () => { btn.classList.remove('is-playing'); box.classList.remove('is-playing'); musicOn(); setProgress(0); time.textContent = fmt(au.duration); });
    au.addEventListener('timeupdate', () => { setProgress(au.currentTime / au.duration); time.textContent = fmt(au.duration - au.currentTime); });
  })();
  document.getElementById('letterDone').addEventListener('click', () => { buzz(10); scenes.go('scene-fourteen'); });

  // ---- room 4 · promises ----
  const PROMISES = [
    'Always love me, every single day',
    'Your birthday wish becomes my to-do list',
    'Celebrate you the whole week, not just one day',
    'Never let a birthday of yours pass without me beside you',
    'Make every birthday after this one even bigger'
  ];
  const promisesBox = document.getElementById('promises');
  (() => {
    const ul = document.getElementById('promiseList');
    PROMISES.forEach((text, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<i></i><span>${i + 1}. ${text}</span>`;
      li.addEventListener('click', () => {
        li.classList.toggle('is-on');
        if (li.classList.contains('is-on')) { sfxTick(1300); buzz(8); }
      });
      ul.appendChild(li);
    });
  })();
  let official = false;
  document.getElementById('promiseDone').addEventListener('click', () => {
    if (official) return;
    if (!promisesBox.querySelector('li.is-on')) {
      promisesBox.classList.remove('is-shake'); void promisesBox.offsetWidth; promisesBox.classList.add('is-shake');
      buzz([20, 30, 20]);
      return;
    }
    official = true;
    promisesBox.classList.add('is-official');
    sfxKnock(); buzz([30, 40, 80]);
    const r = promisesBox.getBoundingClientRect();
    setTimeout(() => { sfxPop(); burst(r.left + r.width / 2, r.top + r.height / 2, 120); }, 350);
    setTimeout(() => scenes.go('scene-fifteen'), 1900);
  });

  /* ───────────────────────── scene 15 · the last room · make a wish ───────────────────────── */
  const wishScene = document.getElementById('scene-fifteen');
  const CANDLE_COUNT = 17;                          // she's turning 17
  let candles = [], blowOrder = [], blown = 0, wishDone = false, holdTimer = 0, micStream = null, micRaf = 0, finaleTimer = 0;

  function fadeBgm(to, ms) {
    const from = bgm.volume, steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    const t = setInterval(() => { i++; bgm.volume = Math.max(0, Math.min(1, from + (to - from) * i / steps)); if (i >= steps) clearInterval(t); }, 40);
  }

  (() => {
    // night sky
    const stars = document.getElementById('stars');
    for (let i = 0; i < 90; i++) {
      const s = document.createElement('i');
      const size = rnd(1, 2.6);
      s.style.cssText = `left:${rnd(0, 100).toFixed(1)}%;top:${rnd(0, 70).toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;--d:${rnd(1.8, 4).toFixed(1)}s;--dl:${(-rnd(0, 4)).toFixed(1)}s`;
      stars.appendChild(s);
    }
    const dn = document.getElementById('driftsNight');
    const colors = ['#ffb3c6', '#ff8fab', '#ffd1dc', '#ffd23f'];
    for (let i = 0; i < 9; i++) {
      const s = svgEl('svg', { viewBox: '0 0 100 95' });
      const u = svgEl('use', { fill: colors[i % colors.length] });
      u.setAttributeNS(XLINK, 'xlink:href', '#leaf'); u.setAttribute('href', '#leaf');
      s.appendChild(u);
      const size = rnd(8, 18);
      s.style.cssText = `left:${(Math.random() < 0.5 ? rnd(2, 22) : rnd(76, 96)).toFixed(1)}%;width:${size}px;height:${size}px;` +
        `animation-duration:${rnd(10, 18).toFixed(1)}s;animation-delay:${(-rnd(0, 16)).toFixed(1)}s`;
      dn.appendChild(s);
    }
  })();

  function buildCandles() {
    const box = document.getElementById('candles');
    box.innerHTML = ''; candles = []; blown = 0; wishDone = false;
    const pal = [['#ffd6e0', '#ff7aa2'], ['#d9f2ff', '#5bb8ff'], ['#fff3c4', '#ffc93c'], ['#e4d4ff', '#9b7bff'], ['#d6ffe4', '#4fd18b']];
    const rows = [{ n: 9, b: 40, y: 0 }, { n: 8, b: 31, y: 1 }];   // back row of 9, front row of 8 = 17, standing on the top tier
    let idx = 0;
    for (const row of rows) {
      const gap = 160 / (row.n + 1);
      for (let i = 0; i < row.n; i++) {
        const c = document.createElement('div');
        c.className = 'candle';
        const p = pal[idx % pal.length];
        c.style.cssText = `--x:${(gap * (i + 1) - 3.5).toFixed(1)}px;--b:${row.b}px;--c1:${p[0]};--c2:${p[1]};--fd:${(-Math.random()).toFixed(2)}s;z-index:${row.y}`;
        c.innerHTML = '<i class="wick"></i><i class="flame"></i><i class="smoke"></i>';
        box.appendChild(c); candles.push(c); idx++;
      }
    }
    blowOrder = [...candles.keys()].sort(() => Math.random() - 0.5);
  }

  function sfxPuff() {
    try {
      const a = audioCtx(), t = a.currentTime;
      const len = Math.floor(a.sampleRate * 0.12), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const s = a.createBufferSource(); s.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = a.createGain(); g.gain.value = 0.25;
      s.connect(f).connect(g).connect(a.destination); s.start(t);
    } catch (_) {}
  }

  function blowOne() {
    if (wishDone || blown >= CANDLE_COUNT) return;
    const c = candles[blowOrder[blown++]];
    c.classList.add('is-out');
    sfxPuff(); buzz(6);
    if (blown >= CANDLE_COUNT) finishWish();
  }

  function stopMic() {
    cancelAnimationFrame(micRaf);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    wishScene.classList.remove('is-listening');
  }

  // listen on the mic: a puff of breath is a loud, broadband burst
  async function startBlowListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (_) { return false; }
    const a = audioCtx();
    const src = a.createMediaStreamSource(micStream);
    const an = a.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.5;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let hot = 0, floor = 0.02;
    const loop = () => {
      if (!micStream) return;
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      floor = Math.min(floor * 1.002, rms) ;            // quiet level drifts with the room
      if (rms > Math.max(0.06, floor * 4)) { hot++; if (hot % 3 === 0) blowOne(); } else hot = 0;
      micRaf = requestAnimationFrame(loop);
    };
    loop();
    return true;
  }

  function launchFireworks(rounds) {
    let i = 0;
    const go = () => {
      if (scenes.current !== 'scene-fifteen') return;
      burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.1, H * 0.5), 80);
      if (i % 2 === 0) sfxFirework(i < 4);           // a few whoosh-booms, then softer booms
      if (++i < rounds) setTimeout(go, rnd(380, 680));
    };
    go();
  }
  function rainHearts(n) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: rnd(0, W), y: rnd(-H * 0.6, -10), vx: rnd(-0.4, 0.4), vy: rnd(1, 2.4), g: 0.01, drag: 1,
        life: 1, decay: 0.0025, size: rnd(7, 15), rot: rnd(0, 6), vr: rnd(-0.05, 0.05),
        color: PALETTE[(Math.random() * PALETTE.length) | 0], kind: 'heart'
      });
    }
    if (!fxRunning) { fxRunning = true; requestAnimationFrame(tickFx); }
  }

  function finishWish() {
    wishDone = true;
    stopMic();
    clearInterval(holdTimer);
    wishScene.classList.add('is-dark');
    buzz([30, 60, 30]);
    setTimeout(() => {
      launchFireworks(14);
      rainHearts(120);
      fadeBgm(Math.min(0.5, MUSIC_VOL * 2.2), 1800);
      setTimeout(() => wishScene.classList.add('is-finale'), 1500);
      // the sky keeps sparkling softly while she reads
      clearInterval(finaleTimer);
      finaleTimer = setInterval(() => {
        if (scenes.current !== 'scene-fifteen') { clearInterval(finaleTimer); return; }
        burst(rnd(W * 0.1, W * 0.9), rnd(H * 0.05, H * 0.4), 40);
        rainHearts(10);
      }, 2600);
    }, 1000);
  }

  // press-and-hold on the cake blows them out too (and is the fallback when the mic says no)
  const cakeStage = document.getElementById('cakeStage');
  cakeStage.addEventListener('pointerdown', e => {
    if (wishDone) return;
    try { cakeStage.setPointerCapture(e.pointerId); } catch (_) {}
    clearInterval(holdTimer);
    blowOne();
    holdTimer = setInterval(blowOne, 150);
  });
  const stopHold = () => clearInterval(holdTimer);
  cakeStage.addEventListener('pointerup', stopHold);
  cakeStage.addEventListener('pointercancel', stopHold);
  cakeStage.addEventListener('contextmenu', e => e.preventDefault());

  document.getElementById('blowBtn').addEventListener('click', async () => {
    const btn = document.getElementById('blowBtn');
    if (micStream || wishDone) return;
    btn.textContent = 'Listening… blow!';
    wishScene.classList.add('is-listening');
    const ok = await startBlowListening();
    if (!ok) {
      wishScene.classList.remove('is-listening');
      btn.textContent = 'Press and hold the cake';
      document.getElementById('wishSub').textContent = 'No mic this time — press and hold the cake to blow them out.';
    }
  });
  // "start again" — but not before she's found the moon
  (() => {
    const btn = document.getElementById('replayBtn');
    const miss = document.getElementById('missNote');
    let warned = false;
    btn.addEventListener('click', () => {
      const moonWrap = document.getElementById('moonWrap');
      if (!moonWrap.classList.contains('is-found') && !warned) {
        warned = true;
        miss.classList.add('is-on');
        moonWrap.classList.add('is-nudged');           // the moon starts calling right away
        btn.textContent = 'Start again anyway ♥';
        btn.classList.remove('is-shake'); void btn.offsetWidth; btn.classList.add('is-shake');
        sfxTick(500); buzz([20, 40, 20]);
        return;
      }
      buzz(10); location.reload();
    });
  })();

  // hidden note: tap the moon three times on the last page (edit the line — it's your private message)
  const HIDDEN_NOTE = "P.S. You're still my favourite notification. Always have been.";
  (() => {
    const moon = document.getElementById('moonWrap');
    const secret = document.getElementById('secret');
    document.getElementById('secretText').textContent = HIDDEN_NOTE;
    let taps = 0, tapT = 0;
    moon.addEventListener('pointerup', () => {
      clearTimeout(tapT);
      taps++;
      sfxTick(700 + taps * 150); buzz(8);
      moon.querySelector('.moon-hint').textContent = taps === 1 ? 'two more…' : taps === 2 ? 'one more…' : 'psst… tap the moon ×3';
      if (taps >= 3) {
        taps = 0;
        moon.classList.add('is-found');            // hints stop once she's found it
        secret.classList.add('is-on'); sfxSparkle(); buzz([15, 30, 40]);
        return;
      }
      tapT = setTimeout(() => { taps = 0; moon.querySelector('.moon-hint').textContent = 'psst… tap the moon ×3'; }, 1500);
    });
    document.getElementById('secretClose').addEventListener('click', () => secret.classList.remove('is-on'));
    secret.addEventListener('click', e => { if (e.target === secret) secret.classList.remove('is-on'); });
  })();

  document.addEventListener('scene:enter', e => {
    if (e.detail === 'scene-fifteen') {
      wishScene.classList.remove('is-dark', 'is-finale', 'is-listening');
      buildCandles();
    } else {
      stopMic(); clearInterval(holdTimer); clearInterval(finaleTimer);
    }
  });

  /* ───────────────────────── birthday lock ───────────────────────── */
  // Set BIRTHDAY_LOCK to true before sending her the link. Before LOCK_UNTIL she sees a countdown;
  // it unlocks itself at that moment. Opening the link with ?rupu at the end always skips it (for you).
  const BIRTHDAY_LOCK = false;
  const LOCK_UNTIL = '2026-10-22T00:00:00+05:30';
  (() => {
    const lock = document.getElementById('lock');
    const bypass = /[?&]rupu\b/.test(location.search);
    if (bypass) { try { localStorage.setItem('rupu-key', '1'); } catch (_) {} }
    let hasKey = false; try { hasKey = localStorage.getItem('rupu-key') === '1'; } catch (_) {}
    const until = new Date(LOCK_UNTIL).getTime();
    if (!BIRTHDAY_LOCK || bypass || hasKey || Date.now() >= until) return;
    lock.hidden = false;
    const stars = document.getElementById('lockStars');
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i');
      s.style.cssText = `left:${rnd(0, 100).toFixed(1)}%;top:${rnd(0, 100).toFixed(1)}%;--d:${rnd(1.8, 4).toFixed(1)}s;--dl:${(-rnd(0, 4)).toFixed(1)}s`;
      stars.appendChild(s);
    }
    const cells = {}; lock.querySelectorAll('[data-u]').forEach(b => { cells[b.dataset.u] = b; });
    const tick = () => {
      const left = Math.max(0, until - Date.now());
      const s = Math.floor(left / 1000);
      cells.d.textContent = Math.floor(s / 86400);
      cells.h.textContent = Math.floor(s / 3600) % 24;
      cells.m.textContent = Math.floor(s / 60) % 60;
      cells.s.textContent = s % 60;
      if (left <= 0) { clearInterval(t); lock.classList.add('is-open'); setTimeout(() => { lock.hidden = true; }, 1000); }
    };
    tick();
    const t = setInterval(tick, 1000);
  })();

  // dev helper: __go('scene-five') in the console jumps straight to a scene
  window.__go = id => scenes.go(id);

  /* ───────────────────────── boot ───────────────────────── */
  function onResize() { sizeCanvas(); layout(); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
  sizeCanvas();
  layout();
  // the heart bobs, so the aim line is re-measured once fonts/layout settle
  setTimeout(layout, 300);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
})();
