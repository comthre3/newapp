// Umbra P0: the real-projector gate. A guided run that measures whether shadow detection is good
// enough on THIS projector, surface, camera and network, then prints a report to send back.
import qrcode from '/vendor/qrcode.mjs';
import { Stage } from '../host/stage.js';
import { CameraSource } from '../host/camera.js';
import { SimCamera, SimEditor } from '../host/sim.js';
import { runCalibration } from '../host/calibrate.js';
import { ShadowDetector } from '../core/vision-core.js';
import { GW, GH, CELL, W, H } from '../game/world.js';
import { PAL } from '../game/palette.js';
import { Link, persistentToken } from '../net.js';
import * as M from './metrics.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const AUTO_SIM = params.has('sim');
const REVIEW = params.has('review');

// Real timings, and a fast set used by the automated test and for quick dry runs.
const CFG = FAST
  ? { lat: { trials: 6, timeout: 1.5, gap: [0.2, 0.4] }, quiet: 5, ring: { trials: 3, timeout: 4, hold: 0.3, restMin: 0.2, restMax: 2, ready: 0.3, after: 0.3 }, beam: 3, conn: { duration: 6, join: 8, autoStart: 1.5 }, announce: 0.4, pause: 0.3, calSpeed: 0.12 }
  : { lat: { trials: 20, timeout: 2, gap: [0.8, 1.6] }, quiet: 60, ring: { trials: 10, timeout: 10, hold: 1, restMin: 0.8, restMax: 6, ready: 1.2, after: 1 }, beam: 30, conn: { duration: 60, join: 45, autoStart: 10 }, announce: 5, pause: 6, calSpeed: 1 };

// ------------------------------------------------------------------ core objects
const stage = new Stage($('#stage'));
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
let camera = null;
let editor = null;
let detector = null;
let cal = null;               // accepted calibration {corners, black, white, cw, ch}
let lastCal = null;           // latest calibration attempt (for the review screen)
let calManual = false;
let calAttempts = 0;
let phase = 'setup';          // setup | aim | calibrating | review | adjust | ready | announce | running | report
let activeStep = null;
let announce = null;
let guide = null;             // { stop: bool, skip: fn } while the guided run is going
let showMask = true;
let vis = { seq: 0, t: 0, mask: new Uint8Array(GW * GH), coverage: 0, half: [0, 0] };
let visAcc = 0, visMs = 0, lastFrame = null, fps = 0, fpsAcc = 0, fpsN = 0, dbgAcc = 0, lastT = performance.now();
const results = {};
const preview = { canvas: document.createElement('canvas'), quad: null, drag: -1 };
preview.ctx = preview.canvas.getContext('2d');
const nowS = () => performance.now() / 1000;

// ------------------------------------------------------------------ small UI helpers
let toastTimer = 0;
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function setPanel({ step = '', count = '', text = '', buttons = [] } = {}) {
  const p = $('#p0panel');
  p.hidden = false;
  $('#p0step').textContent = step;
  $('#p0count').textContent = count;
  $('#p0text').textContent = text;
  const row = $('#p0buttons');
  row.textContent = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.primary) el.className = 'primary';
    else el.className = ['ghost', b.cls].filter(Boolean).join(' ');
    if (b.disabled) el.disabled = true;
    el.onclick = b.onClick;
    row.append(el);
  }
  updateIgnore();
}
const hidePanel = () => { $('#p0panel').hidden = true; updateIgnore(); };
/** Update labels in place: rebuilding buttons under a finger would swallow the tap. */
function patchPanel({ step, count, text: body } = {}) {
  if (step !== undefined) $('#p0step').textContent = step;
  if (count !== undefined) $('#p0count').textContent = count;
  if (body !== undefined) $('#p0text').textContent = body;
}

function updateIgnore() {
  if (!detector) return;
  const rects = [];
  for (const sel of ['#p0panel', '#debug', '#simbar', '#toast']) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    const [x0, y0] = stage.toWorld(r.left, r.top);
    const [x1, y1] = stage.toWorld(r.right, r.bottom);
    rects.push({ x: Math.floor(x0 / CELL) - 1, y: Math.floor(y0 / CELL) - 1, w: Math.ceil((x1 - x0) / CELL) + 2, h: Math.ceil((y1 - y0) / CELL) + 2 });
  }
  detector.setIgnore(rects);
}

// ------------------------------------------------------------------ camera, calibration
function buildDetector() {
  detector = new ShadowDetector({
    gw: GW, gh: GH, cw: cal.cw, ch: cal.ch, corners: cal.corners, black: cal.black, white: cal.white, view: stage.view(),
    onT: Number(params.get('on')) || 0.3, offT: Number(params.get('off')) || 0.42,
  });
  updateIgnore();
}

async function fillCameraList() {
  const sel = $('#camsel');
  const devices = await CameraSource.listDevices();
  const keep = sel.value;
  sel.textContent = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Rear / default camera';
  sel.append(def);
  for (const d of devices) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.label; sel.append(o); }
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

async function startCamera() {
  $('#setupmsg').textContent = 'Starting camera…';
  try {
    if (camera && camera.stop) camera.stop();
    camera = new CameraSource({ deviceId: $('#camsel').value || null });
    await camera.start();
  } catch (e) {
    camera = null;
    $('#setupmsg').textContent = `Camera problem: ${e && e.message ? e.message : e}`;
    return;
  }
  fillCameraList();
  $('#p0setup').hidden = true;
  setPhase('aim');
}

async function startSim() {
  if (camera && camera.stop) camera.stop();
  camera = new SimCamera(stage);
  document.body.classList.add('sim');
  $('#simbar').hidden = false;
  if (!editor) editor = new SimEditor(stage, camera, overlay); else editor.camera = camera;
  $('#p0setup').hidden = true;
  await calibrate();
}

