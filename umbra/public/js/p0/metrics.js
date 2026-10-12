// Real-projector gate (P0): the measurement logic, kept free of DOM so it can be unit-tested.
// Thresholds come from docs/GAME_DESIGN.md section 15 ("Kill criteria"). They are the design's
// ASSUMPTIONS, not laws of nature: the report always prints the number next to the threshold.
import { GW, GH, CELL } from '../game/world.js';

export const THRESHOLDS = {
  ringPassFrac: 0.8,          // adult fits the ring in 8 of 10 tries (design: anything less triggers the single-lane fallback)
  ringSmallWarnFrac: 0.6,     // the child-size ring is informative, not a gate
  ringIoU: 0.6,               // "fit" = overlap of shadow and target of at least this, held ringHoldS
  ringHoldS: 1,
  ringTimeoutS: 10,
  noiseSdPassS: 1.0,          // sd of forming time over repeats of the same target
  latencyMedianPassMs: 300,
  latencyP95PassMs: 450,
  latencyMedianWarnMs: 500,
  latencyMissFailFrac: 0.05,  // squares the camera never noticed: more than this fails
  releaseMissFailFrac: 0.1,   // shadows that never cleared after the square went white
  phantomPerMinPerHalf: 1,    // phantom blobs per lane (half-wall) per minute
  phantomDuty: 0.05,          // share of the time a phantom may be present in a lane
  phantomLongestS: 5,         // longest a single phantom may stay
  areaCap: 0.25,              // design cap for shadow area per lane
  ignoredWarnFrac: 0.05,      // share of a lane hidden under the page's own controls before we warn
  blindMaxFrac: 0.1,          // share of a test target that may be unmeasurable (out of view, too dim, under controls) before the run is void
  minSampleFrac: 0.8,         // a timed step needs this share of its expected camera samples
  recalPassMs: 6000,
  recalWarnMs: 10000,
  stallRttMs: 500,
  stallWindowS: 5,
  stallMaxFrac: 0.25,
  connPhonesDesign: 8,        // the design condition: up to 8 phones on a camp network
  connPhonesMin: 4,           // fewer phones than this can only give a provisional pass
  validFracPass: 0.9,
  validFracWarn: 0.7,
  contrastWarn: 0.15,
  edgeMarginPx: 3,
};

/** Result labels shared by the page and the verdict rules. */
export const LABELS = { quietClean: 'clean room', quietLantern: 'lantern nearby', ring: 'ring (r=70)', ringSmall: 'small ring (r=42)' };

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
 * Phantom shadows, tracked separately for the left (0) and right (1) half of the wall, i.e. per lane.
 * Three things are measured, because a ghost can fail in three ways:
 *  - events: a blob that APPEARS after the lane has been quiet for `quietTicks` (flicker counts again each time);
 *  - duty: the share of ticks a blob is present (a permanent ghost has duty ~1);
 *  - longest: the longest unbroken stretch, in seconds.
 * A blob in one lane never hides one in the other, and simultaneous blobs are each attributed to their own lane.
 */
export class BlobEvents {
  constructor({ gw = GW, quietTicks = 2 } = {}) {
    this.gw = gw;
    this.quietTicks = quietTicks;
    this.events = [];
    this.ticks = 0;
    this.peakCells = 0;
    this.lane = [0, 1].map(() => ({ active: false, quiet: quietTicks, present: 0, runStart: null, longest: 0 }));
    this.lastT = null;
    this.span = 0;
  }

