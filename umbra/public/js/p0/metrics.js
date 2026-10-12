// Real-projector gate (P0): the measurement logic, kept free of DOM so it can be unit-tested.
// Thresholds come from docs/GAME_DESIGN.md section 15 ("Kill criteria"). They are the design's
// ASSUMPTIONS, not laws of nature: the report always prints the number next to the threshold.
import { GW, GH, CELL } from '../game/world.js';

export const THRESHOLDS = {
  ringPassFrac: 0.8,          // adult fits the ring in 8 of 10 tries
  ringWarnFrac: 0.6,
  ringIoU: 0.6,               // "fit" = overlap of shadow and target of at least this, held ringHoldS
  ringHoldS: 1,
  ringTimeoutS: 10,
  noiseSdPassS: 1.0,          // sd of forming time over repeats of the same target
  latencyMedianPassMs: 300,
  latencyP95PassMs: 450,
  latencyMedianWarnMs: 500,
  phantomPerMinPerHalf: 1,    // phantom blobs per lane (half-wall) per minute
  areaCap: 0.25,              // design cap for shadow area per lane
  recalPassMs: 6000,
  recalWarnMs: 10000,
  stallRttMs: 500,
  stallWindowS: 5,
  stallMaxFrac: 0.25,
  validFracPass: 0.9,
  validFracWarn: 0.7,
  contrastWarn: 0.15,
};

// ------------------------------------------------------------------ statistics
const finite = (a) => a.filter((x) => typeof x === 'number' && Number.isFinite(x));

export function percentile(arr, p) {
  const a = finite(arr).sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
export const median = (a) => percentile(a, 50);
export function mean(a) {
  const f = finite(a);
  return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null;
}
/** Sample standard deviation (n-1); null with fewer than 2 values. */
export function sd(a) {
  const f = finite(a);
  if (f.length < 2) return null;
  const m = mean(f);
  return Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / (f.length - 1));
}
export function summarize(a) {
  const f = finite(a);
  return { n: f.length, mean: mean(f), sd: sd(f), median: median(f), p95: percentile(f, 95), min: f.length ? Math.min(...f) : null, max: f.length ? Math.max(...f) : null };
}

// ------------------------------------------------------------------ blobs and phantom events
/** 4-connected components of a shadow mask with at least `minCells` cells. Coordinates are grid cells. */
export function findBlobs(mask, gw = GW, gh = GH, minCells = 6) {
  const seen = new Uint8Array(gw * gh);
  const stack = new Int32Array(gw * gh);
  const blobs = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, size = 0, sx = 0, sy = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp) {
      const p = stack[--sp];
      const x = p % gw, y = (p / gw) | 0;
      size++; sx += x; sy += y;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < gw - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - gw] && !seen[p - gw]) { seen[p - gw] = 1; stack[sp++] = p - gw; }
      if (y < gh - 1 && mask[p + gw] && !seen[p + gw]) { seen[p + gw] = 1; stack[sp++] = p + gw; }
    }
    if (size >= minCells) blobs.push({ cells: size, cx: sx / size, cy: sy / size });
  }
  return blobs;
}

/**
 * Counts "phantom" events: a blob that appears after the board has been quiet for a few ticks.
 * Each event is attributed to the left (0) or right (1) half of the wall = one lane.
 */
export class BlobEvents {
  constructor({ gw = GW, quietTicks = 3 } = {}) {
    this.gw = gw;
    this.quietTicks = quietTicks;
    this.quiet = quietTicks;
    this.active = false;
    this.events = [];
    this.peakCells = 0;
  }

  update(blobs, t) {
    if (blobs.length) {
      if (!this.active && this.quiet >= this.quietTicks) {
        const big = blobs.reduce((a, b) => (b.cells > a.cells ? b : a));
        this.events.push({ t, half: big.cx < this.gw / 2 ? 0 : 1, cells: big.cells });
      }
      this.active = true;
      this.quiet = 0;
      for (const b of blobs) this.peakCells = Math.max(this.peakCells, b.cells);
    } else {
      this.active = false;
      this.quiet++;
    }
  }

  perMinute(durationS) {
    const k = 60 / Math.max(1, durationS);
    return [this.events.filter((e) => e.half === 0).length * k, this.events.filter((e) => e.half === 1).length * k];
  }
}