function setPhase(p) {
  phase = p;
  document.body.classList.toggle('adjusting', p === 'adjust');
  if (p === 'aim') {
    setPanel({ step: 'Aim the camera', text: 'Every edge of the bright picture must be visible. Keep the camera steady and hands out of the beam, then calibrate.', buttons: [
      { label: 'Calibrate', primary: true, onClick: () => calibrate() },
      { label: 'Change camera', onClick: () => { camera.stop(); camera = null; $('#p0setup').hidden = false; hidePanel(); phase = 'setup'; } },
    ] });
  } else if (p === 'ready') {
    renderReadyPanel();
  }
}

/** One calibration run. Returns { out, ms }. Shows nothing; callers decide what to do with it. */
async function runCal() {
  const t0 = performance.now();
  document.body.classList.add('flat');
  let out;
  try {
    out = await runCalibration(stage, camera, { speed: camera.kind === 'sim' ? Math.min(0.5, CFG.calSpeed) : CFG.calSpeed });
  } finally {
    document.body.classList.remove('flat');
  }
  calAttempts++;
  return { out, ms: performance.now() - t0 };
}

function loadPreview(out) {
  lastCal = out;
  preview.canvas.width = out.cw;
  preview.canvas.height = out.ch;
  preview.ctx.putImageData(new ImageData(new Uint8ClampedArray(out.snapshot), out.cw, out.ch), 0, 0);
  const c = out.result.corners;
  preview.quad = c ? [c.tl, c.tr, c.br, c.bl].map((p) => [p[0], p[1]]) : [[0.18, 0.18], [0.82, 0.18], [0.82, 0.82], [0.18, 0.82]].map(([x, y]) => [x * out.cw, y * out.ch]);
}

async function calibrate() {
  phase = 'calibrating';
  setPanel({ step: 'Calibrating', text: 'Keep hands out of the beam. The wall will flash black, then white.' });
  if (!FAST) for (let n = camera.kind === 'sim' ? 1 : 3; n > 0; n--) { announce = { big: String(n), small: 'Calibrating, keep hands out of the beam' }; phase = 'calibrating'; await new Promise((r) => setTimeout(r, 1000)); }
  announce = null;
  const { out } = await runCal();
  loadPreview(out);
  calManual = false;
  if (out.ok && camera.kind === 'sim' && !REVIEW) { acceptCalibration(); return; }
  phase = 'review';
  reviewPanel();
}

function reviewPanel() {
  const out = lastCal;
  setPanel({
    step: out.ok ? 'Calibration found the picture' : 'Calibration needs help',
    text: out.ok ? `Contrast ${(out.result.contrast * 100).toFixed(0)}%. Does the green outline hug the bright area? Drag the corners if not.` : `${out.message} You can also drag the corners by hand.`,
    buttons: [
      { label: 'Looks right', primary: true, onClick: acceptCalibration },
      { label: phase === 'adjust' ? 'Done adjusting' : 'Adjust corners', onClick: () => { phase = phase === 'adjust' ? 'review' : 'adjust'; document.body.classList.toggle('adjusting', phase === 'adjust'); reviewPanel(); } },
      { label: 'Retry', onClick: () => calibrate() },
    ],
  });
}

function acceptCalibration() {
  const q = preview.quad;
  const edited = lastCal.result.corners ? ['tl', 'tr', 'br', 'bl'].some((k, i) => Math.hypot(lastCal.result.corners[k][0] - q[i][0], lastCal.result.corners[k][1] - q[i][1]) > 0.5) : true;
  calManual = edited;
  cal = { corners: { tl: q[0], tr: q[1], br: q[2], bl: q[3] }, black: lastCal.black, white: lastCal.white, cw: lastCal.cw, ch: lastCal.ch };
  buildDetector();
  const r = lastCal.result;
  results.calibration = { ok: !!r.ok, manual: calManual, error: r.error || null, contrast: r.contrast, areaFrac: r.areaFrac, fill: r.fill, validFrac: detector.stats.validFrac, cw: cal.cw, ch: cal.ch, attempts: calAttempts };
  document.body.classList.remove('adjusting');
  setPhase('ready');
}

// preview-corner dragging (manual adjust)
function fitRect(srcW, srcH) {
  const cw = stage.canvas.width, ch = stage.canvas.height;
  const s = Math.min((cw * 0.92) / srcW, (ch * 0.74) / srcH);
  return { x: (cw - srcW * s) / 2, y: ch * 0.04, w: srcW * s, h: srcH * s, s };
}
const canvasPoint = (e) => { const r = overlay.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * overlay.width, ((e.clientY - r.top) / r.height) * overlay.height]; };
overlay.addEventListener('pointerdown', (e) => {
  if (phase !== 'adjust' || !lastCal) return;
  const f = fitRect(lastCal.cw, lastCal.ch);
  const [px, py] = canvasPoint(e);
  let best = -1, bd = 44 * (stage.canvas.width / window.innerWidth);
  preview.quad.forEach((q, i) => { const d = Math.hypot(f.x + q[0] * f.s - px, f.y + q[1] * f.s - py); if (d < bd) { bd = d; best = i; } });
  preview.drag = best;
  if (best >= 0) overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener('pointermove', (e) => {
  if (phase !== 'adjust' || preview.drag < 0) return;
  const f = fitRect(lastCal.cw, lastCal.ch);
  const [px, py] = canvasPoint(e);
  preview.quad[preview.drag] = [Math.max(1, Math.min(lastCal.cw - 2, (px - f.x) / f.s)), Math.max(1, Math.min(lastCal.ch - 2, (py - f.y) / f.s))];
});
overlay.addEventListener('pointerup', () => { preview.drag = -1; });

// ------------------------------------------------------------------ vision loop
function visionTick() {
  if (!detector || !camera) return;
  const t0 = performance.now();
  lastFrame = camera.getFrame();
  const mask = detector.detect(lastFrame);
  let l = 0, r = 0;
  const half = GW >> 1;
  for (let j = 0; j < GH; j++) {
    const row = j * GW;
    for (let i = 0; i < half; i++) l += mask[row + i];
    for (let i = half; i < GW; i++) r += mask[row + i];
  }
  const hc = half * GH;
  vis = { seq: vis.seq + 1, t: performance.now() / 1000, mask, coverage: (l + r) / (GW * GH), half: [l / hc, r / hc] };
  visMs = visMs * 0.9 + (performance.now() - t0) * 0.1;
}

// ------------------------------------------------------------------ drawing helpers (bright-field only)
function text(ctx, str, x, y, { size = 30, color = PAL.text, align = 'center', weight = 800 } = {}) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}
function maskOverlay(ctx) {
  ctx.fillStyle = 'rgba(0, 200, 255, 0.35)';
  const s = vis.mask;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (s[j * GW + i]) ctx.fillRect(i * CELL, j * CELL, CELL, CELL);
}
function cellsOfRect(x, y, w, h) {
  const out = [];
  for (let j = Math.floor(y / CELL); j < Math.ceil((y + h) / CELL); j++) for (let i = Math.floor(x / CELL); i < Math.ceil((x + w) / CELL); i++) out.push(j * GW + i);
  return out;
}
let qrCache = { url: '', modules: null };
function drawQR(ctx, url, x, y, size) {
  if (qrCache.url !== url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    qrCache = { url, modules: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c))) };
  }
  const m = qrCache.modules, n = m.length, cell = size / (n + 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, cell + 0.6, cell + 0.6);
}