  update(blobs, t) {
    this.ticks++;
    if (this.lastT !== null) this.span = Math.max(this.span, t - this.lastT);
    this.lastT = t;
    for (let h = 0; h < 2; h++) {
      const L = this.lane[h];
      const mine = blobs.filter((b) => (b.cx < this.gw / 2 ? 0 : 1) === h);
      if (mine.length) {
        if (!L.active && L.quiet >= this.quietTicks) {
          const big = mine.reduce((a, b) => (b.cells > a.cells ? b : a));
          this.events.push({ t, half: h, cells: big.cells });
        }
        if (L.runStart === null) L.runStart = t;
        L.longest = Math.max(L.longest, t - L.runStart);
        L.active = true;
        L.quiet = 0;
        L.present++;
        for (const b of mine) this.peakCells = Math.max(this.peakCells, b.cells);
      } else {
        L.active = false;
        L.quiet++;
        L.runStart = null;
      }
    }
  }

  perMinute(durationS) {
    const k = 60 / Math.max(1, durationS);
    return [0, 1].map((h) => this.events.filter((e) => e.half === h).length * k);
  }
  duty() { return this.lane.map((L) => (this.ticks ? L.present / this.ticks : 0)); }
  longest() { return this.lane.map((L) => L.longest); }
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
 * `readings` (from the vision loop) say when the camera + detector noticed. Rules that keep it honest:
 *  - only readings taken AFTER the paint count (readings.t > the paint time), so a stale frame never scores;
 *  - the square must be seen CLEAR (lit, no shadow) for `clearTicks` fresh readings before every flash, so a hand or a
 *    stuck shadow in the square can never produce an absurdly fast "detection"; if it stays unclear for
 *    `clearTimeoutS` the trial is discarded and counted as contaminated, and after `maxContaminated` the probe stops;
 *  - a missed detection stays in the statistics as a value equal to the timeout (see summary().stableOnsetCensored).
 *   readings = { t, rawDark, stableDark, rawLit, stableClear }   (booleans except t, seconds)
 */
export class LatencyProbe {
  constructor({ trials = 20, timeoutS = 2, gapS = [0.8, 1.6], clearTicks = 3, clearTimeoutS = 3, maxContaminated = 6, rng = Math.random } = {}) {
    Object.assign(this, { trials, timeoutS, gapS, clearTicks, clearTimeoutS, maxContaminated, rng });
    this.results = [];
    this.phase = 'gap';
    this.dark = false;
    this.tNext = null;
    this.done = false;
    this.aborted = null;
    this.contaminated = 0;
    this.rec = null;
    this.clearCount = 0;
    this.lastSeen = -Infinity;
    this.waitSince = null;
  }

  get index() { return this.results.length + (this.phase === 'gap' ? 0 : 1); }

  gap() { return this.gapS[0] + this.rng() * (this.gapS[1] - this.gapS[0]); }

  step(now, rd) {
    if (this.done) return { dark: false, done: true };
    if (this.tNext === null) { this.tNext = now + this.gap(); this.waitSince = null; }
    const fresh = (t0) => rd && rd.t > t0;
    if (this.phase === 'gap') {
      this.dark = false;
      if (now >= this.tNext) {
        if (this.waitSince === null) { this.waitSince = now; this.clearCount = 0; this.lastSeen = now; }
        if (rd && rd.t > this.lastSeen) {              // a new vision reading since we started waiting
          this.lastSeen = rd.t;
          this.clearCount = rd.stableClear && rd.rawLit ? this.clearCount + 1 : 0;
        }
        if (this.clearCount >= this.clearTicks) {
          this.phase = 'dark'; this.dark = true; this.t0 = now; this.waitSince = null;
          this.rec = { raw: null, stable: null, rawRel: null, stableRel: null };
        } else if (now - this.waitSince > this.clearTimeoutS) {
          this.contaminated++;
          this.waitSince = null;
          this.tNext = now + this.gap();
          if (this.contaminated >= this.maxContaminated) { this.done = true; this.aborted = 'square-not-clear'; return { dark: false, done: true }; }
        }
      }
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
        this.waitSince = null;
      }
    }
    return { dark: this.dark, done: false };
  }

