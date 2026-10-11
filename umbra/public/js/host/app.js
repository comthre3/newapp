// Umbra host: runs on the phone/laptop that is wired to the projector and owns the camera.
import qrcode from '/vendor/qrcode.mjs';
import { Stage } from './stage.js';
import { CameraSource } from './camera.js';
import { SimCamera, SimEditor } from './sim.js';
import { runCalibration } from './calibrate.js';
import { ShadowDetector } from '../core/vision-core.js';
import { World, GW, GH, CELL, W, H } from '../game/world.js';
import { LEVELS } from '../game/levels.js';
import { Effects, SceneRenderer } from '../game/render.js';
import { PAL } from '../game/palette.js';
import { Sfx } from '../game/audio.js';
import { Link, persistentToken, keepAwake } from '../net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const REVIEW = params.has('review');
const AUTO_SIM = params.has('sim');
const AUTO_LEVEL = params.has('auto') ? Number(params.get('auto')) : null;

// ------------------------------------------------------------------ core objects
const stage = new Stage($('#stage'));
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
const sfx = new Sfx();
const scene = new SceneRenderer();
let fx = new Effects();
const world = new World(LEVELS[0]);
const lobbyDemo = () => { world.load(LEVELS[0]); while (world.spawnOrb()); scene.reset(); };
lobbyDemo();

let mode = 'lobby';         // lobby | aim | calibrating | result | adjust | play | menu | clear
let levelIndex = 0;
let camera = null;
let editor = null;
let cal = null;             // accepted calibration {corners, black, white, cw, ch}
let lastCal = null;         // most recent calibration attempt
let detector = null;
let clearInfo = null;
let showMask = false;
let countdown = 0;
let visionAcc = 0;
let lastFrame = null;
let visionMs = 0;
let fps = 0;
let gmId = null;
let gmCounter = 0;
const kb = { left: false, right: false };
const preview = { canvas: document.createElement('canvas'), quad: null, drag: -1 };
preview.ctx = preview.canvas.getContext('2d');

// ------------------------------------------------------------------ UI helpers
let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function setMode(m) {
  mode = m;
  $('#lobby').hidden = m !== 'lobby';
  $('#aim').hidden = m !== 'aim';
  $('#result').hidden = !(m === 'result' || m === 'adjust');
  $('#clearbar').hidden = m !== 'clear';
  $('#menu').hidden = m !== 'menu';
  $('#menubtn').hidden = !(m === 'play' || m === 'clear');
  document.body.classList.toggle('adjusting', m === 'adjust');
  $('#btn-adjust').textContent = m === 'adjust' ? 'Done adjusting' : 'Adjust corners';
  $('#btn-accept').disabled = m === 'adjust';
  updateIgnore();
  pushState();
}

function updateIgnore() {
  if (!detector) return;
  const rects = [];
  for (const sel of ['#menubtn', '#debug', '#simbar', '#toast']) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    const [x0, y0] = stage.toWorld(r.left, r.top);
    const [x1, y1] = stage.toWorld(r.right, r.bottom);
    rects.push({ x: Math.floor(x0 / CELL) - 1, y: Math.floor(y0 / CELL) - 1, w: Math.ceil((x1 - x0) / CELL) + 2, h: Math.ceil((y1 - y0) / CELL) + 2 });
  }
  detector.setIgnore(rects);
}

// ------------------------------------------------------------------ players & network
const players = new Map();
let roomCode = '';
try { roomCode = sessionStorage.getItem('umbra.room') || ''; } catch { /* private mode */ }
const hostToken = persistentToken('umbra.hostToken');
const link = new Link(() => ({ role: 'host', token: hostToken, room: roomCode }), {
  onMessage: onNet,
  onStatus: (s) => { $('#netstatus').textContent = s === 'open' ? 'Connected to the relay ✓' : s === 'connecting' ? 'Connecting…' : 'Reconnecting…'; },
});

let shareBase = params.get('base') || location.origin;
const isLocalHost = /^(localhost|127\.|\[::1\])/.test(location.hostname);

function joinUrl() {
  return `${shareBase.replace(/\/$/, '')}/play.html?room=${roomCode}`;
}