// ------------------------------------------------------------------ ring fitting
/** Overlap (IoU) between the shadow mask and a disc target, measured in a box around the target. World px in. */
export function ringIoU(mask, cx, cy, r, { gw = GW, gh = GH, cell = CELL, pad = 0.6 } = {}) {
  const ext = r * (1 + pad);
  const i0 = Math.max(0, Math.floor((cx - ext) / cell)), i1 = Math.min(gw - 1, Math.ceil((cx + ext) / cell));
  const j0 = Math.max(0, Math.floor((cy - ext) / cell)), j1 = Math.min(gh - 1, Math.ceil((cy + ext) / cell));
  let inter = 0, uni = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const inTarget = Math.hypot((i + 0.5) * cell - cx, (j + 0.5) * cell - cy) <= r;
      const shadow = mask[j * gw + i] === 1;
      if (inTarget && shadow) inter++;
      if (inTarget || shadow) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

/** Share of cells inside the disc that are shadow (0..1). Used to wait for the player to clear the target. */
export function discCover(mask, cx, cy, r, { gw = GW, gh = GH, cell = CELL } = {}) {
  let n = 0, hit = 0;
  for (let j = Math.max(0, Math.floor((cy - r) / cell)); j <= Math.min(gh - 1, Math.ceil((cy + r) / cell)); j++) {
    for (let i = Math.max(0, Math.floor((cx - r) / cell)); i <= Math.min(gw - 1, Math.ceil((cx + r) / cell)); i++) {
      if (Math.hypot((i + 0.5) * cell - cx, (j + 0.5) * cell - cy) <= r) { n++; hit += mask[j * gw + i]; }
    }
  }
  return n ? hit / n : 0;
}

/** One attempt at fitting a shadow into a ring. Times are seconds on any monotonic clock. */
export class RingTrial {
  constructor({ cx, cy, r, iou = THRESHOLDS.ringIoU, holdS = THRESHOLDS.ringHoldS, timeoutS = THRESHOLDS.ringTimeoutS }) {
    Object.assign(this, { cx, cy, r, iouMin: iou, holdS, timeoutS });
    this.t0 = null;
    this.holdStart = null;
    this.state = 'idle';
    this.peak = 0;
    this.iou = 0;
    this.holdProgress = 0;
    this.forming = null;
    this.holdIoU = [];
  }

  start(t) { this.t0 = t; this.state = 'running'; }

  update(mask, t) {
    if (this.state !== 'running') return this.state;
    this.iou = ringIoU(mask, this.cx, this.cy, this.r);
    this.peak = Math.max(this.peak, this.iou);
    if (this.iou >= this.iouMin) {
      if (this.holdStart === null) { this.holdStart = t; this.holdIoU = []; }
      this.holdIoU.push(this.iou);
      this.holdProgress = Math.min(1, (t - this.holdStart) / this.holdS);
      if (t - this.holdStart >= this.holdS) {
        this.state = 'success';
        this.forming = this.holdStart - this.t0;
        return this.state;
      }
    } else {
      this.holdStart = null;
      this.holdProgress = 0;
    }
    if (t - this.t0 >= this.timeoutS) this.state = 'timeout';
    return this.state;
  }

  result() {
    return { success: this.state === 'success', forming: this.forming, peakIoU: this.peak, holdIoUSd: sd(this.holdIoU) };
  }
}

// ------------------------------------------------------------------ latency probe
/**
 * Drives the "dark square" latency probe. The page paints a dark square when `step` says `dark`;
 * `readings` (from the vision loop) say when the camera + detector noticed. Only readings taken
 * AFTER the paint count (readings.t > the paint time), so a stale frame can never score.
 *   readings = { t, rawDark, stableDark, rawLit, stableClear }   (all booleans except t, seconds)
 * Per trial it records the delay until the raw (unfiltered) and stable (debounced, what the game
 * uses) detector flipped, for both the dark onset and the release.
 */
export class LatencyProbe {
  constructor({ trials = 20, timeoutS = 2, gapS = [0.8, 1.6], rng = Math.random } = {}) {
    Object.assign(this, { trials, timeoutS, gapS, rng });
    this.results = [];
    this.phase = 'gap';
    this.dark = false;
    this.tNext = null;
    this.done = false;
    this.rec = null;
  }

  get index() { return this.results.length + (this.phase === 'gap' ? 0 : 1); }

  gap() { return this.gapS[0] + this.rng() * (this.gapS[1] - this.gapS[0]); }

  step(now, rd) {
    if (this.done) return { dark: false, done: true };
    if (this.tNext === null) this.tNext = now + this.gap();
    const fresh = (t0) => rd && rd.t > t0;
    if (this.phase === 'gap') {
      this.dark = false;
      if (now >= this.tNext) { this.phase = 'dark'; this.dark = true; this.t0 = now; this.rec = { raw: null, stable: null, rawRel: null, stableRel: null }; }
    } else if (this.phase === 'dark') {
      this.dark = true;
      if (fresh(this.t0)) {
        if (this.rec.raw === null && rd.rawDark) this.rec.raw = (rd.t - this.t0) * 1000;
        if (this.rec.stable === null && rd.stableDark) this.rec.stable = (rd.t - this.t0) * 1000;
      }
      if (this.rec.stable !== null || now - this.t0 > this.timeoutS) { this.phase = 'release'; this.dark = false; this.t1 = now; }
    } else if (this.phase === 'release') {
      this.dark = false;
      if (fresh(this.t1)) {
        if (this.rec.rawRel === null && rd.rawLit) this.rec.rawRel = (rd.t - this.t1) * 1000;
        if (this.rec.stableRel === null && rd.stableClear) this.rec.stableRel = (rd.t - this.t1) * 1000;
      }
      if (this.rec.stableRel !== null || now - this.t1 > this.timeoutS) {
        this.results.push({ ...this.rec, missed: this.rec.stable === null, missedRelease: this.rec.stableRel === null });
        if (this.results.length >= this.trials) { this.done = true; this.dark = false; return { dark: false, done: true }; }
        this.phase = 'gap';
        this.tNext = now + this.gap();
      }
    }
    return { dark: this.dark, done: false };
  }

  summary() {
    const col = (k) => this.results.map((r) => r[k]);
    return {
      trials: this.results.length,
      missed: this.results.filter((r) => r.missed).length,
      missedRelease: this.results.filter((r) => r.missedRelease).length,
      rawOnset: summarize(col('raw')),
      stableOnset: summarize(col('stable')),
      rawRelease: summarize(col('rawRel')),
      stableRelease: summarize(col('stableRel')),
    };
  }
}

// ------------------------------------------------------------------ connectivity
/**
 * reports: { [phoneId]: [{ t (ms, host clock), median (ms), max (ms) }, ...] }, one entry per second per phone.
 * A 5 s window is "stalled" for a phone when it has no report at all or any report has max RTT above the threshold.
 */
export function analyzeConnectivity(reports, startMs, endMs, { windowS = THRESHOLDS.stallWindowS, stallMs = THRESHOLDS.stallRttMs } = {}) {
  const windows = Math.max(1, Math.floor((endMs - startMs) / (windowS * 1000)));
  const perPhone = [];
  let stalled = 0, total = 0;
  for (const [id, list] of Object.entries(reports)) {
    const inside = list.filter((r) => r.t >= startMs && r.t < endMs);
    let phoneStalled = 0;
    for (let w = 0; w < windows; w++) {
      const a = startMs + w * windowS * 1000, b = a + windowS * 1000;
      const rs = inside.filter((r) => r.t >= a && r.t < b);
      if (!rs.length || rs.some((r) => r.max > stallMs)) phoneStalled++;
    }
    stalled += phoneStalled;
    total += windows;
    perPhone.push({ id, reports: inside.length, windows, stalledWindows: phoneStalled, medianRtt: median(inside.map((r) => r.median)), p95Max: percentile(inside.map((r) => r.max), 95), worst: inside.length ? Math.max(...inside.map((r) => r.max)) : null });
  }
  return { phones: perPhone.length, windows, stalledFrac: total ? stalled / total : null, perPhone };
}

// ------------------------------------------------------------------ verdicts and report
const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));

