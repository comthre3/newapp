// Umbra P0: the real-projector gate. A guided run that measures whether shadow detection is good
// enough on THIS projector, surface, camera and network, then prints a report to send back.
import qrcode from '../../vendor/qrcode.mjs';
import { Stage } from '../host/stage.js';
import { CameraSource } from '../host/camera.js';
import { SimCamera, SimEditor } from '../host/sim.js';
import { runCalibration } from '../host/calibrate.js';
import { ShadowDetector } from '../core/vision-core.js';
import { GW, GH, CELL, W, H } from '../game/world.js';
import { PAL } from '../game/palette.js';
import { Link, persistentToken, keepAwake } from '../net.js';
import * as M from './metrics.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const FAST = params.has('fast');
const AUTO_SIM = params.has('sim');
const REVIEW = params.has('review');
const STATIC = document.body.classList.contains('static');   // the hosted preview: simulator only, no relay server
const ON_T = Number(params.get('on')) || 0.3;
const OFF_T = Number(params.get('off')) || 0.42;
const VISION_HZ = 20;
const MIN_HZ = 10;            // a timed step must see at least this many camera samples a second, or the page was throttled

// Timings: the real protocol, a short set for the automated test, and a relaxed short set for the hosted preview.
// prep = seconds the wall announces a test before it starts (time to get people and props in place).
const CFG = FAST
  ? { lat: { trials: 6, timeout: 1.5, gap: [0.2, 0.4], clearTimeout: 0.8, maxBad: 3 }, quiet: 5, ring: { trials: 3, timeout: 4, hold: 0.3, restMin: 0.2, restMax: 2, ready: 0.3, after: 0.3 }, beam: 3, conn: { duration: 6, join: 8, autoStart: 1.5 }, prep: () => 0.4, calSpeed: 0.12 }
  : STATIC
    ? { lat: { trials: 6, timeout: 2, gap: [0.5, 1.0], clearTimeout: 3, maxBad: 4 }, quiet: 8, ring: { trials: 3, timeout: 10, hold: 0.6, restMin: 0.5, restMax: 4, ready: 0.8, after: 0.8 }, beam: 8, conn: { duration: 6, join: 8, autoStart: 1.5 }, prep: () => 3, calSpeed: 0.5 }
    : { lat: { trials: 20, timeout: 2, gap: [0.8, 1.6], clearTimeout: 3, maxBad: 6 }, quiet: 60, ring: { trials: 10, timeout: 10, hold: 1, restMin: 0.8, restMax: 6, ready: 1.2, after: 1 }, beam: 30, conn: { duration: 60, join: 45, autoStart: 20 }, prep: (d) => d.prep, calSpeed: 1 };
const SHORT_TIMINGS = FAST || STATIC;

// ------------------------------------------------------------------ core objects
const stage = new Stage($('#stage'));
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
let camera = null;
let editor = null;
let detector = null;
let cal = null;               // accepted calibration {corners, black, white, cw, ch, canvasW, canvasH}
let calStale = '';            // non-empty = why the accepted calibration can no longer be trusted
let lastCal = null;           // latest calibration attempt (for the review screen)
let calManual = false;
let calAttempts = 0;
let phase = 'setup';          // setup | aim | calibrating | review | adjust | ready | announce | running | report
let activeStep = null;
let announce = null;
let running = false;          // a guided run or a single test is in progress
let stopFlag = false;
let ctl = null;               // buttons on the announce screen write here
let guide = null;
let notice = '';              // last interruption, shown on the Ready panel
let showMask = true;
let starting = false;
let wakeStarted = false;
const emptyMeasured = () => ({ half: [1, 1], total: 1, ignored: [0, 0] });
let measured = emptyMeasured();
let vis = { seq: 0, t: 0, mask: new Uint8Array(GW * GH), coverage: 0, half: [0, 0] };
let visAcc = 0, visMs = 0, lastFrame = null, fps = 0, fpsAcc = 0, fpsN = 0, dbgAcc = 0, lastT = performance.now(), healthAcc = 0, ignoreAcc = 0;
let hiddenDuringRun = false;
const results = {};
const preview = { canvas: document.createElement('canvas'), quad: null, drag: -1, touched: false };
preview.ctx = preview.canvas.getContext('2d');
const nowS = () => performance.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const field = (sel) => { const el = $(sel); return el ? el.value.trim() : ''; };

const FLAGS = [
  FAST && 'fast mode: tests are far shorter than the protocol',
  STATIC && 'hosted preview: shortened tests',
  (params.has('on') || params.has('off')) && `detector thresholds changed from the defaults (on ${ON_T}, off ${OFF_T})`,
].filter(Boolean);

// ------------------------------------------------------------------ small UI helpers
let toastTimer = 0;
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function reportError(where, e) {
  const msg = `${where}: ${e && e.message ? e.message : e}`;
  const arr = results.errors || (results.errors = []);
  if (arr.includes(msg)) return;                       // a persistent failure is reported once, not once per frame
  console.error(e);
  arr.push(msg);
  toast(`Something went wrong: ${msg}`, 6000);
}
function clearErrors(prefix) {
  if (!results.errors) return;
  results.errors = results.errors.filter((e) => (prefix ? !e.startsWith(prefix) : false));
  if (!results.errors.length) delete results.errors;
}

/** The control strip. `slim` = one small row (used while something is being measured, so it hides as little as possible). */
function setPanel({ step = '', count = '', text: body = '', buttons = [], slim = false, warn = '' } = {}) {
  const p = $('#p0panel');
  p.hidden = false;
  p.classList.toggle('slim', slim);
  $('#p0step').textContent = step;
  $('#p0count').textContent = count;
  const t = $('#p0text');
  t.textContent = body;
  if (warn) { const w = document.createElement('span'); w.className = 'notice'; w.textContent = ` ${warn}`; t.append(w); }
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
  refreshIgnore(true);
}
const hidePanel = () => { $('#p0panel').hidden = true; refreshIgnore(true); };
/** Update labels in place: rebuilding buttons under a finger would swallow the tap. */
function patchPanel({ step, count, text: body } = {}) {
  if (step !== undefined) $('#p0step').textContent = step;
  if (count !== undefined) $('#p0count').textContent = count;
  if (body !== undefined) $('#p0text').textContent = body;
}

// Parts of the page that sit on top of the projection are not "shadows": the detector ignores their cells.
// Every measurement is normalised to the cells that CAN be measured, and the share that cannot is reported.
let ignoreSig = '';
function refreshIgnore(force = false) {
  if (!detector) return;
  const rects = [];
  // the simulator toolbar is a page element too, but the simulated camera never sees it: only a real camera needs it ignored
  for (const sel of ['#p0panel', '#debug', '#toast', ...(camera && camera.kind === 'sim' ? [] : ['#simbar'])]) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const [x0, y0] = stage.toWorld(r.left, r.top);
    const [x1, y1] = stage.toWorld(r.right, r.bottom);
    rects.push({ x: Math.floor(x0 / CELL) - 1, y: Math.floor(y0 / CELL) - 1, w: Math.ceil((x1 - x0) / CELL) + 2, h: Math.ceil((y1 - y0) / CELL) + 2 });
  }
  const sig = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join('|');
  if (!force && sig === ignoreSig) return;
  ignoreSig = sig;
  detector.setIgnore(rects);
  recomputeMeasured();
}