function refreshJoin() {
  if (!roomCode) return;
  $('#joinurl').textContent = joinUrl().replace(/^https?:\/\//, '');
  drawQR(joinUrl());
}

// opened on localhost (laptop host)? then phones need this machine's Wi-Fi address instead
if (isLocalHost && !params.get('base')) {
  fetch('/api/info').then((r) => r.json()).then(({ lan }) => {
    if (lan && lan.length) {
      shareBase = lan[0];
      $('#lobbytip').textContent = `Phones join at ${lan[0].replace(/^https?:\/\//, '')} — they must be on the same Wi-Fi as this computer.`;
      refreshJoin();
    }
  }).catch(() => {});
}

function drawQR(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const c = $('#qr');
  const ctx = c.getContext('2d');
  const cell = Math.floor(c.width / (n + 4));
  const off = Math.floor((c.width - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) ctx.fillRect(off + q * cell, off + r * cell, cell, cell);
}

function renderPlayers() {
  const ul = $('#players');
  ul.textContent = '';
  if (!players.size) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Waiting for players… (you can also play alone)';
    ul.append(li);
    return;
  }
  for (const p of players.values()) {
    const li = document.createElement('li');
    if (!p.online) li.className = 'off';
    const dot = document.createElement('i');
    dot.style.background = p.color;
    li.append(dot, document.createTextNode(p.name));
    ul.append(li);
  }
}

const online = () => [...players.values()].filter((p) => p.online);

function phase() {
  return mode === 'play' ? 'play' : mode === 'clear' ? 'clear' : mode === 'menu' ? 'pause' : 'lobby';
}

function stateFor(p) {
  const lv = world.level;
  return {
    phase: phase(),
    level: { id: lv.id, name: lv.name, hint: lv.hint || '', idx: levelIndex, total: LEVELS.length, sandbox: !!lv.sandbox },
    axis: world.gravity[1] !== 0 ? 'h' : 'v',
    canGravity: !!lv.gravity,
    gm: p.id === gmId,
    gmName: players.get(gmId)?.name || '',
    switches: (lv.switches || []).map((s) => ({ key: s.key, label: s.label, on: !!world.switches[s.key] })),
    canSpawn: (lv.orbs || 1) > 1,
    stars: world.starsTaken, totalStars: world.stars.length,
    gravity: world.gravity,
  };
}

function pushState(onlyId) {
  for (const p of players.values()) {
    if (!p.online || (onlyId && p.id !== onlyId)) continue;
    link.send({ t: 'to', id: p.id, m: stateFor(p) });
  }
}

function buzz(pattern, id) {
  if (id) link.send({ t: 'to', id, m: { vib: pattern } });
  else link.send({ t: 'all', m: { vib: pattern } });
}

function pickGravityMaster() {
  const ids = online().map((p) => p.id);
  gmId = ids.length ? ids[gmCounter++ % ids.length] : null;
}

function onNet(m) {
  switch (m.t) {
    case 'room':
      roomCode = m.code;
      try { sessionStorage.setItem('umbra.room', roomCode); } catch { /* ignore */ }
      $('#roomcode').textContent = roomCode;
      refreshJoin();
      if (isLocalHost && shareBase === location.origin) {
        $('#lobbytip').textContent = 'You opened this page via localhost and no Wi-Fi address was found — phones cannot reach localhost. See README → "Connecting phones".';
      }
      break;
    case 'join': {
      const prev = players.get(m.id);
      players.set(m.id, { id: m.id, name: m.name, color: m.color, online: true, nudge: 0, nudgeAt: 0, lastAt: 0, ...(prev ? { nudge: 0 } : {}) });
      renderPlayers();
      if (!m.reconnect) { sfx.play('join'); toast(`${m.name} joined`); }
      if (gmId === null) pickGravityMaster();
      pushState();
      break;
    }
    case 'leave': {
      const p = players.get(m.id);
      if (p) { p.online = false; p.nudge = 0; }
      if (gmId === m.id) pickGravityMaster();
      renderPlayers();
      pushState();
      break;
    }
    case 'in': onInput(m); break;
    case 'err':
      toast(m.msg === 'replaced' ? 'This host page was opened somewhere else.' : `Relay: ${m.msg}`, 5000);
      break;
    default:
  }
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
let lastGrav = 0;

function onInput({ id, k, v }) {
  const p = players.get(id);
  if (!p) return;
  const now = performance.now();
  switch (k) {
    case 'nudge':
      p.nudge = v === 1 || v === -1 ? v : 0;
      p.nudgeAt = now;
      break;
    case 'grav':
      if (mode !== 'play' || !world.level.gravity || !DIRS[v]) break;
      if (id !== gmId && online().length > 0) break;
      if (now - lastGrav < 350) break;
      lastGrav = now;
      world.setGravity(DIRS[v]);
      break;
    case 'sw':
      if (mode === 'play' && typeof v === 'string') world.setSwitch(v);
      break;
    case 'reset':
      if (mode === 'play' && now - (p.lastAt || 0) > 500) { p.lastAt = now; world.resetOrbs(); }
      break;
    case 'spawn':
      if (mode === 'play') world.spawnOrb();
      break;
    case 'next':
      if (mode === 'clear' || (mode === 'play' && world.level.sandbox)) nextLevel();
      break;
    default:
  }
}

function sumNudge() {
  const now = performance.now();
  let s = (kb.right ? 1 : 0) - (kb.left ? 1 : 0);
  for (const p of players.values()) if (p.online && p.nudge && now - p.nudgeAt < 800) s += p.nudge;
  return Math.max(-1, Math.min(1, s));
}

// ------------------------------------------------------------------ levels
function startLevel(i) {
  levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
  world.load(LEVELS[levelIndex]);
  world.shadow.fill(0);
  fx = new Effects();
  scene.reset();
  pickGravityMaster();
  setMode('play');
  toast(LEVELS[levelIndex].name, 1800);
}

function nextLevel() {
  startLevel(levelIndex + 1 >= LEVELS.length ? 1 : levelIndex + 1);
}

function toLobby() {
  lobbyDemo();
  fx = new Effects();
  setMode('lobby');
}

// ------------------------------------------------------------------ camera + calibration
function buildDetector() {
  if (!cal) return;
  detector = new ShadowDetector({
    gw: GW, gh: GH, cw: cal.cw, ch: cal.ch, corners: cal.corners, black: cal.black, white: cal.white, view: stage.view(),
    onT: Number(params.get('on')) || 0.3, offT: Number(params.get('off')) || 0.42,   // ?on=0.25&off=0.38 to tune for your room
  });
  updateIgnore();
}

function camStatus(text, ok = false) {
  $('#camstatus').textContent = text;
  $('#btn-start').disabled = !ok;
}

async function useCamera() {
  sfx.unlock();
  document.body.classList.remove('sim');
  $('#simbar').hidden = true;
  showMask = false;
  if (editor) editor.clear();
  try {
    if (camera && camera.stop) camera.stop();
    camera = new CameraSource();
    await camera.start();
  } catch (e) {
    camera = null;
    camStatus(`Camera: ${e && e.message ? e.message : e}`);
    toast(String(e && e.message ? e.message : e), 7000);
    return;
  }
  setMode('aim');
}

async function useSim() {
  sfx.unlock();
  if (camera && camera.stop) camera.stop();
  camera = new SimCamera(stage);
  document.body.classList.add('sim');
  $('#simbar').hidden = false;
  if (!editor) editor = new SimEditor(stage, camera, overlay);
  else { editor.camera = camera; }
  showMask = true;
  await calibrate();
}

async function calibrate() {
  setMode('calibrating');
  const sim = camera.kind === 'sim';
  if (!FAST) {
    for (countdown = sim ? 1 : 3; countdown > 0; countdown--) await new Promise((r) => setTimeout(r, 1000));
  }
  countdown = 0;
  document.body.classList.add('flat');
  let out;
  try {
    out = await runCalibration(stage, camera, { speed: FAST ? 0.12 : sim ? 0.5 : 1 });
  } finally {
    document.body.classList.remove('flat');
  }
  lastCal = out;
  preview.canvas.width = out.cw;
  preview.canvas.height = out.ch;
  preview.ctx.putImageData(new ImageData(new Uint8ClampedArray(out.snapshot), out.cw, out.ch), 0, 0);
  const c = out.result.corners;
  preview.quad = c
    ? [c.tl, c.tr, c.br, c.bl].map((p) => [p[0], p[1]])
    : [[0.18, 0.18], [0.82, 0.18], [0.82, 0.82], [0.18, 0.82]].map(([x, y]) => [x * out.cw, y * out.ch]);
  if (out.ok && sim && !REVIEW) { acceptCalibration(); return; }
  $('#result-msg').textContent = out.ok
    ? `Found the picture (contrast ${(out.result.contrast * 100).toFixed(0)}%). Does the green outline hug the bright area?`
    : `${out.message} You can also drag the corners by hand.`;
  setMode('result');
}

function acceptCalibration() {
  const q = preview.quad;
  cal = { corners: { tl: q[0], tr: q[1], br: q[2], bl: q[3] }, black: lastCal.black, white: lastCal.white, cw: lastCal.cw, ch: lastCal.ch };
  buildDetector();
  camStatus(`Camera ready ✓ (${camera.kind === 'sim' ? 'simulator' : `${cal.cw}×${cal.ch}`})`, true);
  setMode('lobby');
  if (AUTO_LEVEL !== null) startLevel(AUTO_LEVEL);
}

function fitRect(srcW, srcH) {
  const cw = stage.canvas.width, ch = stage.canvas.height;
  const s = Math.min((cw * 0.92) / srcW, (ch * 0.78) / srcH);
  const w = srcW * s, h = srcH * s;
  return { x: (cw - w) / 2, y: ch * 0.04, w, h, s };
}

function canvasPoint(e) {
  const r = overlay.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * overlay.width, ((e.clientY - r.top) / r.height) * overlay.height];
}

overlay.addEventListener('pointerdown', (e) => {
  if (mode !== 'adjust' || !lastCal) return;
  const f = fitRect(lastCal.cw, lastCal.ch);
  const [px, py] = canvasPoint(e);
  let best = -1, bd = 40 * (stage.canvas.width / window.innerWidth);
  preview.quad.forEach((q, i) => {
    const d = Math.hypot(f.x + q[0] * f.s - px, f.y + q[1] * f.s - py);
    if (d < bd) { bd = d; best = i; }
  });
  preview.drag = best;
  if (best >= 0) overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener('pointermove', (e) => {
  if (mode !== 'adjust' || preview.drag < 0) return;
  const f = fitRect(lastCal.cw, lastCal.ch);
  const [px, py] = canvasPoint(e);
  preview.quad[preview.drag] = [Math.max(1, Math.min(lastCal.cw - 2, (px - f.x) / f.s)), Math.max(1, Math.min(lastCal.ch - 2, (py - f.y) / f.s))];
});
overlay.addEventListener('pointerup', () => { preview.drag = -1; });

// ------------------------------------------------------------------ frame loop
let lastT = performance.now();
let fpsAcc = 0, fpsN = 0, dbgAcc = 0;

function handleEvents() {
  for (const e of world.drainEvents()) {
    switch (e.type) {
      case 'bounce': sfx.play('bounce', e); break;
      case 'star': sfx.play('star', e); fx.burst(e.x, e.y, 18); buzz(30); pushState(); break;
      case 'death': sfx.play('death'); fx.burst(e.x, e.y, 22, [PAL.spike, PAL.orb], 320); buzz(80); break;
      case 'spawn': sfx.play('spawn'); fx.ring(e.x, e.y, PAL.orb); break;
      case 'gate': sfx.play('gate', e); break;
      case 'plate': sfx.play('plate', e); break;
      case 'beam': sfx.play('beam', e); break;
      case 'switch': sfx.play('switch', e); pushState(); break;
      case 'gravity': sfx.play('gravity'); pushState(); break;
      case 'goal':
        sfx.play('goal');
        fx.confetti(e.x, e.y);
        clearInfo = { time: e.time, stars: e.stars, total: e.total, deaths: e.deaths };
        buzz([60, 40, 60, 40, 120]);
        $('#btn-next').textContent = levelIndex + 1 >= LEVELS.length ? 'Play again from level 1 ▶' : 'Next level ▶';
        setMode('clear');
        break;
      default:
    }
  }
}

function visionTick() {
  if (!detector || !camera) return;
  const t0 = performance.now();
  lastFrame = camera.getFrame();
  const mask = detector.detect(lastFrame);
  world.setShadow(mask);
  visionMs = visionMs * 0.9 + (performance.now() - t0) * 0.1;
}

function update(dt) {
  fx.update(dt);
  scene.update(dt, world);
  if (mode === 'play') {
    visionAcc += dt;
    if (visionAcc >= 1 / 20) { visionAcc = 0; visionTick(); }
    world.step(dt, { nudge: sumNudge() });
    handleEvents();
  } else if (mode === 'lobby') {
    world.step(dt, { nudge: 0 });
    world.drainEvents();
  } else if (mode === 'clear') {
    handleEvents();
  }
}

function drawPreviewImage(img, w, h) {
  const f = fitRect(w, h);
  const ctx = stage.screen();
  ctx.drawImage(img, f.x, f.y, f.w, f.h);
  return f;
}

function drawLivePreview() {
  const frame = camera.getFrame();
  preview.canvas.width = camera.width;
  preview.canvas.height = camera.height;
  preview.ctx.putImageData(new ImageData(new Uint8ClampedArray(frame), camera.width, camera.height), 0, 0);
  drawPreviewImage(preview.canvas, camera.width, camera.height);
}

function drawQuad(ctx, f, quad, handles) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#00e676';
  ctx.beginPath();
  quad.forEach((q, i) => { const x = f.x + q[0] * f.s, y = f.y + q[1] * f.s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.stroke();
  if (handles) {
    ctx.fillStyle = '#ff2f92';
    for (const q of quad) { ctx.beginPath(); ctx.arc(f.x + q[0] * f.s, f.y + q[1] * f.s, 12, 0, Math.PI * 2); ctx.fill(); }
  }
}

function draw() {
  stage.clear('#ffffff');
  if (mode === 'aim' && camera) { drawLivePreview(); return; }
  if ((mode === 'result' || mode === 'adjust') && lastCal) {
    const f = drawPreviewImage(preview.canvas, lastCal.cw, lastCal.ch);
    drawQuad(stage.screen(), f, preview.quad, mode === 'adjust');
    return;
  }
  if (mode === 'calibrating') {
    const ctx = stage.screen();
    ctx.fillStyle = PAL.text;
    ctx.textAlign = 'center';
    ctx.font = `900 ${stage.canvas.height * 0.2}px system-ui, sans-serif`;
    ctx.fillText(countdown > 0 ? String(countdown) : '…', stage.canvas.width / 2, stage.canvas.height * 0.52);
    ctx.font = `700 ${stage.canvas.height * 0.05}px system-ui, sans-serif`;
    ctx.fillText('Calibrating — keep hands out of the beam', stage.canvas.width / 2, stage.canvas.height * 0.68);
    ctx.textAlign = 'left';
    return;
  }
  const ctx = stage.world();
  scene.draw(ctx, world, fx, { label: mode !== 'lobby' });
  if (mode === 'clear' && clearInfo) { scene.drawClear(ctx, clearInfo, scene.t); fx.draw(ctx); }
  stage.screen();
}

function sizeOverlay() {
  if (overlay.width !== stage.canvas.width || overlay.height !== stage.canvas.height) {
    overlay.width = stage.canvas.width;
    overlay.height = stage.canvas.height;
  }
}

function drawOverlay() {
  sizeOverlay();
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (mode === 'adjust') {
    const f = fitRect(lastCal.cw, lastCal.ch);
    drawQuad(octx, f, preview.quad, true);
    return;
  }
  if (!(mode === 'play' || mode === 'clear' || mode === 'menu' || mode === 'lobby')) return;
  octx.setTransform(stage.scale, 0, 0, stage.scale, stage.ox, stage.oy);
  if (showMask && mode === 'play') {
    octx.fillStyle = 'rgba(0, 200, 255, 0.30)';
    const s = world.shadow;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (s[j * GW + i]) octx.fillRect(i * CELL, j * CELL, CELL, CELL);
  }
  if (editor && camera && camera.kind === 'sim') editor.draw(octx);
}

function updateDebug() {
  if ($('#debug').hidden) return;
  const st = detector ? detector.stats : null;
  $('#dbg-text').textContent = `${fps.toFixed(0)} fps · vision ${visionMs.toFixed(1)} ms\n` +
    (st ? `shadow ${(st.coverage * 100).toFixed(1)}% · gain ${st.gain.toFixed(2)} · valid ${(st.validFrac * 100).toFixed(0)}%` : 'no detector') +
    (camera && camera.locked ? ' · exposure locked' : '');
  const dc = $('#dbg-cam').getContext('2d');
  if (lastFrame && camera) {
    const t = document.createElement('canvas');
    t.width = camera.width; t.height = camera.height;
    t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(lastFrame), camera.width, camera.height), 0, 0);
    dc.drawImage(t, 0, 0, 160, 90);
  }
  const mc = $('#dbg-mask').getContext('2d');
  mc.fillStyle = '#fff'; mc.fillRect(0, 0, 160, 90);
  mc.fillStyle = '#2f5bff';
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (world.shadow[j * GW + i]) mc.fillRect(i, j, 1, 1);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (stage.flatColor) { stage.clear(stage.flatColor); octx.clearRect(0, 0, overlay.width, overlay.height); return; }
  update(dt);
  draw();
  drawOverlay();
  dbgAcc += dt;
  if (dbgAcc > 0.25) { dbgAcc = 0; updateDebug(); }
}

// ------------------------------------------------------------------ wiring
function init() {
  keepAwake();
  stage.onResize = () => { sizeOverlay(); buildDetector(); };
  sizeOverlay();

  const sel = $('#levelsel');
  LEVELS.forEach((l, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i}. ${l.name}`; sel.append(o); });
  sel.value = '0';
  renderPlayers();

  $('#btn-camera').onclick = useCamera;
  $('#btn-sim').onclick = useSim;
  $('#btn-calibrate').onclick = calibrate;
  $('#btn-aim-cancel').onclick = () => { if (camera) camera.stop(); camera = null; setMode('lobby'); };
  $('#btn-accept').onclick = acceptCalibration;
  $('#btn-retry').onclick = () => (camera.kind === 'sim' ? calibrate() : setMode('aim'));
  $('#btn-adjust').onclick = () => setMode(mode === 'adjust' ? 'result' : 'adjust');
  $('#btn-start').onclick = () => { sfx.unlock(); startLevel(Number(sel.value)); };
  $('#btn-next').onclick = nextLevel;
  $('#btn-replay').onclick = () => startLevel(levelIndex);
  $('#menubtn').onclick = () => { if (mode === 'play' || mode === 'clear') { menuFrom = mode; setMode('menu'); } };
  let menuFrom = 'play';
  $('#m-resume').onclick = () => setMode(menuFrom);
  $('#m-restart').onclick = () => startLevel(levelIndex);
  $('#m-next').onclick = nextLevel;
  $('#m-cal').onclick = () => { if (!camera) { toLobby(); return; } if (camera.kind === 'sim') calibrate(); else setMode('aim'); };
  $('#m-mute').onclick = () => { sfx.muted = !sfx.muted; $('#m-mute').textContent = `Sound: ${sfx.muted ? 'off' : 'on'}`; };
  $('#m-lobby').onclick = toLobby;

  document.querySelectorAll('#simbar [data-tool]').forEach((b) => {
    b.onclick = () => {
      editor.tool = b.dataset.tool;
      document.querySelectorAll('#simbar [data-tool]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  $('#s-rot-l').onclick = () => editor && editor.rotateSelected(-0.2);
  $('#s-rot-r').onclick = () => editor && editor.rotateSelected(0.2);
  $('#s-big').onclick = () => editor && editor.scaleSelected(1.15);
  $('#s-small').onclick = () => editor && editor.scaleSelected(1 / 1.15);
  $('#s-clear').onclick = () => editor && editor.clear();

  // keyboard (laptop testing): arrows nudge, WASD gravity, R reset, N next, M mask, B debug, Esc menu
  window.addEventListener('keydown', (e) => {
    sfx.unlock();
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') kb.left = true;
    else if (k === 'arrowright') kb.right = true;
    else if ('wasd'.includes(k) && k.length === 1 && mode === 'play' && world.level.gravity) world.setGravity({ w: DIRS.up, s: DIRS.down, a: DIRS.left, d: DIRS.right }[k]);
    else if (k === 'r' && mode === 'play') world.resetOrbs();
    else if (k === 'o' && mode === 'play') world.spawnOrb();
    else if (k === 'n' && (mode === 'play' || mode === 'clear')) nextLevel();
    else if (k === 'm') showMask = !showMask;
    else if (k === 'b') toggleDebug();
    else if (k === 'escape') { if (mode === 'menu') setMode(menuFrom); else if (mode === 'play' || mode === 'clear') { menuFrom = mode; setMode('menu'); } }
    else return;
    if (k.startsWith('arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft') kb.left = false;
    if (k === 'arrowright') kb.right = false;
  });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  // triple-tap the top-left corner to open the debug panel on a touch-only host
  let taps = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.clientX > 90 || e.clientY > 90) return;
    const now = performance.now();
    taps = taps.filter((t) => now - t < 800).concat(now);
    if (taps.length >= 3) { taps = []; toggleDebug(); }
  });

  link.connect();
  if (AUTO_SIM) useSim();

  window.__umbra = {
    get mode() { return mode; },
    get detector() { return detector; },
    get camera() { return camera; },
    get editor() { return editor; },
    get gmId() { return gmId; },
    world, stage, players, startLevel, nextLevel, toLobby, acceptCalibration,
  };
}

function toggleDebug() {
  const d = $('#debug');
  d.hidden = !d.hidden;
  updateIgnore();
}

init();
requestAnimationFrame(frame);