/**
 * Turn raw results into rows { id, title, gate, status: pass|warn|fail|info|skipped, summary, consequence }.
 * `gate` rows decide the overall GO / CAUTION / NO-GO.
 */
export function evaluate(results, T = THRESHOLDS) {
  const rows = [];
  const add = (r) => rows.push({ gate: false, consequence: '', ...r });

  const c = results.calibration;
  if (!c) add({ id: 'calibration', title: 'Calibration', gate: true, status: 'skipped', summary: 'Not run.' });
  else if (!c.ok && !c.manual) add({ id: 'calibration', title: 'Calibration', gate: true, status: 'fail', summary: `Auto-calibration failed (${c.error || 'unknown'}); contrast ${fmt(c.contrast, 2)}.`, consequence: 'Fix aiming and contrast first (dim the room, fit the whole picture in view). Manual corners still allow play.' });
  else {
    const vf = c.validFrac ?? 0;
    const status = vf < T.validFracWarn ? 'fail' : vf < T.validFracPass || (c.contrast ?? 1) < T.contrastWarn ? 'warn' : 'pass';
    add({ id: 'calibration', title: 'Calibration', gate: true, status, summary: `${c.manual ? 'Manual corners. ' : ''}${fmt(vf * 100)}% of the board is measurable (want ${T.validFracPass * 100}%+); contrast ${fmt(c.contrast, 2)} (want ${T.contrastWarn}+); camera ${c.cw}x${c.ch}.`, consequence: status === 'pass' ? '' : 'Part of the picture is too dim or out of view for the camera: dim the room, raise projector brightness, aim straighter.' });
  }

  const l = results.latency;
  if (!l) add({ id: 'latency', title: 'Latency (display to camera to mask)', gate: true, status: 'skipped', summary: 'Not run.' });
  else {
    const s = l.summary;
    const med = s.stableOnset.median, p95 = s.stableOnset.p95;
    let status = 'pass';
    if (s.trials === 0 || s.missed / s.trials > 0.1) status = 'fail';
    else if (med > T.latencyMedianWarnMs) status = 'fail';
    else if (med > T.latencyMedianPassMs || p95 > T.latencyP95PassMs) status = 'warn';
    add({ id: 'latency', title: 'Latency (display to camera to mask)', gate: true, status,
      summary: `Median ${fmt(med)} ms, p95 ${fmt(p95)} ms (want <= ${T.latencyMedianPassMs} / ${T.latencyP95PassMs}); raw detector median ${fmt(s.rawOnset.median)} ms; release median ${fmt(s.stableRelease.median)} ms; missed ${s.missed}/${s.trials}.`,
      consequence: status === 'pass' ? '' : status === 'warn' ? 'Roll lanterns slower (about 0.7x) and add more checkpoints.' : 'Too slow or shadows missed: try a wired connection, a faster camera mode, locked exposure; otherwise fall back to a single lane against the Ghost.' });
  }

  for (const q of results.quiet || []) {
    const worst = Math.max(...q.perMinHalf);
    const status = worst <= T.phantomPerMinPerHalf ? 'pass' : 'fail';
    add({ id: `quiet:${q.label}`, title: `Phantom shadows: ${q.label}`, gate: true, status,
      summary: `${q.events.length} phantom blob${q.events.length === 1 ? '' : 's'} in ${fmt(q.durationS)} s (left ${fmt(q.perMinHalf[0], 1)}/min, right ${fmt(q.perMinHalf[1], 1)}/min; want <= ${T.phantomPerMinPerHalf}); peak ${fmt(q.peakCoverage * 100, 1)}% of the board.`,
      consequence: status === 'pass' ? '' : 'Add a keep-out line to onboarding and a 5 s recalibrate; if it persists, vision cannot be trusted in this setup.' });
  }
  if (!(results.quiet || []).length) add({ id: 'quiet', title: 'Phantom shadows', gate: true, status: 'skipped', summary: 'Not run.' });

  for (const r of results.ring || []) {
    const n = r.trials.length;
    const ok = r.trials.filter((t) => t.success).length;
    const frac = n ? ok / n : 0;
    const status = frac >= T.ringPassFrac ? 'pass' : frac >= T.ringWarnFrac ? 'warn' : 'fail';
    add({ id: `ring:${r.label}`, title: `Shadow fit: ${r.label}`, gate: true, status,
      summary: `Fitted ${ok} of ${n} within ${T.ringTimeoutS} s (want ${fmt(T.ringPassFrac * 100)}%+); forming time median ${fmt(r.summary.median, 1)} s; best overlap ${fmt(Math.max(0, ...r.trials.map((t) => t.peakIoU)) * 100)}%.`,
      consequence: status === 'pass' ? '' : 'Shadows are not precise enough at this target size: use bigger targets, a closer camera or a brighter, darker-room setup.' });
    if (r.summary.n >= 5) {
      const s = r.summary.sd;
      add({ id: `noise:${r.label}`, title: `Measurement noise: ${r.label}`, status: s <= T.noiseSdPassS ? 'pass' : 'warn',
        summary: `Forming time sd ${fmt(s, 2)} s over ${r.summary.n} repeats (want <= ${T.noiseSdPassS} s).`,
        consequence: s <= T.noiseSdPassS ? '' : 'Too noisy to show before/after skill gains: keep the Light Check as a rating only.' });
    } else {
      add({ id: `noise:${r.label}`, title: `Measurement noise: ${r.label}`, status: 'info', summary: `Only ${r.summary.n} successful repeats, too few for a noise estimate.` });
    }
  }
  if (!(results.ring || []).length) add({ id: 'ring', title: 'Shadow fit', gate: true, status: 'skipped', summary: 'Not run.' });

  const b = results.beam;
  if (b) {
    const over = b.peakHalf.map((x) => x > T.areaCap);
    add({ id: 'beam', title: 'Bodies in the beam (area per lane)', status: 'info',
      summary: `Peak coverage left ${fmt(b.peakHalf[0] * 100)}%, right ${fmt(b.peakHalf[1] * 100)}% (design cap ${T.areaCap * 100}% per lane${over.some(Boolean) ? '; the cap would have triggered' : ''}); most separate shadows at once: ${b.maxBlobs}.` });
  }

  const rc = results.recal;
  if (rc) {
    const status = !rc.ok ? 'fail' : rc.ms <= T.recalPassMs ? 'pass' : rc.ms <= T.recalWarnMs ? 'warn' : 'fail';
    add({ id: 'recal', title: 'Recalibration after a bump', status,
      summary: `${rc.ok ? 'Recovered' : 'Failed'} in ${fmt(rc.ms / 1000, 1)} s (want <= ${T.recalPassMs / 1000} s); picture moved ${fmt(rc.shiftPx, 1)} camera px.`,
      consequence: status === 'pass' ? '' : 'Players will wait too long after bumping the projector: shorten the black/white settle times.' });
  }

  const k = results.connectivity;
  if (k) {
    if (!k.phones) add({ id: 'connectivity', title: 'Connectivity', status: 'skipped', summary: 'No phones joined the probe.' });
    else {
      const status = k.stalledFrac <= T.stallMaxFrac ? 'pass' : 'fail';
      add({ id: 'connectivity', title: 'Connectivity (phones to relay)', status,
        summary: `${k.phones} phone${k.phones === 1 ? '' : 's'}: ${fmt(k.stalledFrac * 100)}% of ${T.stallWindowS} s windows stalled (> ${T.stallRttMs} ms; want <= ${T.stallMaxFrac * 100}%); median RTT ${fmt(median(k.perPhone.map((p) => p.medianRtt)))} ms; worst ${fmt(Math.max(...k.perPhone.map((p) => p.worst ?? 0)))} ms.`,
        consequence: status === 'pass' ? '' : 'Mobile data at this spot stalls too often: an offline / local-network mode becomes a must-build.' });
    }
  }
  for (const e of results.errors || []) rows.push({ id: 'error', title: 'Internal error', gate: true, status: 'fail', summary: String(e), consequence: 'The test page hit an error: send this report so it can be fixed.' });
  return rows;
}

export function overall(rows) {
  const gates = rows.filter((r) => r.gate);
  if (!gates.length || gates.some((r) => r.status === 'skipped')) return 'INCOMPLETE';
  if (gates.some((r) => r.status === 'fail')) return 'NO-GO';
  if (gates.some((r) => r.status === 'warn')) return 'CAUTION';
  return 'GO';
}

const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skipped: 'SKIP' };

export function formatReport({ meta, results, rows }) {
  const out = [];
  out.push('UMBRA P0 REAL-PROJECTOR REPORT');
  out.push(`Overall: ${overall(rows)}`);
  out.push(`When: ${meta.when}    Mode: ${meta.sim ? 'SIMULATOR (not real hardware)' : 'real camera'}`);
  out.push('');
  for (const r of rows) {
    out.push(`[${ICON[r.status]}] ${r.title}${r.gate ? ' *' : ''}`);
    out.push(`      ${r.summary}`);
    if (r.consequence) out.push(`      -> ${r.consequence}`);
  }
  out.push('');
  out.push('(* = gate: any FAIL means NO-GO. Thresholds are the design document\'s assumptions.)');
  out.push('');
  out.push('SETUP');
  for (const [k, v] of Object.entries(meta.setup || {})) out.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return out.join('\n');
}