function recomputeMeasured() {
  if (!detector) { measured = emptyMeasured(); return; }
  const hw = GW >> 1;
  const ok = [0, 0], ign = [0, 0], lane = [0, 0];
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const k = j * GW + i, h = i < hw ? 0 : 1;
      lane[h]++;
      if (detector.ignore && detector.ignore[k]) { ign[h]++; continue; }
      if (detector.valid[k]) ok[h]++;
    }
  }
  measured = { half: [Math.max(1, ok[0]), Math.max(1, ok[1])], total: Math.max(1, ok[0] + ok[1]), ignored: [ign[0] / lane[0], ign[1] / lane[1]] };
}

/** Share of the given cells that the detector cannot see (outside the camera view, too dim, or under the page's own controls). */
function blindFrac(cells) {
  if (!detector || !cells.length) return 1;
  let b = 0;
  for (const k of cells) if (!detector.valid[k] || (detector.ignore && detector.ignore[k])) b++;
  return b / cells.length;
}

// ------------------------------------------------------------------ camera, calibration
function buildDetector() {
  detector = new ShadowDetector({
    gw: GW, gh: GH, cw: cal.cw, ch: cal.ch, corners: cal.corners, black: cal.black, white: cal.white, view: stage.view(),
    onT: ON_T, offT: OFF_T,
  });
  ignoreSig = '';
  refreshIgnore(true);
}

async function fillCameraList() {
  const sel = $('#camsel');
  if (!sel) return;
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

function ensureWake() {
  if (wakeStarted) return;
  wakeStarted = true;
  keepAwake();           // a locked host screen would freeze the camera and quietly thin out every timed test
}

/** A different (or lost) camera: nothing measured with the old one, not even its calibration, may stay in the report. */
function forgetCalibration() {
  cal = null; detector = null; calStale = ''; measured = emptyMeasured(); lastCal = null; notice = '';
  resetResults({ keepCalibration: false });
}

async function startCamera() {
  if (starting) return;                    // a second tap must not open a second camera
  starting = true;
  const btn = $('#btn-cam');
  if (btn) btn.disabled = true;
  $('#setupmsg').textContent = 'Starting camera…';
  try {
    if (!FAST && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      // fullscreen so the page is the whole projected picture (no browser bars) and the window cannot change size later
      try {
        await document.documentElement.requestFullscreen();
        try { await navigator.keyboard.lock(['Escape']); } catch { /* not supported: Esc leaves fullscreen, the Stop button still works */ }
      } catch { /* refused: carry on */ }
    }
    if (camera && camera.stop) camera.stop();
    camera = new CameraSource({ deviceId: field('#camsel') || null });
    await camera.start();
    forgetCalibration();
    document.body.classList.remove('sim');                  // leftovers of a dry run: no toolbar, no simulated results
    $('#simbar').hidden = true;
    ensureWake();
    fillCameraList();
    $('#p0setup').hidden = true;
    setPhase('aim');
  } catch (e) {
    camera = null;
    $('#setupmsg').textContent = `Camera problem: ${e && e.message ? e.message : e}`;
  } finally {
    starting = false;
    if (btn) btn.disabled = false;
  }
}

async function startSim() {
  if (starting) return;
  starting = true;
  try {
    if (camera && camera.stop) camera.stop();
    camera = new SimCamera(stage);
    forgetCalibration();
    document.body.classList.add('sim');
    $('#simbar').hidden = false;
    if (!editor) editor = new SimEditor(stage, camera, overlay); else editor.camera = camera;
    ensureWake();
    $('#p0setup').hidden = true;
  } finally { starting = false; }
  await calibrate();
}

const isPortrait = () => stage.canvas.width < stage.canvas.height;

function setPhase(p) {
  phase = p;
  document.body.classList.toggle('adjusting', p === 'adjust');
  if (p === 'aim') {
    setPanel({ step: 'Aim the camera', text: `Every edge of the bright picture must be visible. Keep the camera steady and hands out of the beam, then calibrate.${isPortrait() ? ' The window is portrait: rotate it to landscape first.' : ''}`, buttons: [
      { label: 'Calibrate', primary: true, onClick: () => calibrate() },
      { label: 'Change camera', onClick: () => { if (camera) camera.stop(); camera = null; forgetCalibration(); $('#p0setup').hidden = false; hidePanel(); phase = 'setup'; } },
    ] });
  } else if (p === 'ready') {
    renderReadyPanel();
  }
}

/** One calibration run. Returns { out, ms }. Shows nothing; callers decide what to do with it. */
async function runCal() {
  const t0 = performance.now();
  const canvas = { w: stage.canvas.width, h: stage.canvas.height };
  document.body.classList.add('flat');
  let out;
  try {
    out = await runCalibration(stage, camera, { speed: camera.kind === 'sim' ? Math.min(0.5, CFG.calSpeed) : CFG.calSpeed });
  } finally {
    document.body.classList.remove('flat');
  }
  out.canvas = canvas;
  calAttempts++;
  return { out, ms: performance.now() - t0 };
}

function loadPreview(out) {
  lastCal = out;
  preview.touched = false;
  preview.canvas.width = out.cw;
  preview.canvas.height = out.ch;
  preview.ctx.putImageData(new ImageData(new Uint8ClampedArray(out.snapshot), out.cw, out.ch), 0, 0);
  const c = out.result.corners;
  preview.quad = c ? [c.tl, c.tr, c.br, c.bl].map((p) => [p[0], p[1]]) : [[0.18, 0.18], [0.82, 0.18], [0.82, 0.82], [0.18, 0.82]].map(([x, y]) => [x * out.cw, y * out.ch]);
}

async function calibrate() {
  if (phase === 'calibrating') return;
  phase = 'calibrating';
  setPanel({ step: 'Calibrating', text: 'Keep hands out of the beam. The wall will flash black, then white.' });
  if (!FAST) for (let n = camera.kind === 'sim' ? 1 : 3; n > 0; n--) { announce = { big: String(n), small: 'Calibrating, keep hands out of the beam' }; phase = 'calibrating'; await sleep(1000); }
  announce = null;
  let out;
  try {
    ({ out } = await runCal());
  } catch (e) {
    reportError('calibration', e);
    setPhase('aim');
    return;
  }
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
    text: out.ok ? `Contrast ${(out.result.contrast * 100).toFixed(0)}%. Does the green outline hug the bright area? Drag the corners if not.` : `${out.message} Drag the four corners onto the bright picture, or retry after re-aiming.`,
    buttons: [
      { label: out.ok ? 'Looks right' : 'Use my corners', primary: true, onClick: acceptCalibration },
      { label: phase === 'adjust' ? 'Done adjusting' : 'Adjust corners', onClick: () => { phase = phase === 'adjust' ? 'review' : 'adjust'; document.body.classList.toggle('adjusting', phase === 'adjust'); reviewPanel(); } },
      { label: 'Retry', onClick: () => { document.body.classList.remove('adjusting'); setPhase('aim'); } },   // back to the live camera view, so re-aiming is not blind
    ],
  });
}