// ------------------------------------------------------------------ steps
class Step {
  constructor(opts = {}) { this.opts = opts; this.done = false; this.aborted = false; this.t0 = 0; }
  start(t) { this.t0 = t; }
  finish() { this.done = true; }
  abort() { this.aborted = true; this.done = true; }
  count() { return ''; }
}

class LatencyStep extends Step {
  start(t) {
    super.start(t);
    this.probe = new M.LatencyProbe({ trials: CFG.lat.trials, timeoutS: CFG.lat.timeout, gapS: CFG.lat.gap });
    this.region = { x: 380, y: 160, w: 200, h: 200 };
    this.cells = cellsOfRect(this.region.x, this.region.y, this.region.w, this.region.h);
    this.seq = -1;
    this.rd = null;
    this.dark = false;
  }
  read() {
    const lit = detector.lit, n = this.cells.length;
    let s = 0, c = 0;
    for (const k of this.cells) { s += lit[k]; c += vis.mask[k]; }
    const raw = s / n / detector.gain, cover = c / n;
    return { t: vis.t, rawDark: raw < detector.onT, rawLit: raw > detector.offT, stableDark: cover >= 0.5, stableClear: cover <= 0.1 };
  }
  update(t) {
    if (vis.seq !== this.seq) { this.seq = vis.seq; this.rd = this.read(); }
    const { dark, done } = this.probe.step(t, this.rd);
    this.dark = dark;
    if (done) this.finish();
  }
  count() { return `${Math.min(this.probe.index, this.probe.trials)} / ${this.probe.trials}`; }
  text() { return 'Hands out of the beam. The wall flashes a dark square and the camera has to notice. Do not move.'; }
  draw(ctx) {
    text(ctx, `Latency test ${this.count()}`, W / 2, 80, { size: 34 });
    text(ctx, 'Keep hands out of the beam', W / 2, 120, { size: 22, color: PAL.textSoft });
    ctx.fillStyle = this.dark ? '#000' : '#fff';
    ctx.fillRect(this.region.x, this.region.y, this.region.w, this.region.h);
  }
  result() { return { summary: this.probe.summary(), trials: this.probe.results, region: this.region, pollHz: 20 }; }
}

class QuietStep extends Step {
  start(t) {
    super.start(t);
    this.ev = new M.BlobEvents();
    this.peak = 0;
    this.seq = -1;
    this.blobs = [];
    this.dur = CFG.quiet;
  }
  update(t) {
    if (vis.seq !== this.seq) {
      this.seq = vis.seq;
      this.blobs = M.findBlobs(vis.mask, GW, GH, 6);
      this.ev.update(this.blobs, t);
      this.peak = Math.max(this.peak, vis.coverage);
    }
    if (t - this.t0 >= this.dur) this.finish();
  }
  count() { return `${Math.max(0, Math.ceil(this.dur - (nowS() - this.t0)))} s left, ${this.ev.events.length} phantom${this.ev.events.length === 1 ? '' : 's'}`; }
  text() { return this.opts.lantern ? 'Light your lantern or fire where it would be at camp, switch on any lamps, and let one or two people stand still at the sides. Nothing should block the beam.' : 'Nothing in the beam, nobody moving, hands away from the camera. We count shadows that appear from nowhere.'; }
  draw(ctx) {
    text(ctx, `${this.opts.label}: keep still`, W / 2, 80, { size: 34 });
    text(ctx, this.opts.lantern ? 'Lantern lit, people still, beam clear' : 'Beam clear, nobody moving', W / 2, 120, { size: 22, color: PAL.textSoft });
    text(ctx, `${Math.max(0, Math.ceil(this.dur - (nowS() - this.t0)))} s`, W / 2, H / 2 + 40, { size: 120, color: PAL.hint });
    text(ctx, `phantoms so far: ${this.ev.events.length}`, W / 2, H / 2 + 100, { size: 28, color: this.ev.events.length ? PAL.spike : PAL.textSoft });
    if (this.blobs.length) maskOverlay(ctx);
  }
  result() {
    const dur = Math.max(1, nowS() - this.t0);
    return { label: this.opts.label, lantern: !!this.opts.lantern, durationS: dur, events: this.ev.events, perMinHalf: this.ev.perMinute(dur), peakCoverage: this.peak };
  }
}