  summary() {
    const col = (k) => this.results.map((r) => r[k]);
    const timeoutMs = this.timeoutS * 1000;
    return {
      trials: this.results.length,
      missed: this.results.filter((r) => r.missed).length,
      missedRelease: this.results.filter((r) => r.missedRelease).length,
      contaminated: this.contaminated,
      aborted: this.aborted,
      timeoutMs,
      rawOnset: summarize(col('raw')),
      stableOnset: summarize(col('stable')),
      stableOnsetCensored: summarize(this.results.map((r) => (r.stable === null ? timeoutMs : r.stable))),
      rawRelease: summarize(col('rawRel')),
      stableRelease: summarize(col('stableRel')),
    };
  }
}

// ------------------------------------------------------------------ connectivity
/**
 * reports: { [phoneId]: [{ t (ms, host clock), median (ms), max (ms), hidden? }, ...] }, one entry per second per phone.
 * Only `participants` (phones that were connected and reporting when the probe started) are scored, so ghosts from earlier
 * runs and late joiners never count as stalls. Phones in `left` disconnected during the probe: reported, not scored.
 * A 5 s window is "stalled" for a phone when it has no report at all or any report has max RTT above the threshold;
 * windows in which the phone said its page was hidden are counted as "slept", not as network stalls.
 */
export function analyzeConnectivity(reports, startMs, endMs, { windowS = THRESHOLDS.stallWindowS, stallMs = THRESHOLDS.stallRttMs, participants = Object.keys(reports), left = [] } = {}) {
  const windows = Math.max(1, Math.floor((endMs - startMs) / (windowS * 1000)));
  const gone = new Set(left.map(String));
  const perPhone = [];
  let stalled = 0, total = 0;
  for (const id of participants.map(String)) {
    const inside = (reports[id] || []).filter((r) => r.t >= startMs && r.t < endMs);
    if (gone.has(id)) { perPhone.push({ id, dropped: true, reports: inside.length, windows: 0, stalledWindows: 0, sleptWindows: 0, medianRtt: median(inside.map((r) => r.median)), p95Max: percentile(inside.map((r) => r.max), 95), worst: inside.length ? Math.max(...inside.map((r) => r.max)) : null }); continue; }
    let phoneStalled = 0, slept = 0, scored = 0;
    for (let w = 0; w < windows; w++) {
      const a = startMs + w * windowS * 1000, b = a + windowS * 1000;
      const rs = inside.filter((r) => r.t >= a && r.t < b);
      if (rs.some((r) => r.hidden)) { slept++; continue; }
      scored++;
      if (!rs.length || rs.some((r) => r.max > stallMs)) phoneStalled++;
    }
    stalled += phoneStalled;
    total += scored;
    perPhone.push({ id, dropped: false, reports: inside.length, windows: scored, stalledWindows: phoneStalled, sleptWindows: slept, medianRtt: median(inside.map((r) => r.median)), p95Max: percentile(inside.map((r) => r.max), 95), worst: inside.length ? Math.max(...inside.map((r) => r.max)) : null });
  }
  return {
    phones: perPhone.filter((p) => !p.dropped).length,
    dropped: perPhone.filter((p) => p.dropped).length,
    windows,
    stalledFrac: total ? stalled / total : null,
    perPhone,
  };
}

// ------------------------------------------------------------------ verdicts and report
const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const pct = (x, d = 0) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);

/**
 * Turn raw results into rows { id, title, gate, status: pass|warn|fail|info|skipped|invalid, summary, consequence }.
 * `gate` rows decide the overall verdict. Every required gate always gets a row: a test that was not run (or was
 * invalid) shows as "skipped", never silently as nothing.
 */