function acceptCalibration() {
  const q = preview.quad;
  const r = lastCal.result;
  if (!r.ok && !preview.touched) { toast('Auto-calibration failed: drag the corners onto the bright picture first, or Retry.', 5000); return; }
  if (lastCal.canvas && (lastCal.canvas.w !== stage.canvas.width || lastCal.canvas.h !== stage.canvas.height)) {
    toast('The window changed size while calibrating: calibrate again.', 5000);
    setPhase('aim');
    return;
  }
  const edited = r.corners ? ['tl', 'tr', 'br', 'bl'].some((k, i) => Math.hypot(r.corners[k][0] - q[i][0], r.corners[k][1] - q[i][1]) > 0.5) : true;
  calManual = edited;
  cal = { corners: { tl: q[0], tr: q[1], br: q[2], bl: q[3] }, black: lastCal.black, white: lastCal.white, cw: lastCal.cw, ch: lastCal.ch, canvasW: stage.canvas.width, canvasH: stage.canvas.height };
  calStale = '';
  notice = '';
  buildDetector();
  const edgeMarginPx = Math.min(...q.map(([x, y]) => Math.min(x, y, lastCal.cw - 1 - x, lastCal.ch - 1 - y)));
  results.calibration = { ok: !!r.ok, manual: calManual, error: r.error || null, contrast: r.contrast, areaFrac: r.areaFrac, fill: r.fill, validFrac: detector.stats.validFrac, cw: cal.cw, ch: cal.ch, attempts: calAttempts, edgeMarginPx: Number(edgeMarginPx.toFixed(1)), quad: q.map(([x, y]) => [Math.round(x), Math.round(y)]) };
  document.body.classList.remove('adjusting');
  setPhase('ready');
}

/** The accepted calibration no longer matches reality (window resized, recalibration failed, camera lost). */
function markStale(reason) {
  if (!cal) return;
  calStale = reason;
  if (activeStep || running) interrupt(reason);
  if (phase === 'ready') renderReadyPanel();
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
  let best = -1, bd = 44 * (overlay.width / Math.max(1, overlay.getBoundingClientRect().width));
  preview.quad.forEach((q, i) => { const d = Math.hypot(f.x + q[0] * f.s - px, f.y + q[1] * f.s - py); if (d < bd) { bd = d; best = i; } });
  preview.drag = best;
  if (best >= 0) overlay.setPointerCapture(e.pointerId);
});
overlay.addEventListener('pointermove', (e) => {
  if (phase !== 'adjust' || preview.drag < 0) return;
  const f = fitRect(lastCal.cw, lastCal.ch);
  const [px, py] = canvasPoint(e);
  preview.quad[preview.drag] = [Math.max(1, Math.min(lastCal.cw - 2, (px - f.x) / f.s)), Math.max(1, Math.min(lastCal.ch - 2, (py - f.y) / f.s))];
  preview.touched = true;
});
overlay.addEventListener('pointerup', () => { preview.drag = -1; });
/** Client position of preview corner i (used by the tests to drag a corner). */
function quadClient(i) {
  const f = fitRect(lastCal.cw, lastCal.ch), r = overlay.getBoundingClientRect(), q = preview.quad[i];
  return [r.left + ((f.x + q[0] * f.s) / overlay.width) * r.width, r.top + ((f.y + q[1] * f.s) / overlay.height) * r.height];
}

// ------------------------------------------------------------------ vision loop
function visionTick() {
  if (!detector || !camera || calStale) return;
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
  // lane coverage = shadow cells / cells that can be measured (cells under the control strip or outside the view do not count)
  vis = { seq: vis.seq + 1, t: performance.now() / 1000, mask, coverage: (l + r) / measured.total, half: [l / measured.half[0], r / measured.half[1]] };
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
function cellsOfDisc(cx, cy, r) {
  const out = [];
  for (let j = Math.max(0, Math.floor((cy - r) / CELL)); j <= Math.min(GH - 1, Math.ceil((cy + r) / CELL)); j++) {
    for (let i = Math.max(0, Math.floor((cx - r) / CELL)); i <= Math.min(GW - 1, Math.ceil((cx + r) / CELL)); i++) {
      if (Math.hypot((i + 0.5) * CELL - cx, (j + 0.5) * CELL - cy) <= r) out.push(j * GW + i);
    }
  }
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
    this.probe = new M.LatencyProbe({ trials: CFG.lat.trials, timeoutS: CFG.lat.timeout, gapS: CFG.lat.gap, clearTimeoutS: CFG.lat.clearTimeout, maxContaminated: CFG.lat.maxBad });
    this.region = { x: 380, y: 160, w: 200, h: 200 };
    this.cells = cellsOfRect(this.region.x, this.region.y, this.region.w, this.region.h);
    this.blind = blindFrac(this.cells);
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
    this.blind = Math.max(this.blind, blindFrac(this.cells));
    if (done) this.finish();
  }
  count() { return `${Math.min(this.probe.index, this.probe.trials)} / ${this.probe.trials}`; }
  text() { return 'Hands out of the beam. The wall flashes a dark square and the camera has to notice. Do not move.'; }
  draw(ctx) {
    text(ctx, `Latency test ${this.count()}`, W / 2, 80, { size: 34 });
    const waiting = !this.dark && this.probe.waitSince !== null;
    text(ctx, waiting ? 'Something is in the square: keep it clear' : 'Keep hands out of the beam', W / 2, 120, { size: 22, color: waiting ? PAL.spike : PAL.textSoft });
    ctx.fillStyle = this.dark ? '#000' : '#fff';
    ctx.fillRect(this.region.x, this.region.y, this.region.w, this.region.h);
    if (waiting) maskOverlay(ctx);
  }
  result() { return { summary: this.probe.summary(), trials: this.probe.results, region: this.region, pollHz: VISION_HZ, blindFrac: this.blind }; }
}

class QuietStep extends Step {
  start(t) {
    super.start(t);
    this.ev = new M.BlobEvents();
    this.peak = 0;
    this.ticks = 0;
    this.seq = vis.seq;
    this.blobs = [];
    this.dur = CFG.quiet;
  }
  update(t) {
    if (vis.seq !== this.seq) {
      this.seq = vis.seq;
      this.ticks++;
      this.blobs = M.findBlobs(vis.mask, GW, GH, 6);
      this.ev.update(this.blobs, t);
      this.peak = Math.max(this.peak, vis.coverage);
    }
    if (t - this.t0 >= this.dur) this.finish();
  }
  left() { return Math.max(0, Math.ceil(this.dur - (nowS() - this.t0))); }
  count() { return `${this.left()} s left, ${this.ev.events.length} phantom${this.ev.events.length === 1 ? '' : 's'}`; }
  text() { return this.opts.lantern ? 'Lantern or fire lit, lamps on, people about but NOT in the beam. Nothing should block the picture.' : 'Nothing in the beam, nobody moving, hands away from the camera. We count shadows that appear from nowhere.'; }
  draw(ctx) {
    text(ctx, `${this.opts.title}: keep still`, W / 2, 80, { size: 34 });
    text(ctx, this.opts.lantern ? 'Lantern lit, people nearby, beam clear' : 'Beam clear, nobody moving', W / 2, 120, { size: 22, color: PAL.textSoft });
    text(ctx, `${this.left()} s`, W / 2, H / 2 + 40, { size: 120, color: PAL.hint });
    text(ctx, `phantoms so far: ${this.ev.events.length}`, W / 2, H / 2 + 100, { size: 28, color: this.ev.events.length ? PAL.spike : PAL.textSoft });
    if (this.blobs.length) maskOverlay(ctx);
  }
  result() {
    const dur = Math.max(1, nowS() - this.t0);
    return {
      label: this.opts.label, lantern: !!this.opts.lantern, durationS: dur, events: this.ev.events, perMinHalf: this.ev.perMinute(dur),
      duty: this.ev.duty(), longest: this.ev.longest(), peakCoverage: this.peak, ticks: this.ticks, expectedTicks: Math.round(dur * MIN_HZ), ignoredFrac: [...measured.ignored],
    };
  }
}