class RingStep extends Step {
  start(t) {
    super.start(t);
    const { cx = 480, cy = 240, r } = this.opts;
    this.cx = cx; this.cy = cy; this.r = r;
    this.trials = [];
    this.phase = 'rest';
    this.tp = t;
    this.trial = null;
    this.last = null;
  }
  update(t) {
    const C = CFG.ring;
    if (this.phase === 'rest') {
      const clear = M.discCover(vis.mask, this.cx, this.cy, this.r * 1.4) < 0.05;
      if ((clear && t - this.tp > C.restMin) || t - this.tp > C.restMax) { this.phase = 'ready'; this.tp = t; }
    } else if (this.phase === 'ready') {
      if (t - this.tp > C.ready) { this.trial = new M.RingTrial({ cx: this.cx, cy: this.cy, r: this.r, holdS: C.hold, timeoutS: C.timeout }); this.trial.start(t); this.phase = 'live'; }
    } else if (this.phase === 'live') {
      const st = this.trial.update(vis.mask, t);
      if (st !== 'running') { this.last = this.trial.result(); this.trials.push(this.last); this.phase = 'result'; this.tp = t; }
    } else if (this.phase === 'result') {
      if (t - this.tp > C.after) { if (this.trials.length >= C.trials) this.finish(); else { this.phase = 'rest'; this.tp = t; } }
    }
  }
  count() { return `${this.trials.length} / ${CFG.ring.trials} done`; }
  text() { return 'Hold your hand or a prop in the beam so its shadow fills the glowing ring, and keep it there for a second. Remove it between tries.'; }
  draw(ctx, t) {
    const { cx, cy, r } = this;
    const live = this.phase === 'live';
    text(ctx, `${this.opts.label}  ${this.trials.length + (this.phase === 'result' ? 0 : 1)} / ${CFG.ring.trials}`, W / 2, 70, { size: 34 });
    const ok = this.last && this.last.success;
    let hint = '';
    if (this.phase === 'rest') hint = 'Take your shadow out of the ring';
    else if (this.phase === 'ready') hint = 'Get ready…';
    else if (this.phase === 'live') hint = `Fit your shadow into the ring  (${Math.round(this.trial.iou * 100)}%)`;
    else hint = ok ? `Fitted in ${this.last.forming.toFixed(1)} s` : 'Time is up';
    text(ctx, hint, W / 2, 112, { size: 24, color: this.phase === 'result' ? (ok ? PAL.goal : PAL.spike) : PAL.textSoft });
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (this.phase === 'result' && this.last && this.last.success) { ctx.fillStyle = PAL.goalSoft; ctx.fill(); ctx.strokeStyle = PAL.goal; }
    else { ctx.fillStyle = live ? '#fff1c9' : '#fffaf0'; ctx.fill(); ctx.strokeStyle = PAL.star; }
    ctx.lineWidth = live ? 9 : 5;
    if (!live) ctx.setLineDash([16, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (live && this.trial.holdProgress > 0) {
      ctx.strokeStyle = PAL.goal;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.trial.holdProgress);
      ctx.stroke();
    }
    if (live) text(ctx, `${Math.max(0, CFG.ring.timeout - (t - this.trial.t0)).toFixed(0)} s`, cx, cy + r + 62, { size: 28, color: PAL.hint });
    if (showMask) maskOverlay(ctx);
  }
  result() { return { label: this.opts.label, r: this.r, trials: this.trials, summary: M.summarize(this.trials.filter((x) => x.success).map((x) => x.forming)) }; }
}

class BeamStep extends Step {
  start(t) { super.start(t); this.peak = [0, 0]; this.peakTotal = 0; this.maxBlobs = 0; this.dur = CFG.beam; this.seq = -1; }
  update(t) {
    if (vis.seq !== this.seq) {
      this.seq = vis.seq;
      this.peak = [Math.max(this.peak[0], vis.half[0]), Math.max(this.peak[1], vis.half[1])];
      this.peakTotal = Math.max(this.peakTotal, vis.coverage);
      this.maxBlobs = Math.max(this.maxBlobs, M.findBlobs(vis.mask, GW, GH, 6).length);
    }
    if (t - this.t0 >= this.dur) this.finish();
  }
  count() { return `${Math.max(0, Math.ceil(this.dur - (nowS() - this.t0)))} s left`; }
  text() { return 'Let two or three people (and a child, if you have one) stand and move in the beam, with props, as in a real game. Watch the area numbers; red means the design cap would trigger.'; }
  draw(ctx) {
    text(ctx, 'People in the beam', W / 2, 70, { size: 34 });
    text(ctx, 'Stand, wave, hold props. We record how much of each lane is covered.', W / 2, 106, { size: 22, color: PAL.textSoft });
    ctx.strokeStyle = PAL.hint;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(W / 2, 140); ctx.lineTo(W / 2, H - 40); ctx.stroke();
    ctx.setLineDash([]);
    [0, 1].forEach((i) => {
      const over = vis.half[i] > M.THRESHOLDS.areaCap;
      text(ctx, `${Math.round(vis.half[i] * 100)}%`, W / 4 + i * (W / 2), 230, { size: 80, color: over ? PAL.spike : PAL.text });
      text(ctx, over ? 'over the 25% cap' : (i === 0 ? 'left lane' : 'right lane'), W / 4 + i * (W / 2), 270, { size: 24, color: over ? PAL.spike : PAL.textSoft });
    });
    maskOverlay(ctx);
  }
  result() { return { durationS: nowS() - this.t0, peakHalf: this.peak, peakTotal: this.peakTotal, maxBlobs: this.maxBlobs }; }
}

class RecalStep extends Step {
  start(t) {
    super.start(t);
    this.busy = false;
    this.res = null;
    setPanel({ step: 'Recalibration after a bump', text: 'Nudge the projector (or the camera) a little, then press Recalibrate. We time how long it takes to get back to a working picture.', buttons: [
      { label: 'Recalibrate now', primary: true, onClick: () => this.go() },
      { label: 'Skip', onClick: () => this.abort() },
    ] });
  }
  async go() {
    if (this.busy) return;
    this.busy = true;
    setPanel({ step: 'Recalibrating', text: 'Keep hands out of the beam…' });
    const before = cal ? cal.corners : null;
    const { out, ms } = await runCal();
    let shift = null;
    if (out.ok && before) {
      const keys = ['tl', 'tr', 'br', 'bl'];
      shift = Math.max(...keys.map((k) => Math.hypot(out.result.corners[k][0] - before[k][0], out.result.corners[k][1] - before[k][1])));
    }
    this.res = { ok: !!out.ok, ms, shiftPx: shift, contrast: out.result.contrast, error: out.result.error || null };
    if (out.ok) {
      loadPreview(out);
      const q = preview.quad;
      cal = { corners: { tl: q[0], tr: q[1], br: q[2], bl: q[3] }, black: out.black, white: out.white, cw: out.cw, ch: out.ch };
      buildDetector();
    }
    this.finish();
  }
  update() {}
  text() { return 'Nudge the projector, then press Recalibrate.'; }
  draw(ctx) { text(ctx, 'Bump the projector, then recalibrate', W / 2, H / 2 - 20, { size: 40 }); text(ctx, 'We time the recovery', W / 2, H / 2 + 24, { size: 24, color: PAL.textSoft }); }
  result() { return this.res; }
}

// -- connectivity: phones open /p0-phone.html, ping the host through the relay, and report round-trip times
const relay = { link: null, code: '', phones: new Map(), reports: {}, shareBase: params.get('base') || location.origin, started: false };
const isLocalHost = /^(localhost|127\.|\[::1\])/.test(location.hostname);
function ensureRelay() {
  if (relay.link) return;
  let room = '';
  try { room = sessionStorage.getItem('umbra.p0.room') || ''; } catch { /* private mode */ }
  const token = persistentToken('umbra.p0.host');
  relay.link = new Link(() => ({ role: 'host', token, room }), {
    onMessage: (m) => {
      if (m.t === 'room') { relay.code = m.code; room = m.code; try { sessionStorage.setItem('umbra.p0.room', m.code); } catch { /* ignore */ } }
      else if (m.t === 'join') relay.phones.set(m.id, { id: m.id, name: m.name, online: true, joinedAt: Date.now() });
      else if (m.t === 'leave') { const p = relay.phones.get(m.id); if (p) p.online = false; }
      else if (m.t === 'in') {
        if (m.k === 'ping') relay.link.send({ t: 'to', id: m.id, m: { pong: m.v } });
        else if (m.k === 'rtt') { const p = relay.phones.get(m.id); if (p) p.lastMedian = m.v; }
        else if (m.k === 'rttmax') { const p = relay.phones.get(m.id); if (p) { (relay.reports[m.id] || (relay.reports[m.id] = [])).push({ t: Date.now(), median: p.lastMedian ?? m.v, max: m.v }); p.lastMax = m.v; } }
      }
    },
  });
  relay.link.connect();
  if (isLocalHost && !params.get('base')) fetch('/api/info').then((r) => r.json()).then(({ lan }) => { if (lan && lan.length) relay.shareBase = lan[0]; }).catch(() => {});
}
const phoneUrl = () => `${relay.shareBase.replace(/\/$/, '')}/p0-phone.html?room=${relay.code}`;

class ConnStep extends Step {
  start(t) {
    super.start(t);
    ensureRelay();
    this.stage = 'join';
    this.tp = t;
    this.lastJoinCount = 0;
    this.lastJoinT = t;
    this.probeStart = null;
    this.res = null;
    this.render();
  }
  render() {
    const n = [...relay.phones.values()].filter((p) => p.online).length;
    if (!this.built) {
      this.built = true;
      setPanel({ step: 'Connectivity', count: `${n} phone${n === 1 ? '' : 's'} joined`, text: 'Scan the code with phones that are on the same mobile data or Wi-Fi your players would use at camp. Up to 8. Keep their screens on.', buttons: [
        { label: 'Start probe', primary: true, disabled: n === 0, onClick: () => this.begin() },
        { label: 'Skip', onClick: () => { this.res = { phones: 0, stalledFrac: null, perPhone: [], windows: 0 }; this.finish(); } },
      ] });
    } else {
      patchPanel({ count: `${n} phone${n === 1 ? '' : 's'} joined` });
      const b = document.querySelector('#p0buttons button.primary');
      if (b) b.disabled = n === 0;
    }
  }
  begin() { this.stage = 'probe'; this.probeStart = Date.now(); this.t1 = nowS(); setPanel({ step: 'Connectivity probe', text: 'Phones are pinging the relay. Keep them still with the screen on.', buttons: [{ label: 'Stop', onClick: () => stopAll() }] }); }
  update(t) {
    const online = [...relay.phones.values()].filter((p) => p.online).length;
    if (this.stage === 'join') {
      if (online !== this.lastJoinCount) { this.lastJoinCount = online; this.lastJoinT = t; this.render(); }
      const guided = !!guide;
      if (guided && online > 0 && t - this.lastJoinT > CFG.conn.autoStart) this.begin();
      else if (guided && online === 0 && t - this.tp > CFG.conn.join) { this.res = { phones: 0, stalledFrac: null, perPhone: [], windows: 0 }; this.finish(); }
    } else if (this.stage === 'probe') {
      if (t - this.t1 >= CFG.conn.duration) {
        const end = Date.now();
        this.res = M.analyzeConnectivity(relay.reports, this.probeStart, end);
        this.res.durationS = (end - this.probeStart) / 1000;
        this.finish();
      }
    }
  }
  count() { return this.stage === 'probe' ? `${Math.max(0, Math.ceil(CFG.conn.duration - (nowS() - this.t1)))} s left` : ''; }
  text() { return 'Scan the QR code with phones to test the connection.'; }
  draw(ctx) {
    text(ctx, 'Connectivity test', W / 2, 62, { size: 32 });
    if (relay.code) {
      drawQR(ctx, phoneUrl(), 40, 96, 262);
      text(ctx, 'Room code', 332, 138, { size: 18, align: 'left', color: PAL.textSoft, weight: 700 });
      text(ctx, relay.code, 332, 200, { size: 64, align: 'left' });
      text(ctx, phoneUrl().replace(/^https?:\/\//, ''), 332, 232, { size: 14, align: 'left', weight: 600, color: PAL.textSoft });
    } else text(ctx, 'Connecting to the relay…', 332, 200, { size: 26, align: 'left', color: PAL.textSoft });
    const rows = [...relay.phones.values()];
    text(ctx, rows.length ? `Phones (${rows.length})` : 'Waiting for phones…', 332, 276, { size: 22, align: 'left' });
    rows.slice(0, 8).forEach((p, i) => {
      const x = 332 + (i % 2) * 310, y = 306 + ((i / 2) | 0) * 24;
      const bad = p.lastMax > M.THRESHOLDS.stallRttMs;
      text(ctx, `${p.name}${p.online ? '' : ' (left)'}`, x, y, { size: 16, align: 'left', color: PAL.text, weight: 700 });
      text(ctx, p.lastMedian === undefined ? '…' : `${p.lastMedian} ms (max ${p.lastMax})`, x + 290, y, { size: 16, align: 'right', color: bad ? PAL.spike : PAL.goal, weight: 700 });
    });
  }
  result() { return this.res; }
}

const STEP_DEFS = {
  latency: { title: 'Latency', blurb: 'Hands OUT of the beam. The wall flashes a dark square; we time how long the camera and detector take to notice.', make: (o) => new LatencyStep(o), store: (r) => { results.latency = r; } },
  quiet: { title: 'Quiet room', blurb: 'Nothing in the beam. We count shadows that appear from nowhere.', make: () => new QuietStep({ label: 'clean room' }), store: (r) => putLabelled('quiet', r) },
  ring: { title: 'Shadow fit', blurb: 'Hands IN: fit your shadow into the glowing ring, 10 times.', make: () => new RingStep({ label: 'ring (r=70)', r: 70 }), store: (r) => putLabelled('ring', r) },
  'ring-small': { title: 'Small ring', blurb: 'Hands IN: the same, with a smaller ring (a child-sized shadow).', make: () => new RingStep({ label: 'small ring (r=42)', r: 42 }), store: (r) => putLabelled('ring', r) },
  beam: { title: 'People in beam', blurb: 'Two or three people (and a child) move in the beam, as in a game.', make: () => new BeamStep(), store: (r) => { results.beam = r; } },
  quiet2: { title: 'Quiet + lantern', blurb: 'Light the camp lantern or fire; people stand still at the sides; nothing blocks the beam.', make: () => new QuietStep({ label: 'lantern and people', lantern: true }), store: (r) => putLabelled('quiet', r) },
  recal: { title: 'Recalibrate', blurb: 'Bump the projector, press Recalibrate; we time the recovery.', make: () => new RecalStep(), store: (r) => { if (r) results.recal = r; } },
  conn: { title: 'Connectivity', blurb: 'Phones scan a QR code and ping through the relay.', make: () => new ConnStep(), store: (r) => { if (r) results.connectivity = r; } },
};
const GUIDE_ORDER = ['latency', 'quiet', 'ring', 'ring-small', 'beam', 'quiet2', 'recal', 'conn'];
function putLabelled(key, r) {
  const arr = results[key] || (results[key] = []);
  const i = arr.findIndex((x) => x.label === r.label);
  if (i >= 0) arr[i] = r; else arr.push(r);
}

function runStep(id) {
  return new Promise((resolve) => {
    const def = STEP_DEFS[id];
    const step = def.make();
    step.id = id;
    step.onDone = () => {
      activeStep = null;
      const aborted = step.aborted;
      if (!aborted) def.store(step.result());
      resolve({ aborted });
    };
    activeStep = step;
    phase = 'running';
    step.start(nowS());                       // must come first: count() and text() read state that start() creates
    if (!(step instanceof RecalStep) && !(step instanceof ConnStep)) setPanel({ step: def.title, count: step.count(), text: step.text(), buttons: [{ label: 'Stop', onClick: () => stopAll() }] });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runGuided() {
  guide = { stop: false, skip: false };
  const ids = GUIDE_ORDER;
  for (let i = 0; i < ids.length && !guide.stop; i++) {
    const id = ids[i], def = STEP_DEFS[id];
    // announce
    phase = 'announce';
    announce = { big: def.title, small: def.blurb, n: `${i + 1} of ${ids.length}` };
    guide.skip = false;
    let left = CFG.announce;
    setPanel({ step: `${i + 1}/${ids.length}: ${def.title}`, count: `starts in ${Math.ceil(left)} s`, text: def.blurb, buttons: [
      { label: 'Start now', primary: true, onClick: () => { guide.skip = true; } },
      { label: 'Skip this test', onClick: () => { guide.skip = true; guide.skipStep = true; } },
      { label: 'Stop', onClick: () => stopAll() },
    ] });
    while (left > 0 && !guide.stop && !guide.skip) {
      patchPanel({ count: `starts in ${Math.ceil(left)} s` });
      await sleep(250);
      left -= 0.25;
    }
    announce = null;
    if (guide.stop) break;
    if (guide.skipStep) { guide.skipStep = false; continue; }
    try {
      await runStep(id);
    } catch (e) {
      console.error(e);
      activeStep = null;
      toast(`${def.title} failed: ${e && e.message ? e.message : e}`, 6000);
      results.errors = (results.errors || []).concat(`${id}: ${e && e.message ? e.message : e}`);
    }
    if (guide.stop) break;
    if (i < ids.length - 1) await sleep(CFG.pause * 1000);
  }
  const stopped = guide.stop;
  guide = null;
  announce = null;
  phase = 'ready';
  renderReadyPanel();
  if (!stopped) showReport();
}

function stopAll() {
  if (guide) guide.stop = true;
  if (activeStep) activeStep.abort();
  announce = null;
  if (!guide) { phase = 'ready'; renderReadyPanel(); }
}

function renderReadyPanel() {
  phase = 'ready';
  const rows = M.evaluate(results);
  const statusOf = (match) => { const r = rows.filter((x) => x.id === match || x.id.startsWith(`${match}:`)); return r.length ? (r.some((x) => x.status === 'fail') ? 'bad' : r.some((x) => x.status === 'pass' || x.status === 'warn' || x.status === 'info') ? 'done' : '') : ''; };
  const key = { latency: 'latency', quiet: 'quiet', ring: 'ring', 'ring-small': 'ring', beam: 'beam', quiet2: 'quiet', recal: 'recal', conn: 'connectivity' };
  setPanel({
    step: 'Ready',
    text: 'Live view: put a hand in the beam and check the blue tint follows it. Then run the guided test (about 10 minutes), or run one test.',
    buttons: [
      { label: 'Run guided test ▶', primary: true, onClick: () => runGuided() },
      ...GUIDE_ORDER.map((id) => ({ label: STEP_DEFS[id].title, cls: statusOf(key[id]), onClick: async () => { guide = null; await runStep(id); renderReadyPanel(); } })),
      { label: 'Report', onClick: () => showReport() },
    ],
  });
}

// ------------------------------------------------------------------ report
function metaNow() {
  const camInfo = camera && camera.describe ? camera.describe() : null;
  return {
    when: new Date().toISOString(),
    sim: !!(camera && camera.kind === 'sim'),
    setup: {
      camera: camInfo ? `${camInfo.label} (${camInfo.width}x${camInfo.height}@${camInfo.frameRate || '?'}fps)` : (camera ? camera.kind : 'none'),
      cameraFrameStats: camera && camera.frameStats ? camera.frameStats() : null,
      cameraControls: camInfo ? { canLockExposure: camInfo.canLockExposure, canLockWhiteBalance: camInfo.canLockWhiteBalance, exposureLocked: camInfo.exposureLocked } : null,
      visionFrame: cal ? `${cal.cw}x${cal.ch}` : null,
      visionMsAvg: Number(visMs.toFixed(1)),
      detectorThresholds: detector ? { on: detector.onT, off: detector.offT, gain: Number(detector.gain.toFixed(2)) } : null,
      pageFps: Number(fps.toFixed(0)),
      viewport: `${innerWidth}x${innerHeight} @${window.devicePixelRatio || 1}`,
      canvas: `${stage.canvas.width}x${stage.canvas.height}`,
      secureContext: window.isSecureContext,
      userAgent: navigator.userAgent,
      calibrationAttempts: calAttempts,
    },
  };
}

function reportText() {
  const rows = M.evaluate(results);
  return M.formatReport({ meta: metaNow(), results, rows });
}

function showReport() {
  const rows = M.evaluate(results);
  const ov = M.overall(rows);
  phase = 'report';
  hidePanel();
  $('#simbar').hidden = true;
  const box = $('#rep-rows');
  box.textContent = '';
  const o = document.createElement('p');
  o.className = `overall ${ov === 'GO' ? 'go' : ov === 'NO-GO' ? 'nogo' : 'caution'}`;
  o.textContent = `Overall: ${ov}`;
  box.append(o);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'rep-row';
    const b = document.createElement('span');
    b.className = `badge ${r.status}`;
    b.textContent = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skipped: 'SKIP' }[r.status];
    const body = document.createElement('div');
    const t = document.createElement('div'); t.className = 'rep-title'; t.textContent = r.title + (r.gate ? ' *' : '');
    const s = document.createElement('div'); s.textContent = r.summary;
    body.append(t, s);
    if (r.consequence) { const c = document.createElement('div'); c.className = 'rep-conseq'; c.textContent = r.consequence; body.append(c); }
    row.append(b, body);
    box.append(row);
  }
  $('#p0report').hidden = false;
  $('#rep-msg').textContent = camera && camera.kind === 'sim' ? 'This was the simulator: the numbers say nothing about your hardware.' : '';
}

async function copyReport() {
  const txt = reportText();
  try {
    await navigator.clipboard.writeText(txt);
    $('#rep-msg').textContent = 'Copied. Paste it into the chat.';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    $('#rep-msg').textContent = ok ? 'Copied. Paste it into the chat.' : 'Could not copy automatically: use Download JSON instead.';
  }
}

function downloadJson() {
  const payload = { meta: metaNow(), results, verdicts: M.evaluate(results), overall: M.overall(M.evaluate(results)), thresholds: M.THRESHOLDS };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `umbra-p0-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ------------------------------------------------------------------ frame loop
function drawPreviewImage(img, w, h) {
  const f = fitRect(w, h);
  stage.screen().drawImage(img, f.x, f.y, f.w, f.h);
  return f;
}
function drawQuad(ctx, f, quad, handles) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#00e676';
  ctx.beginPath();
  quad.forEach((q, i) => { const x = f.x + q[0] * f.s, y = f.y + q[1] * f.s; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.stroke();
  if (handles) { ctx.fillStyle = '#ff2f92'; for (const q of quad) { ctx.beginPath(); ctx.arc(f.x + q[0] * f.s, f.y + q[1] * f.s, 12, 0, Math.PI * 2); ctx.fill(); } }
}

function draw(t) {
  stage.clear('#ffffff');
  if (phase === 'aim' && camera) {
    const frame = camera.getFrame();
    preview.canvas.width = camera.width; preview.canvas.height = camera.height;
    preview.ctx.putImageData(new ImageData(new Uint8ClampedArray(frame), camera.width, camera.height), 0, 0);
    drawPreviewImage(preview.canvas, camera.width, camera.height);
    return;
  }
  if ((phase === 'review' || phase === 'adjust') && lastCal) {
    const f = drawPreviewImage(preview.canvas, lastCal.cw, lastCal.ch);
    drawQuad(stage.screen(), f, preview.quad, phase === 'adjust');
    return;
  }
  if (phase === 'calibrating') {
    const c = stage.screen();
    c.fillStyle = PAL.text; c.textAlign = 'center';
    c.font = `900 ${stage.canvas.height * 0.2}px system-ui, sans-serif`;
    c.fillText(announce ? announce.big : '…', stage.canvas.width / 2, stage.canvas.height * 0.52);
    c.font = `700 ${stage.canvas.height * 0.05}px system-ui, sans-serif`;
    c.fillText('Calibrating: keep hands out of the beam', stage.canvas.width / 2, stage.canvas.height * 0.68);
    return;
  }
  if (phase === 'setup') return;
  const ctx = stage.world();
  if (phase === 'announce' && announce) {
    text(ctx, announce.n, W / 2, 130, { size: 26, color: PAL.hint });
    text(ctx, announce.big, W / 2, 230, { size: 84 });
    const words = announce.small.split(' ');
    let line = '', y = 300;
    ctx.font = '600 28px system-ui, sans-serif';
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (ctx.measureText(test).width > 760 && line) { text(ctx, line, W / 2, y, { size: 28, weight: 600, color: PAL.textSoft }); y += 38; line = w; } else line = test; }
    text(ctx, line, W / 2, y, { size: 28, weight: 600, color: PAL.textSoft });
  } else if (phase === 'running' && activeStep) {
    activeStep.draw(ctx, t);
  } else if (phase === 'ready') {
    text(ctx, 'Live view', W / 2, 90, { size: 40 });
    text(ctx, 'Blue tint = what the camera thinks is shadow', W / 2, 130, { size: 24, color: PAL.textSoft });
    text(ctx, `${(vis.coverage * 100).toFixed(1)}% covered`, W / 2, 190, { size: 30, color: PAL.hint });
    maskOverlay(ctx);
  }
  stage.screen();
}

function sizeOverlay() {
  if (overlay.width !== stage.canvas.width || overlay.height !== stage.canvas.height) { overlay.width = stage.canvas.width; overlay.height = stage.canvas.height; }
}
function drawOverlay() {
  sizeOverlay();
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (phase === 'adjust' && lastCal) { drawQuad(octx, fitRect(lastCal.cw, lastCal.ch), preview.quad, true); return; }
  if (!detector || !editor || !camera || camera.kind !== 'sim') return;
  octx.setTransform(stage.scale, 0, 0, stage.scale, stage.ox, stage.oy);
  editor.draw(octx);
}

function updateDebug() {
  if ($('#debug').hidden) return;
  const fs = camera && camera.frameStats ? camera.frameStats() : null;
  $('#dbg-text').textContent = `page ${fps.toFixed(0)} fps · vision ${visMs.toFixed(1)} ms\n` +
    (detector ? `covered ${(vis.coverage * 100).toFixed(1)}% · gain ${detector.gain.toFixed(2)} · valid ${(detector.stats.validFrac * 100).toFixed(0)}%` : 'no detector') +
    (fs && fs.supported ? `\ncamera ${fs.fps ? fs.fps.toFixed(0) : '?'} fps${fs.hasCaptureTime ? ` · capture delay ${fs.captureLatencyMedianMs.toFixed(0)} ms` : ''}` : '');
  const dc = $('#dbg-cam').getContext('2d');
  if (lastFrame && camera) {
    const tmp = document.createElement('canvas');
    tmp.width = camera.width; tmp.height = camera.height;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(lastFrame), camera.width, camera.height), 0, 0);
    dc.drawImage(tmp, 0, 0, 160, 90);
  }
  const mc = $('#dbg-mask').getContext('2d');
  mc.fillStyle = '#fff'; mc.fillRect(0, 0, 160, 90);
  mc.fillStyle = '#2f5bff';
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (vis.mask[j * GW + i]) mc.fillRect(i, j, 1, 1);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (stage.flatColor) { stage.clear(stage.flatColor); octx.clearRect(0, 0, overlay.width, overlay.height); return; }
  if (detector && (phase === 'ready' || phase === 'running' || phase === 'announce')) {
    visAcc += dt;
    if (visAcc >= 0.05) { visAcc = 0; visionTick(); }
  }
  const t = now / 1000;
  try {
    if (activeStep && !activeStep.done) {
      activeStep.update(t);
      if (!(activeStep instanceof RecalStep) && !(activeStep instanceof ConnStep) && !activeStep.done) $('#p0count').textContent = activeStep.count();
    }
    if (activeStep && activeStep.done) { const s = activeStep; activeStep = null; s.onDone(); }
    draw(t);
    drawOverlay();
  } catch (e) {
    console.error(e);
    toast(`Something went wrong: ${e && e.message ? e.message : e}`, 6000);
    results.errors = (results.errors || []).concat(String(e && e.message ? e.message : e));
    if (activeStep) { const s = activeStep; activeStep = null; s.aborted = true; s.done = true; try { s.onDone(); } catch { /* already reported */ } }
  }
  dbgAcc += dt;
  if (dbgAcc > 0.25) { dbgAcc = 0; updateDebug(); }
}

// ------------------------------------------------------------------ boot
function init() {
  stage.onResize = () => { sizeOverlay(); buildDetector(); };
  sizeOverlay();
  $('#btn-cam').onclick = startCamera;
  $('#btn-sim').onclick = startSim;
  $('#rep-copy').onclick = copyReport;
  $('#rep-json').onclick = downloadJson;
  $('#rep-close').onclick = () => { $('#p0report').hidden = true; $('#simbar').hidden = !(camera && camera.kind === 'sim'); renderReadyPanel(); };
  document.querySelectorAll('#simbar [data-tool]').forEach((b) => {
    b.onclick = () => { editor.tool = b.dataset.tool; document.querySelectorAll('#simbar [data-tool]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  $('#s-big').onclick = () => editor && editor.scaleSelected(1.15);
  $('#s-small').onclick = () => editor && editor.scaleSelected(1 / 1.15);
  $('#s-clear').onclick = () => editor && editor.clear();
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') stopAll();
    else if (k === 'm') showMask = !showMask;
    else if (k === 'b') { const d = $('#debug'); d.hidden = !d.hidden; updateIgnore(); }
    else if (k === ' ' || k === 'enter') { const p = document.querySelector('#p0panel button.primary'); if (p && !$('#p0panel').hidden) { e.preventDefault(); p.click(); } }
  });
  let taps = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.clientX > 90 || e.clientY > 90) return;
    const now = performance.now();
    taps = taps.filter((x) => now - x < 800).concat(now);
    if (taps.length >= 3) { taps = []; const d = $('#debug'); d.hidden = !d.hidden; updateIgnore(); }
  });
  navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && fillCameraList().catch(() => {});
  if (AUTO_SIM) startSim();
  window.__p0 = {
    get phase() { return phase; }, get activeStep() { return activeStep; }, get detector() { return detector; }, get camera() { return camera; }, get editor() { return editor; },
    get vis() { return vis; }, results, relay, stage, CFG, STEP_DEFS, runStep, runGuided, stopAll, reportText, showReport,
  };
}

init();
requestAnimationFrame(frame);