export function evaluate(results, T = THRESHOLDS) {
  const rows = [];
  const add = (r) => rows.push({ gate: false, consequence: '', ...r });
  const skip = (id, title, gate, why = 'Not run.') => add({ id, title, gate, status: 'skipped', summary: why });

  // ---- calibration
  const c = results.calibration;
  if (!c) skip('calibration', 'Calibration', true);
  else if (!c.ok && !c.manual) add({ id: 'calibration', title: 'Calibration', gate: true, status: 'fail', summary: `Auto-calibration failed (${c.error || 'unknown'}); contrast ${fmt(c.contrast, 2)}.`, consequence: 'Fix aiming and contrast first (dim the room, fit the whole picture in view). Hand-placed corners can still work.' });
  else {
    const vf = c.validFrac ?? 0;
    let status = vf < T.validFracWarn ? 'fail' : vf < T.validFracPass || (c.contrast ?? 1) < T.contrastWarn ? 'warn' : 'pass';
    const notes = [];
    if (!c.ok) { notes.push(`auto-calibration failed (${c.error || 'unknown'}), corners placed by hand`); if (status === 'pass') status = 'warn'; }
    else if (c.manual) notes.push('corners adjusted by hand');
    if (c.edgeMarginPx !== undefined && c.edgeMarginPx !== null && c.edgeMarginPx < T.edgeMarginPx && (c.manual || !c.ok)) { notes.push('a corner sits on the edge of the camera view, so part of the picture may be cut off'); if (status === 'pass') status = 'warn'; }
    add({ id: 'calibration', title: 'Calibration', gate: true, status,
      summary: `${notes.length ? `${notes.join('; ')}. ` : ''}${pct(vf)} of the board is measurable (want ${T.validFracPass * 100}%+); contrast ${fmt(c.contrast, 2)} (want ${T.contrastWarn}+); camera ${c.cw}x${c.ch}.`,
      consequence: status === 'pass' ? '' : 'Part of the picture is too dim, out of view or only roughly located: dim the room, raise projector brightness, move the camera back so every edge is visible.' });
  }

  // ---- latency
  const l = results.latency;
  if (!l) skip('latency', 'Latency (display to camera to mask)', true);
  else {
    const s = l.summary;
    if (l.blindFrac > T.blindMaxFrac) add({ id: 'latency', title: 'Latency (display to camera to mask)', gate: true, status: 'skipped', summary: `Invalid run: ${pct(l.blindFrac)} of the test square cannot be measured (outside the camera's view, too dim, or under the page's own controls). Re-aim, recalibrate and repeat.` });
    else if (s.aborted || s.trials < 3) add({ id: 'latency', title: 'Latency (display to camera to mask)', gate: true, status: 'skipped', summary: `Invalid run: ${s.aborted ? 'the test square was never clear (a hand, shadow or stuck mask was in it)' : `only ${s.trials} usable trials`}. Repeat with the beam clear.` });
    else {
      const cen = s.stableOnsetCensored;
      const med = cen.median, p95 = cen.p95;
      const missFrac = s.missed / s.trials, relFrac = s.missedRelease / s.trials;
      let status = 'pass';
      if (missFrac > T.latencyMissFailFrac || med > T.latencyMedianWarnMs || relFrac > T.releaseMissFailFrac) status = 'fail';
      else if (s.missed > 0 || med > T.latencyMedianPassMs || p95 > T.latencyP95PassMs || s.missedRelease > 0 || s.contaminated > 0) status = 'warn';
      add({ id: 'latency', title: 'Latency (display to camera to mask)', gate: true, status,
        summary: `Median ${fmt(med)} ms, p95 ${fmt(p95)} ms (want <= ${T.latencyMedianPassMs} / ${T.latencyP95PassMs}; squares that were never noticed count as ${fmt(s.timeoutMs)} ms); raw detector median ${fmt(s.rawOnset.median)} ms; release median ${fmt(s.stableRelease.median)} ms; never noticed ${s.missed}/${s.trials}; shadow never cleared ${s.missedRelease}/${s.trials}${s.contaminated ? `; trials discarded because the square was not clear: ${s.contaminated}` : ''}.`,
        consequence: status === 'pass' ? '' : status === 'warn' ? 'Roll lanterns slower (about 0.7x), add more checkpoints, and check why some squares were missed or stuck.' : 'Too slow, or shadows missed or stuck: try a wired connection, a faster camera mode, locked exposure; otherwise fall back to a single lane against the Ghost.' });
    }
  }

  // ---- phantom shadows (two required runs)
  for (const [key, label, title] of [['quietClean', LABELS.quietClean, 'Phantom shadows: clean room'], ['quietLantern', LABELS.quietLantern, 'Phantom shadows: lantern and people nearby']]) {
    const q = (results.quiet || []).find((x) => x.label === label);
    const id = `quiet:${label}`;
    if (!q) { skip(id, title, true); continue; }
    if (q.expectedTicks && q.ticks < q.expectedTicks * T.minSampleFrac) { add({ id, title, gate: true, status: 'skipped', summary: `Invalid run: only ${q.ticks} of about ${q.expectedTicks} camera samples were processed (page hidden, throttled or camera stalled). Repeat.` }); continue; }
    const worst = Math.max(...q.perMinHalf), duty = Math.max(...(q.duty || [0, 0])), longest = Math.max(...(q.longest || [0, 0]));
    const bad = worst > T.phantomPerMinPerHalf || duty > T.phantomDuty || longest > T.phantomLongestS;
    const blind = q.ignoredFrac ? Math.max(...q.ignoredFrac) : 0;
    add({ id, title, gate: true, status: bad ? 'fail' : 'pass',
      summary: `${q.events.length} phantom appearance${q.events.length === 1 ? '' : 's'} in ${fmt(q.durationS)} s (left ${fmt(q.perMinHalf[0], 1)}/min, right ${fmt(q.perMinHalf[1], 1)}/min; want <= ${T.phantomPerMinPerHalf}); present ${pct(duty, 1)} of the time at most (want <= ${T.phantomDuty * 100}%); longest ${fmt(longest, 1)} s (want <= ${T.phantomLongestS}); peak ${pct(q.peakCoverage, 1)} of the board.${blind > T.ignoredWarnFrac ? ` WARNING: ${pct(blind)} of a lane was hidden under the page's own controls and not measured.` : ''}`,
      consequence: bad ? 'Add a keep-out line to onboarding and a 5 s recalibrate; a ghost that stays or keeps returning means vision cannot be trusted in this setup.' : '' });
  }

  // ---- shadow fit (adult ring is a gate; the child-size ring informs)
  for (const [key, label, title, gate] of [['ring', LABELS.ring, 'Shadow fit: ring (r=70)', true], ['ringSmall', LABELS.ringSmall, 'Shadow fit: small ring (r=42)', false]]) {
    const r = (results.ring || []).find((x) => x.label === label);
    const id = `ring:${label}`;
    if (!r) { skip(id, title, gate); continue; }
    if (r.blindFrac > T.blindMaxFrac) { add({ id, title, gate, status: 'skipped', summary: `Invalid run: ${pct(r.blindFrac)} of the ring cannot be measured (outside the camera's view, too dim, or under the page's own controls). Re-aim, recalibrate and repeat.` }); continue; }
    if (r.neverClear > 0) { add({ id, title, gate, status: 'skipped', summary: `Invalid run: the ring was still covered when ${r.neverClear} ${r.neverClear === 1 ? 'try was' : 'tries were'} due to start (a shadow stuck on it, or a hand left in it). Clear the ring and repeat.` }); continue; }
    const n = r.trials.length, ok = r.trials.filter((t) => t.success).length, frac = n ? ok / n : 0;
    const status = frac >= T.ringPassFrac ? 'pass' : gate ? 'fail' : frac >= T.ringSmallWarnFrac ? 'warn' : 'fail';
    add({ id, title, gate, status,
      summary: `Fitted ${ok} of ${n} within ${T.ringTimeoutS} s (want ${fmt(T.ringPassFrac * 100)}%+); forming time median ${fmt(r.summary.median, 1)} s; best overlap ${fmt(Math.max(0, ...r.trials.map((t) => t.peakIoU)) * 100)}%.`,
      consequence: status === 'pass' ? '' : gate ? 'Below the design bar: recalibrate and run it once more; if it stays below, the design fallback is a single lane against the Ghost, then human-judged Charades.' : 'Child-size shadows are not resolved reliably: use bigger targets or a closer camera.' });
    const timeouts = n - ok;
    if (r.summary.n >= 5) {
      const s = r.summary.sd;
      add({ id: `noise:${label}`, title: `Measurement noise: ${label}`, status: s <= T.noiseSdPassS ? 'pass' : 'warn',
        summary: `Forming time sd ${fmt(s, 2)} s over ${r.summary.n} successful repeats (want <= ${T.noiseSdPassS} s)${timeouts ? `; ${timeouts} timed out and are not in this figure, so the real spread is larger` : ''}.`,
        consequence: s <= T.noiseSdPassS ? '' : 'Too noisy to show before/after skill gains: keep the Light Check as a rating only.' });
    } else add({ id: `noise:${label}`, title: `Measurement noise: ${label}`, status: 'info', summary: `Only ${r.summary.n} successful repeats, too few for a noise estimate.` });
  }

  // ---- bodies in the beam (information)
  const b = results.beam;
  if (!b) skip('beam', 'Bodies in the beam (area per lane)', false);
  else {
    const over = b.peakHalf.map((x) => x > T.areaCap);
    const blind = b.ignoredFrac ? Math.max(...b.ignoredFrac) : 0;
    add({ id: 'beam', title: 'Bodies in the beam (area per lane)', status: blind > T.ignoredWarnFrac ? 'warn' : 'info',
      summary: `Peak coverage left ${pct(b.peakHalf[0])}, right ${pct(b.peakHalf[1])} (design cap ${T.areaCap * 100}% per lane${over.some(Boolean) ? '; the cap would have triggered' : ''}); most separate shadows at once: ${b.maxBlobs}.${blind > T.ignoredWarnFrac ? ` WARNING: ${pct(blind)} of a lane was hidden under the page's own controls, so these figures are too low.` : ''}` });
  }

  // ---- recalibration
  const rc = results.recal;
  if (!rc) skip('recal', 'Recalibration after a bump', false);
  else if (!rc.ok) add({ id: 'recal', title: 'Recalibration after a bump', status: 'fail', summary: `Recalibration FAILED (${rc.error || 'unknown'}) after ${fmt(rc.ms / 1000, 1)} s: the picture could not be found again.`, consequence: 'After a bump the picture left the camera view or lost contrast: players would have to re-aim by hand.' });
  else {
    const status = rc.ms <= T.recalPassMs ? 'pass' : rc.ms <= T.recalWarnMs ? 'warn' : 'fail';
    add({ id: 'recal', title: 'Recalibration after a bump', status,
      summary: `Recovered in ${fmt(rc.ms / 1000, 1)} s (want <= ${T.recalPassMs / 1000} s; this is the black/white flash and settle time only, the countdown and tapping accept add a few seconds in a real game); picture moved ${rc.shiftPx === null || rc.shiftPx === undefined ? 'n/a' : `${fmt(rc.shiftPx, 1)} camera px`}${rc.shiftPx !== null && rc.shiftPx !== undefined && rc.shiftPx < 1.5 ? ' (the projector was probably not actually bumped)' : ''}.`,
      consequence: status === 'pass' ? '' : 'Players would wait too long after bumping the projector: shorten the black/white settle times.' });
  }

  // ---- connectivity
  const k = results.connectivity;
  if (!k) skip('connectivity', 'Connectivity (phones to relay)', false);
  else if (!k.phones) skip('connectivity', 'Connectivity (phones to relay)', false, `No phones stayed connected for the probe${k.dropped ? ` (${k.dropped} dropped out)` : ''}.`);
  else {
    let status = k.stalledFrac <= T.stallMaxFrac ? 'pass' : 'fail';
    const notes = [];
    if (status === 'pass' && k.phones < T.connPhonesMin) { status = 'warn'; notes.push(`only ${k.phones} phone${k.phones === 1 ? '' : 's'} tested; the design condition is up to ${T.connPhonesDesign} on one network`); }
    if (k.lan) { if (status === 'pass') status = 'warn'; notes.push(`measured over a local network (${k.relayHost || 'LAN'}), which says nothing about mobile data at camp: repeat with phones on mobile data against an internet address`); }
    if (k.dropped) { if (status === 'pass') status = 'warn'; notes.push(`${k.dropped} phone${k.dropped === 1 ? '' : 's'} dropped out during the probe`); }
    const slept = k.perPhone.reduce((a, p) => a + (p.sleptWindows || 0), 0);
    if (slept) notes.push(`${slept} window${slept === 1 ? '' : 's'} excluded because the phone's screen was off`);
    add({ id: 'connectivity', title: 'Connectivity (phones to relay)', status,
      summary: `${k.phones} phone${k.phones === 1 ? '' : 's'} via ${k.relayHost || 'the relay'}: ${pct(k.stalledFrac)} of ${T.stallWindowS} s windows stalled (> ${T.stallRttMs} ms; want <= ${T.stallMaxFrac * 100}%); median RTT ${fmt(median(k.perPhone.filter((p) => !p.dropped).map((p) => p.medianRtt)))} ms; worst ${fmt(Math.max(0, ...k.perPhone.map((p) => p.worst ?? 0)))} ms.${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
      consequence: status === 'fail' ? 'Mobile data at this spot stalls too often: an offline / local-network mode becomes a must-build.' : '' });
  }

  // ---- the page itself broke: a separate "invalid" verdict, never confused with a hardware result
  const errs = [...new Set(results.errors || [])].slice(0, 5);
  for (const e of errs) rows.push({ id: 'error', title: 'Page error', gate: true, status: 'invalid', summary: String(e), consequence: 'The test page hit an error, so this run is not a valid measurement. Send this report so it can be fixed.' });
  return rows;
}

/** GO / CAUTION / NO-GO / INCOMPLETE / INVALID RUN. A failed gate is decisive even when others are not run yet. */
export function overall(rows) {
  if (rows.some((r) => r.id === 'error')) return 'INVALID RUN';
  const gates = rows.filter((r) => r.gate);
  if (gates.some((r) => r.status === 'fail')) return 'NO-GO';
  if (!gates.length || gates.some((r) => r.status === 'skipped')) return 'INCOMPLETE';
  if (gates.some((r) => r.status === 'warn')) return 'CAUTION';
  return 'GO';
}

/** Titles of rows that were not run (or were invalid). */
export const notRun = (rows) => rows.filter((r) => r.status === 'skipped').map((r) => r.title);
/** Non-gate rows that failed or warned: they do not change the headline but change the plan. */
export const attention = (rows) => rows.filter((r) => !r.gate && (r.status === 'fail' || r.status === 'warn')).map((r) => `${r.title}: ${r.status.toUpperCase()}${r.consequence ? ` (${r.consequence})` : ''}`);

const ICON = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO', skipped: 'SKIP', invalid: 'ERR ' };

export function formatReport({ meta, results, rows }) {
  const out = [];
  out.push('UMBRA P0 REAL-PROJECTOR REPORT');
  out.push(`Overall: ${overall(rows)}`);
  const nr = notRun(rows);
  if (nr.length) out.push(`Not run or invalid: ${nr.join('; ')}`);
  const at = attention(rows);
  if (at.length) out.push(`Needs attention: ${at.join(' | ')}`);
  if (meta.flags && meta.flags.length) out.push(`NOT A VALID MEASUREMENT: ${meta.flags.join('; ')}`);
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