class RingStep extends Step {
  start(t) {
    super.start(t);
    const { cx = 480, cy = 240, r } = this.opts;
    this.cx = cx; this.cy = cy; this.r = r;
    this.cells = cellsOfDisc(cx, cy, r * 1.4);
    this.blind = blindFrac(this.cells);
    this.trials = [];
    this.neverClear = 0;
    this.phase = 'rest';
    this.tp = t;
    this.trial = null;
    this.last = null;
    this.stuck = false;
    this.abandon = false;
  }
  covered() { return M.discCover(vis.mask, this.cx, this.cy, this.r * 1.4) >= 0.05; }
  update(t) {
    const C = CFG.ring;
    this.blind = Math.max(this.blind, blindFrac(this.cells));
    if (this.phase === 'rest') {
      // a trial only starts from a clear ring, so a stuck shadow can never pass as an instant success
      const covered = this.covered();
      this.stuck = covered && t - this.tp > C.restMax;
      if (!covered && t - this.tp > C.restMin) { this.phase = 'ready'; this.tp = t; }
      else if (covered && t - this.tp > C.restMax * 3) {
        this.neverClear++;
        this.last = { success: false, forming: null, peakIoU: 0, void: true };
        this.trials.push(this.last);
        if (this.neverClear >= 2 && this.neverClear > this.trials.length - this.neverClear) this.abandon = true;   // mostly skipped: the run is void anyway, stop wasting minutes
        this.phase = 'result';
        this.tp = t;
      }
    } else if (this.phase === 'ready') {
      if (this.covered()) { this.phase = 'rest'; this.tp = t; }                 // moved in too early: wait again
      else if (t - this.tp > C.ready) { this.trial = new M.RingTrial({ cx: this.cx, cy: this.cy, r: this.r, holdS: C.hold, timeoutS: C.timeout }); this.trial.start(t); this.phase = 'live'; }
    } else if (this.phase === 'live') {
      const st = this.trial.update(vis.mask, t);
      if (st !== 'running') { this.last = this.trial.result(); this.trials.push(this.last); this.phase = 'result'; this.tp = t; }
    } else if (this.phase === 'result') {
      if (t - this.tp > C.after) { if (this.abandon || this.trials.length >= C.trials) this.finish(); else { this.phase = 'rest'; this.tp = t; } }
    }
  }
  count() { return `${this.trials.length} / ${CFG.ring.trials} done`; }
  text() { return 'Hold your hand or a prop in the beam so its shadow fills the glowing ring, and keep it there for a second. Remove it between tries.'; }
  draw(ctx, t) {
    const { cx, cy, r } = this;
    const live = this.phase === 'live';
    text(ctx, `${this.opts.label}  ${Math.min(CFG.ring.trials, this.trials.length + (this.phase === 'result' ? 0 : 1))} / ${CFG.ring.trials}`, W / 2, 70, { size: 34 });
    const ok = this.last && this.last.success;
    let hint = '';
    if (this.phase === 'rest') hint = this.stuck ? 'Something is still in the ring: take it out' : 'Take your shadow out of the ring';
    else if (this.phase === 'ready') hint = 'Get ready…';
    else if (this.phase === 'live') hint = `Fit your shadow into the ring  (${Math.round(this.trial.iou * 100)}%)`;
    else hint = this.last && this.last.void ? 'Skipped: the ring never cleared' : ok ? `Fitted in ${this.last.forming.toFixed(1)} s` : 'Time is up';
    text(ctx, hint, W / 2, 112, { size: 24, color: this.phase === 'result' ? (ok ? PAL.goal : PAL.spike) : this.stuck ? PAL.spike : PAL.textSoft });
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
  result() { return { label: this.opts.label, r: this.r, trials: this.trials, neverClear: this.neverClear, blindFrac: this.blind, summary: M.summarize(this.trials.filter((x) => x.success).map((x) => x.forming)) }; }
}

class BeamStep extends Step {
  start(t) { super.start(t); this.peak = [0, 0]; this.peakTotal = 0; this.maxBlobs = 0; this.dur = CFG.beam; this.seq = vis.seq; this.ticks = 0; }
  update(t) {
    if (vis.seq !== this.seq) {
      this.seq = vis.seq;
      this.ticks++;
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
  result() { return { durationS: nowS() - this.t0, peakHalf: this.peak, peakTotal: this.peakTotal, maxBlobs: this.maxBlobs, ticks: this.ticks, ignoredFrac: [...measured.ignored] }; }
}

class RecalStep extends Step {
  start(t) {
    super.start(t);
    this.busy = false;
    this.res = null;
    setPanel({ step: 'Recalibration after a bump', text: 'Nudge the projector (or the camera) a little, then press Recalibrate. We time the black/white flash and settle until the picture is found again.', buttons: [
      { label: 'Recalibrate now', primary: true, onClick: () => this.go() },
      { label: 'Skip', onClick: () => this.abort() },
    ] });
  }
  async go() {
    if (this.busy || this.done) return;
    this.busy = true;
    setPanel({ step: 'Recalibrating', text: 'Keep hands out of the beam…' });
    const before = cal ? cal.corners : null;
    calStale = calStale || 'the projector was bumped for the recalibration test';     // from here the old registration is suspect, whatever happens next
    let r;
    try { r = await runCal(); } catch (e) { reportError('recal', e); this.abort(); return; }
    const { out, ms } = r;
    let shift = null;
    if (out.ok && before) {
      const keys = ['tl', 'tr', 'br', 'bl'];
      shift = Math.max(...keys.map((k) => Math.hypot(out.result.corners[k][0] - before[k][0], out.result.corners[k][1] - before[k][1])));
    }
    if (out.ok) {
      loadPreview(out);
      const q = preview.quad;
      cal = { corners: { tl: q[0], tr: q[1], br: q[2], bl: q[3] }, black: out.black, white: out.white, cw: out.cw, ch: out.ch, canvasW: stage.canvas.width, canvasH: stage.canvas.height };
      calStale = '';
      buildDetector();
    } else {
      // the old calibration may no longer match the picture: block the vision tests until the user calibrates again
      calStale = 'the recalibration after the bump failed';
    }
    if (this.done) { if (phase === 'ready') renderReadyPanel(); return; }          // stopped meanwhile: keep the new calibration (or the stale mark), record no result
    this.res = { ok: !!out.ok, ms, shiftPx: shift, contrast: out.result.contrast, error: out.result.error || null };
    this.finish();
  }
  update() {}
  text() { return 'Nudge the projector, then press Recalibrate.'; }
  draw(ctx) { text(ctx, 'Bump the projector, then recalibrate', W / 2, H / 2 - 20, { size: 40 }); text(ctx, 'We time the recovery', W / 2, H / 2 + 24, { size: 24, color: PAL.textSoft }); }
  result() { return this.res; }
}

// -- connectivity: phones open /p0-phone.html, ping the host through the relay, and report round-trip times
const relay = { link: null, code: '', phones: new Map(), reports: {}, shareBase: params.get('base') || location.origin, recording: false, fromLanInfo: false };
const isLocalHost = /^(localhost|127\.|\[::1\])/.test(location.hostname);
/** Where the phones will really connect, and whether that is a local network (which says nothing about mobile data). */
function relayInfo() {
  let host = '';
  try { host = new URL(relay.shareBase).hostname; } catch { /* leave empty */ }
  // an address the server itself reported as one of its network interfaces is local by definition, whatever its number
  const lan = relay.fromLanInfo || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || host === '[::1]' || host.endsWith('.local');
  return { host: host || 'unknown', lan, secure: relay.shareBase.startsWith('https:') };
}
const onlinePhones = () => [...relay.phones.values()].filter((p) => p.online);
const tellPhones = (probe) => { if (relay.link) for (const p of onlinePhones()) relay.link.send({ t: 'to', id: p.id, m: { probe } }); };

function ensureRelay() {
  if (relay.link) return;
  let room = '';
  try { room = sessionStorage.getItem('umbra.p0.room') || ''; } catch { /* private mode */ }
  const token = persistentToken('umbra.p0.host');
  relay.link = new Link(() => ({ role: 'host', token, room }), {
    onMessage: (m) => {
      if (m.t === 'room') { relay.code = m.code; room = m.code; try { sessionStorage.setItem('umbra.p0.room', m.code); } catch { /* ignore */ } }
      else if (m.t === 'join') { relay.phones.set(m.id, { id: m.id, name: m.name, online: true, joinedAt: Date.now() }); relay.link.send({ t: 'to', id: m.id, m: { probe: relay.recording ? 'start' : 'done' } }); }   // a phone that comes back after the run is told it is over
      else if (m.t === 'leave') { const p = relay.phones.get(m.id); if (p) p.online = false; }
      else if (m.t === 'in') {
        const p = relay.phones.get(m.id);
        if (!p || !relay.recording) return;                    // no probe running: no replies, nothing recorded
        if (m.k === 'ping') relay.link.send({ t: 'to', id: m.id, m: { pong: m.v } });
        else if (m.k === 'rtt') p.lastMedian = m.v;
        else if (m.k === 'hid') p.hidden = !!m.v;
        else if (m.k === 'gap') p.gap = m.v;
        else if (m.k === 'rttmax') {
          const rows = relay.reports[m.id] || (relay.reports[m.id] = []);
          rows.push({ t: Date.now(), median: p.lastMedian ?? m.v, max: m.v, hidden: !!p.hidden || (p.gap || 0) > 2500 });
          if (rows.length > 600) rows.splice(0, rows.length - 600);
          p.lastMax = m.v;
          p.lastReportAt = Date.now();
        }
      }
    },
  });
  relay.link.connect();
  if (isLocalHost && !params.get('base')) fetch('/api/info').then((r) => r.json()).then(({ lan }) => { if (lan && lan.length) { relay.shareBase = lan[0]; relay.fromLanInfo = true; } }).catch(() => {});
}
const phoneUrl = () => `${relay.shareBase.replace(/\/$/, '')}/p0-phone.html?room=${relay.code}`;

class ConnStep extends Step {
  start(t) {
    super.start(t);
    ensureRelay();
    relay.recording = true;
    relay.reports = {};
    tellPhones('start');
    this.stage = 'join';
    this.tp = t;
    this.lastJoinCount = onlinePhones().length;
    this.lastJoinT = t;
    this.autoAt = null;
    this.participants = [];
    this.notReporting = 0;
    this.probeStart = null;
    this.t1 = 0;
    this.res = null;
    this.render();
  }
  render() {
    if (this.stage !== 'join') return;                    // the probe strip must not be overwritten by the join strip
    const n = onlinePhones().length;
    const label = `${n} phone${n === 1 ? '' : 's'} joined`;
    if (!this.built) {
      this.built = true;
      setPanel({ step: 'Connectivity', count: label, slim: true, buttons: [
        { label: 'Start probe', primary: true, disabled: n === 0, onClick: () => this.begin() },
        { label: 'Skip', onClick: () => this.abort() },
      ] });
    } else {
      patchPanel({ count: this.autoAt !== null && n > 0 ? `${label}, probe starts in ${Math.max(0, Math.ceil(this.autoAt - nowS()))} s` : label });
      const b = document.querySelector('#p0buttons button.primary');
      if (b) b.disabled = n === 0;
    }
  }
  begin() {
    if (this.stage !== 'join') return;
    // only phones that are connected AND reporting right now take part; ghosts of earlier runs and late joiners never count
    const online = onlinePhones();
    const fresh = online.filter((p) => p.lastReportAt && Date.now() - p.lastReportAt < 3000);
    if (!fresh.length) { toast('Waiting for the phones to start reporting…', 2500); this.autoAt = nowS() + 1; return; }
    this.notReporting = online.length - fresh.length;           // joined but silent: said so in the report, not dropped quietly
    this.participants = fresh.map((p) => String(p.id));
    this.stage = 'probe';
    this.probeStart = Date.now();
    this.t1 = nowS();
    this.built = false;
    setPanel({ step: 'Connectivity probe', slim: true, buttons: [{ label: 'Stop', onClick: () => stopAll() }] });
  }
  finishProbe() {
    const end = Date.now();
    const left = this.participants.filter((id) => { const p = relay.phones.get(Number(id)); return !p || !p.online; });
    const info = relayInfo();
    this.res = M.analyzeConnectivity(relay.reports, this.probeStart, end, { participants: this.participants, left });
    this.res.durationS = (end - this.probeStart) / 1000;
    this.res.relayHost = info.host;
    this.res.lan = info.lan;
    this.res.secure = info.secure;
    this.res.notReporting = this.notReporting;
    this.finish();
  }
  update(t) {
    const online = onlinePhones().length;
    if (this.stage === 'join') {
      if (online !== this.lastJoinCount) { this.lastJoinCount = online; this.lastJoinT = t; this.autoAt = null; }
      if (online > 0 && guide) {
        if (this.autoAt === null) this.autoAt = this.lastJoinT + CFG.conn.autoStart;       // more phones can still join until then
        if (t >= this.autoAt) this.begin();
      } else if (guide && online === 0 && t - this.tp > CFG.conn.join) this.abort();
      this.render();
    } else if (this.stage === 'probe') {
      // a phone whose page is hidden cannot answer: mark its seconds as "slept" rather than as a network stall
      const now = Date.now();
      for (const id of this.participants) {
        const p = relay.phones.get(Number(id));
        if (p && p.online && p.hidden && now - (p.lastSleepMark || 0) >= 1000) { p.lastSleepMark = now; (relay.reports[id] || (relay.reports[id] = [])).push({ t: now, median: null, max: 0, hidden: true }); }
      }
      if (t - this.t1 >= CFG.conn.duration) this.finishProbe();
    }
  }
  count() { return this.stage === 'probe' ? `${Math.max(0, Math.ceil(CFG.conn.duration - (nowS() - this.t1)))} s left` : ''; }
  text() { return 'Scan the QR code with phones to test the connection.'; }
  finish() { relay.recording = false; tellPhones('done'); super.finish(); }
  abort() { relay.recording = false; tellPhones('done'); super.abort(); }
  draw(ctx) {
    const info = relayInfo();
    text(ctx, 'Connectivity test', W / 2, 52, { size: 32 });
    if (relay.code) {
      drawQR(ctx, phoneUrl(), 40, 76, 240);
      text(ctx, 'Room code', 310, 112, { size: 18, align: 'left', color: PAL.textSoft, weight: 700 });
      text(ctx, relay.code, 310, 172, { size: 64, align: 'left' });
      text(ctx, phoneUrl().replace(/^https?:\/\//, ''), 310, 200, { size: 14, align: 'left', weight: 600, color: PAL.textSoft });
      text(ctx, info.lan ? 'Local network only: this does NOT test mobile data at camp' : `Relay: ${info.host}`, 310, 224, { size: 15, align: 'left', weight: 700, color: info.lan ? PAL.spike : PAL.textSoft });
    } else text(ctx, 'Connecting to the relay…', 310, 172, { size: 26, align: 'left', color: PAL.textSoft });
    const rows = [...relay.phones.values()];
    text(ctx, rows.length ? `Phones (${rows.length})` : 'Waiting for phones… scan the code, keep their screens on', 310, 262, { size: 20, align: 'left' });
    rows.slice(0, 8).forEach((p, i) => {
      const x = 310 + (i % 2) * 320, y = 290 + ((i / 2) | 0) * 24;
      const bad = p.lastMax > M.THRESHOLDS.stallRttMs;
      text(ctx, `${p.name}${p.online ? '' : ' (left)'}${p.hidden ? ' (screen off)' : ''}`, x, y, { size: 16, align: 'left', color: PAL.text, weight: 700 });
      text(ctx, p.lastMedian === undefined ? '…' : `${p.lastMedian} ms (max ${p.lastMax})`, x + 300, y, { size: 16, align: 'right', color: bad ? PAL.spike : PAL.goal, weight: 700 });
    });
    if (this.stage === 'probe') text(ctx, `Probing ${this.participants.length} phone${this.participants.length === 1 ? '' : 's'}: keep them still, screens on`, W / 2, H - 150, { size: 22, color: PAL.hint });
    else text(ctx, 'Scan with phones on the network your players would use. Up to 8.', W / 2, H - 150, { size: 20, color: PAL.textSoft, weight: 700 });
  }
  result() { return this.res; }
}

const STEP_DEFS = {
  latency: { title: 'Latency', prep: 6, blurb: 'Hands OUT of the beam. The wall flashes a dark square; we time how long the camera and detector take to notice.', make: () => new LatencyStep(), store: (r) => { results.latency = r; } },
  quiet: { title: 'Quiet room', prep: 8, blurb: 'Nothing in the beam, nobody moving. We count shadows that appear from nowhere.', make: () => new QuietStep({ label: M.LABELS.quietClean, title: 'Quiet room' }), store: (r) => putLabelled('quiet', r) },
  ring: { title: 'Shadow fit', prep: 6, blurb: 'Hands IN: fit your shadow into the glowing ring, 10 times. Take it out between tries.', make: () => new RingStep({ label: M.LABELS.ring, r: 70 }), store: (r) => putLabelled('ring', r) },
  'ring-small': { title: 'Small ring', prep: 5, blurb: 'Hands IN: the same, with a smaller ring (a child-sized shadow).', make: () => new RingStep({ label: M.LABELS.ringSmall, r: 42 }), store: (r) => putLabelled('ring', r) },
  beam: { title: 'People in beam', prep: 20, blurb: 'Two or three people (and a child) stand and move in the beam, as in a game. Get into position.', make: () => new BeamStep(), store: (r) => { results.beam = r; } },
  quiet2: { title: 'Quiet + lantern', prep: 30, blurb: 'Light the camp lantern or fire and switch on lamps. People stay nearby, but nothing and nobody in the beam.', make: () => new QuietStep({ label: M.LABELS.quietLantern, title: 'Lantern nearby', lantern: true }), store: (r) => putLabelled('quiet', r) },
  recal: { title: 'Recalibrate', prep: 6, blurb: 'Bump the projector, press Recalibrate; we time the recovery.', make: () => new RecalStep(), store: (r) => { if (r) results.recal = r; } },
  conn: { title: 'Connectivity', prep: 5, blurb: 'Phones scan a QR code and ping through the relay.', make: () => new ConnStep(), store: (r) => { if (r) results.connectivity = r; } },
};
const GUIDE_ORDER = ['latency', 'quiet', 'ring', 'ring-small', 'beam', 'quiet2', 'recal', ...(STATIC ? [] : ['conn'])];   // the hosted preview has no relay server
const ROW_OF = { latency: 'latency', quiet: `quiet:${M.LABELS.quietClean}`, ring: `ring:${M.LABELS.ring}`, 'ring-small': `ring:${M.LABELS.ringSmall}`, beam: 'beam', quiet2: `quiet:${M.LABELS.quietLantern}`, recal: 'recal', conn: 'connectivity' };
const SLIM_STEPS = new Set(['latency', 'quiet', 'ring', 'ring-small', 'beam', 'quiet2']);     // tests where the strip must hide as little as possible
function putLabelled(key, r) {
  const arr = results[key] || (results[key] = []);
  const i = arr.findIndex((x) => x.label === r.label);
  if (i >= 0) arr[i] = r; else arr.push(r);
}
function resetResults({ keepCalibration = true } = {}) {
  const cal0 = results.calibration;
  for (const k of Object.keys(results)) delete results[k];
  if (keepCalibration && cal0) results.calibration = cal0;
}

function runStep(id) {
  return new Promise((resolve) => {
    const def = STEP_DEFS[id];
    const needsVision = id !== 'recal' && id !== 'conn';
    if (needsVision && (!detector || calStale)) {
      toast(calStale ? `Calibration is out of date (${calStale}): calibrate again first.` : 'Calibrate first.', 4500);
      resolve({ aborted: true });
      return;
    }
    clearErrors(`${id}:`);
    notice = '';
    const step = def.make();
    step.id = id;
    step.onDone = () => {
      activeStep = null;
      const aborted = step.aborted;
      if (id === 'conn' && relay.recording) { relay.recording = false; tellPhones('done'); }
      if (!aborted) { try { def.store(step.result()); } catch (e) { reportError(id, e); } }
      resolve({ aborted });
    };
    activeStep = step;
    phase = 'running';
    try {
      // the small strip goes up BEFORE the test starts, so the test's blind-area check sees the layout it will really run under
      if (SLIM_STEPS.has(id)) setPanel({ step: def.title, count: '', slim: true, buttons: [{ label: 'Stop', onClick: () => stopAll() }] });
      step.start(nowS());
    } catch (e) {
      reportError(id, e);
      step.aborted = true; step.done = true;
    }
  });
}

/** Tell the operator what is about to happen; returns 'go' | 'skip' | 'stop'. */
async function announceStep(id, tag, canSkip) {
  const def = STEP_DEFS[id];
  phase = 'announce';
  announce = { big: def.title, small: def.blurb, n: tag };
  const mine = { action: null };
  ctl = mine;
  setPanel({ step: tag ? `${tag}: ${def.title}` : def.title, text: def.blurb, buttons: [
    { label: 'Start now', primary: true, onClick: () => { mine.action = 'go'; } },
    ...(canSkip ? [{ label: 'Skip this test', onClick: () => { mine.action = 'skip'; } }] : []),
    { label: 'Stop', onClick: () => stopAll() },
  ] });
  let left = CFG.prep(def);
  while (left > 0 && !mine.action && !stopFlag) {
    patchPanel({ count: `starts in ${Math.ceil(left)} s` });
    await sleep(250);
    left -= 0.25;
  }
  announce = null;
  ctl = null;
  if (stopFlag || mine.action === 'stop') return 'stop';
  return mine.action === 'skip' ? 'skip' : 'go';
}

async function runGuided() {
  if (running) return;
  running = true;
  stopFlag = false;
  notice = '';
  resetResults({ keepCalibration: true });
  guide = { stop: false };
  const ids = GUIDE_ORDER;
  try {
    for (let i = 0; i < ids.length && !stopFlag; i++) {
      const id = ids[i];
      const act = await announceStep(id, `${i + 1} of ${ids.length}`, true);
      if (act === 'stop') break;
      if (act === 'skip') continue;
      try {
        await runStep(id);
      } catch (e) {
        activeStep = null;
        reportError(id, e);
      }
    }
  } finally {
    running = false;
    guide = null;
    announce = null;
    ctl = null;
    goIdle();
  }
  if (!stopFlag) showReport();
}

async function runSingle(id) {
  if (running) return;
  running = true;
  stopFlag = false;
  try {
    const act = await announceStep(id, '', false);
    if (act === 'go') await runStep(id);
  } catch (e) {
    activeStep = null;
    reportError(id, e);
  } finally {
    running = false;
    announce = null;
    ctl = null;
    goIdle();
  }
}

/** Back to the screen that fits what exists: Ready if calibrated, Aim if only a camera, Setup otherwise. */
function goIdle() {
  announce = null;
  activeStep = null;
  if (phase === 'calibrating' || phase === 'review' || phase === 'adjust') return;
  if (detector && cal) setPhase('ready');
  else if (camera) setPhase('aim');
  else { phase = 'setup'; hidePanel(); $('#p0setup').hidden = false; }
}

function stopAll() {
  if (!running && !activeStep) { if (phase === 'ready' || phase === 'running' || phase === 'announce') goIdle(); return; }
  stopFlag = true;
  if (ctl) ctl.action = 'stop';
  if (activeStep) activeStep.abort();
}

/** Something outside the test made the measurement worthless (page hidden, camera lost, window resized): discard it. */
function interrupt(reason) {
  if (!running && !activeStep) return;
  notice = `Interrupted: ${reason}. That test was discarded; run it again.`;
  toast(notice, 8000);
  stopAll();
}

function renderReadyPanel() {
  phase = 'ready';
  const rows = M.evaluate(results);
  const statusOf = (id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return '';
    return r.status === 'fail' || r.status === 'invalid' ? 'bad' : r.status === 'warn' ? 'warn' : r.status === 'skipped' ? '' : 'done';
  };
  const stale = calStale ? `Calibration is out of date (${calStale}): calibrate again before testing.` : '';
  setPanel({
    step: 'Ready',
    text: 'Live view: put a hand in the beam and check the blue tint follows it. Then run the guided test (about 10 minutes), or run one test.',
    warn: stale || notice,
    buttons: [
      calStale ? { label: 'Calibrate again', primary: true, onClick: () => setPhase('aim') } : { label: 'Run guided test ▶', primary: true, onClick: () => runGuided() },
      ...GUIDE_ORDER.map((id) => ({ label: STEP_DEFS[id].title, cls: statusOf(ROW_OF[id]), onClick: () => runSingle(id) })),
      ...(calStale ? [] : [{ label: 'Re-aim', onClick: () => setPhase('aim') }]),
      { label: 'Report', onClick: () => showReport() },
    ],
  });
}

// ------------------------------------------------------------------ report
function flagsNow() {
  const f = [...FLAGS];
  if (isPortrait()) f.push('portrait window: the test picture was squeezed into a thin strip');
  return f;
}

function metaNow() {
  const camInfo = camera && camera.describe ? camera.describe() : null;
  const info = relayInfo();
  return {
    when: new Date().toISOString(),
    sim: !!(camera && camera.kind === 'sim'),
    flags: flagsNow(),
    setup: {
      projectorConnection: field('#projlink') || 'not stated',
      notes: field('#notes') || 'none',
      camera: camInfo ? `${camInfo.label} (${camInfo.width}x${camInfo.height}@${camInfo.frameRate || '?'}fps)` : (camera ? camera.kind : 'none'),
      cameraFrameStats: camera && camera.frameStats ? camera.frameStats() : null,
      cameraControls: camInfo ? { canLockExposure: camInfo.canLockExposure, canLockWhiteBalance: camInfo.canLockWhiteBalance, exposureLocked: camInfo.exposureLocked } : null,
      visionFrame: cal ? `${cal.cw}x${cal.ch}` : null,
      calibrationQuad: results.calibration ? results.calibration.quad : null,
      visionMsAvg: Number(visMs.toFixed(1)),
      detectorThresholds: detector ? { on: detector.onT, off: detector.offT, gain: Number(detector.gain.toFixed(2)) } : null,
      pageFps: Number(fps.toFixed(0)),
      viewport: `${innerWidth}x${innerHeight} @${window.devicePixelRatio || 1}`,
      canvas: `${stage.canvas.width}x${stage.canvas.height}`,
      fullscreen: !!document.fullscreenElement,
      controlStripBlindShare: `left ${(measured.ignored[0] * 100).toFixed(1)}%, right ${(measured.ignored[1] * 100).toFixed(1)}% of a lane (while the strip is up)`,
      relay: STATIC ? 'none (hosted preview)' : `${info.host} (${info.lan ? 'local network' : 'internet'}${info.secure ? ', https' : ', plain http'})`,
      secureContext: window.isSecureContext,
      wakeLock: 'wakeLock' in navigator,
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
  const flags = flagsNow();
  if (flags.length) { const f = document.createElement('p'); f.className = 'flag'; f.textContent = `Not a valid measurement: ${flags.join('; ')}.`; box.append(f); }
  const o = document.createElement('p');
  o.className = `overall ${ov === 'GO' ? 'go' : ov === 'NO-GO' || ov === 'INVALID RUN' ? 'nogo' : 'caution'}`;
  o.textContent = `Overall: ${ov}`;
  box.append(o);
  const notes = [];
  const nr = M.notRun(rows);
  if (nr.length) notes.push(`Not run or invalid: ${nr.join('; ')}.`);
  for (const a of M.attention(rows)) notes.push(`Needs attention: ${a}`);
  for (const n of notes) { const p = document.createElement('p'); p.className = 'note'; p.textContent = n; box.append(p); }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'rep-row';
    const b = document.createElement('span');
    b.className = `badge ${r.status}`;
    b.textContent = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skipped: 'SKIP', invalid: 'ERROR' }[r.status];
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
  const rows = M.evaluate(results);
  const payload = { meta: metaNow(), results, verdicts: rows, overall: M.overall(rows), thresholds: M.THRESHOLDS };
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
    if (calStale) {
      text(ctx, 'Calibration is out of date', W / 2, 200, { size: 44, color: PAL.spike });
      text(ctx, calStale, W / 2, 245, { size: 24, color: PAL.textSoft });
    } else {
      text(ctx, 'Live view', W / 2, 90, { size: 40 });
      text(ctx, 'Blue tint = what the camera thinks is shadow', W / 2, 130, { size: 24, color: PAL.textSoft });
      text(ctx, `${(vis.coverage * 100).toFixed(1)}% covered`, W / 2, 190, { size: 30, color: PAL.hint });
      maskOverlay(ctx);
    }
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

/** Camera still alive and delivering? A dead or frozen camera would make every later test pass on a stale picture. */
function checkCamera() {
  if (!camera || !camera.health || !(phase === 'running' || phase === 'announce' || phase === 'ready')) return;
  const h = camera.health();
  if (h.ok) return;
  const reason = `camera lost: ${h.reason}`;
  interrupt(reason);
  camera.stop();
  camera = null;
  forgetCalibration();
  phase = 'setup';
  hidePanel();
  $('#p0setup').hidden = false;
  $('#setupmsg').textContent = `The camera stopped (${h.reason}). Start it again, then calibrate.`;
}

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - lastT) / 1000;
  const dt = Math.min(0.1, rawDt);
  lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (stage.flatColor) { stage.clear(stage.flatColor); octx.clearRect(0, 0, overlay.width, overlay.height); return; }
  const t = now / 1000;
  try {
    // a long gap between frames means the page was hidden or frozen: whatever was being measured is worthless
    if ((hiddenDuringRun || rawDt > 1.5) && (activeStep || running) && phase !== 'calibrating') interrupt(hiddenDuringRun ? 'the page was hidden (locked screen or another tab)' : `the page froze for ${rawDt.toFixed(1)} s`);
    hiddenDuringRun = false;
    healthAcc += dt;
    if (healthAcc > 0.5) { healthAcc = 0; checkCamera(); }
    ignoreAcc += dt;
    if (ignoreAcc > 0.25) { ignoreAcc = 0; refreshIgnore(); }
    if (detector && (phase === 'ready' || phase === 'running' || phase === 'announce')) {
      visAcc += dt;
      if (visAcc >= 1 / VISION_HZ) { visAcc = Math.min(visAcc - 1 / VISION_HZ, 1 / VISION_HZ); visionTick(); }   // carry the remainder so the rate is not rounded down to every 4th frame
    }
    if (activeStep && !activeStep.done) {
      activeStep.update(t);
      if (!(activeStep instanceof RecalStep) && !(activeStep instanceof ConnStep) && !activeStep.done) $('#p0count').textContent = activeStep.count();
    }
    if (activeStep && activeStep.done) { const s = activeStep; activeStep = null; s.onDone(); }
    draw(t);
    drawOverlay();
  } catch (e) {
    reportError(activeStep ? `${activeStep.id || 'test'}` : 'page', e);
    if (activeStep) { const s = activeStep; activeStep = null; s.aborted = true; s.done = true; try { s.onDone(); } catch { /* already reported */ } }
  }
  dbgAcc += dt;
  if (dbgAcc > 0.25) { dbgAcc = 0; try { updateDebug(); } catch { /* diagnostics only */ } }
}

// ------------------------------------------------------------------ boot
function init() {
  stage.onResize = () => {
    sizeOverlay();
    // the picture the camera calibrated against is gone: do not keep measuring against it
    if (cal && (stage.canvas.width !== cal.canvasW || stage.canvas.height !== cal.canvasH)) markStale('the window changed size or was rotated after calibration');
  };
  sizeOverlay();
  if (isPortrait()) $('#setupmsg').textContent = 'This window is portrait: rotate it (or use a landscape display) before you start.';
  const btnCam = $('#btn-cam');
  if (btnCam) btnCam.onclick = startCamera;
  $('#btn-sim').onclick = startSim;
  $('#rep-copy').onclick = copyReport;
  const btnJson = $('#rep-json');
  if (btnJson) btnJson.onclick = downloadJson;
  const btnReset = $('#rep-reset');
  if (btnReset) btnReset.onclick = () => { resetResults({ keepCalibration: true }); notice = ''; showReport(); $('#rep-msg').textContent = 'Results cleared. The calibration is kept.'; };
  $('#rep-close').onclick = () => { $('#p0report').hidden = true; $('#simbar').hidden = !(camera && camera.kind === 'sim'); if (detector && cal) renderReadyPanel(); else goIdle(); };
  document.querySelectorAll('#simbar [data-tool]').forEach((b) => {
    b.onclick = () => { editor.tool = b.dataset.tool; document.querySelectorAll('#simbar [data-tool]').forEach((x) => x.classList.toggle('on', x === b)); };
  });
  $('#s-big').onclick = () => editor && editor.scaleSelected(1.15);
  $('#s-small').onclick = () => editor && editor.scaleSelected(1 / 1.15);
  $('#s-clear').onclick = () => editor && editor.clear();
  document.addEventListener('visibilitychange', () => { if (document.hidden && (activeStep || running)) hiddenDuringRun = true; });
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') stopAll();
    else if (k === 'm') showMask = !showMask;
    else if (k === 'b') { const d = $('#debug'); d.hidden = !d.hidden; refreshIgnore(true); }
    else if (k === ' ' || k === 'enter') { const p = document.querySelector('#p0panel button.primary'); if (p && !$('#p0panel').hidden && !p.disabled) { e.preventDefault(); p.click(); } }
  });
  let taps = [];
  window.addEventListener('pointerdown', (e) => {
    if (e.clientX > 90 || e.clientY > 90) return;
    const now = performance.now();
    taps = taps.filter((x) => now - x < 800).concat(now);
    if (taps.length >= 3) { taps = []; const d = $('#debug'); d.hidden = !d.hidden; refreshIgnore(true); }
  });
  if (!STATIC && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) fillCameraList().catch(() => {});
  if (AUTO_SIM) startSim();
  window.__p0 = {
    get phase() { return phase; }, get activeStep() { return activeStep; }, get detector() { return detector; }, get camera() { return camera; }, get editor() { return editor; },
    get vis() { return vis; }, get measured() { return measured; }, get calStale() { return calStale; }, get notice() { return notice; }, get running() { return running; },
    results, relay, stage, CFG, STEP_DEFS, runStep, runGuided, runSingle, stopAll, reportText, showReport, quadClient, markStale, interrupt, refreshIgnore,
  };
}

init();
requestAnimationFrame(frame);
