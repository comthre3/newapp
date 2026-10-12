import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GW, GH, fillDisc, fillRect } from '../public/js/game/world.js';
import {
  THRESHOLDS, percentile, median, mean, sd, summarize, findBlobs, BlobEvents, ringIoU, discCover, RingTrial,
  LatencyProbe, analyzeConnectivity, evaluate, overall, formatReport,
} from '../public/js/p0/metrics.js';

const grid = () => new Uint8Array(GW * GH);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('statistics: percentile, median, sd, and tolerance of junk values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(near(percentile([0, 10], 50), 5));
  assert.ok(near(percentile([1, 2, 3, 4, 5], 95), 4.8));
  assert.ok(near(sd([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7)));
  assert.equal(sd([5]), null);
  assert.equal(median([]), null);
  assert.equal(mean([1, NaN, null, 3]), 2);     // non-numbers are ignored, not poisoning the result
  const s = summarize([100, 200, NaN, 300]);
  assert.deepEqual([s.n, s.min, s.max, s.median], [3, 100, 300, 200]);
});

test('findBlobs separates components, drops specks, reports centroids', () => {
  const m = grid();
  fillRect(m, 60, 60, 60, 60);          // 10x10 cells at (10..19, 10..19)
  fillRect(m, 600, 300, 60, 60);        // another 10x10 on the right
  m[5 * GW + 100] = 1;                  // lone speck
  const blobs = findBlobs(m, GW, GH, 6);
  assert.equal(blobs.length, 2);
  const [a, b] = blobs.sort((p, q) => p.cx - q.cx);
  assert.equal(a.cells, 100);
  assert.ok(Math.abs(a.cx - 14.5) < 0.6 && Math.abs(b.cx - 104.5) < 0.6);
  assert.equal(findBlobs(m, GW, GH, 200).length, 0);
});

test('BlobEvents counts a phantom once per appearance, per half, and ignores flicker inside an event', () => {
  const ev = new BlobEvents({ quietTicks: 3 });
  const left = [{ cells: 20, cx: 30, cy: 40 }], right = [{ cells: 20, cx: 120, cy: 40 }];
  let t = 0;
  const tick = (b) => ev.update(b, t++ * 0.05);
  for (let i = 0; i < 5; i++) tick([]);
  for (let i = 0; i < 4; i++) tick(left);        // event 1 (left)
  tick([]); tick(left);                          // brief dropout: same event
  for (let i = 0; i < 5; i++) tick([]);
  for (let i = 0; i < 3; i++) tick(right);       // event 2 (right)
  assert.equal(ev.events.length, 2);
  assert.deepEqual(ev.events.map((e) => e.half), [0, 1]);
  assert.deepEqual(ev.perMinute(30), [2, 2]);    // 1 event in 30 s per half = 2/min
});

test('ringIoU: perfect fit, miss, overshoot and undershoot', () => {
  const cx = 480, cy = 270, r = 60;
  const perfect = grid(); fillDisc(perfect, cx, cy, r);
  assert.ok(ringIoU(perfect, cx, cy, r) > 0.9);
  assert.equal(ringIoU(grid(), cx, cy, r), 0);
  const off = grid(); fillDisc(off, cx + 200, cy, r);
  assert.equal(ringIoU(off, cx, cy, r), 0);
  const big = grid(); fillDisc(big, cx, cy, r * 1.5);
  const small = grid(); fillDisc(small, cx, cy, r * 0.6);
  assert.ok(ringIoU(big, cx, cy, r) < 0.6 && ringIoU(big, cx, cy, r) > 0.3);
  assert.ok(ringIoU(small, cx, cy, r) < 0.6 && ringIoU(small, cx, cy, r) > 0.2);
  assert.ok(discCover(perfect, cx, cy, r) > 0.95 && discCover(grid(), cx, cy, r) === 0);
});

test('RingTrial: success needs the hold, resets when the fit is lost, times out otherwise', () => {
  const cx = 480, cy = 270, r = 60;
  const good = grid(); fillDisc(good, cx, cy, r);
  const t1 = new RingTrial({ cx, cy, r, holdS: 1, timeoutS: 10 });
  t1.start(0);
  assert.equal(t1.update(grid(), 0.5), 'running');
  assert.equal(t1.update(good, 2.0), 'running');          // fit begins at 2.0
  assert.equal(t1.update(grid(), 2.5), 'running');        // lost: hold resets
  assert.equal(t1.update(good, 3.0), 'running');          // new hold begins at 3.0
  assert.equal(t1.update(good, 3.9), 'running');
  assert.equal(t1.update(good, 4.05), 'success');
  assert.ok(near(t1.result().forming, 3.0), `forming ${t1.result().forming}`);

  const t2 = new RingTrial({ cx, cy, r, holdS: 1, timeoutS: 10 });
  t2.start(0);
  assert.equal(t2.update(grid(), 9.9), 'running');
  assert.equal(t2.update(grid(), 10.1), 'timeout');
  assert.equal(t2.result().success, false);
  assert.equal(t2.result().forming, null);
});

/** Run a LatencyProbe against a fake camera/detector pipeline with known delays and a 20 Hz poll. */
function runProbe({ rawDelay, stableDelay, releaseRaw = rawDelay, releaseStable = stableDelay, trials = 12, pollMs = 50, blind = false }) {
  const probe = new LatencyProbe({ trials, timeoutS: 2, gapS: [0.3, 0.6], rng: (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() });
  let paintedDarkAt = null, paintedLightAt = null, lastTick = -1;
  let rd = { t: -1, rawDark: false, stableDark: false, rawLit: true, stableClear: true };
  for (let ms = 0; ms < 120000 && !probe.done; ms++) {
    const now = ms / 1000;
    if (ms - lastTick >= pollMs) {                   // a vision tick: what does the wall look like to the camera?
      lastTick = ms;
      const darkFor = paintedDarkAt === null ? -1 : ms - paintedDarkAt;
      const lightFor = paintedLightAt === null ? -1 : ms - paintedLightAt;
      const showsDark = paintedDarkAt !== null && (paintedLightAt === null || paintedDarkAt > paintedLightAt);
      rd = {
        t: now,
        rawDark: !blind && showsDark && darkFor >= rawDelay,
        stableDark: !blind && showsDark && darkFor >= stableDelay,
        rawLit: !showsDark && (paintedLightAt === null || lightFor >= releaseRaw),
        stableClear: !showsDark && (paintedLightAt === null || lightFor >= releaseStable),
      };
    }
    const prevDark = probe.dark;
    const { dark } = probe.step(now, rd);
    if (dark && !prevDark) paintedDarkAt = ms;
    if (!dark && prevDark) paintedLightAt = ms;
  }
  return probe;
}

test('LatencyProbe measures a known pipeline delay (within one poll interval) and never scores stale frames', () => {
  const p = runProbe({ rawDelay: 120, stableDelay: 220, releaseStable: 260 });
  assert.equal(p.results.length, 12);
  const s = p.summary();
  assert.equal(s.missed, 0);
  assert.ok(s.stableOnset.median >= 220 && s.stableOnset.median <= 220 + 60, `stable ${s.stableOnset.median}`);
  assert.ok(s.rawOnset.median >= 120 && s.rawOnset.median <= 120 + 60, `raw ${s.rawOnset.median}`);
  assert.ok(s.stableOnset.median > s.rawOnset.median, 'the debounce must show up as extra delay');
  assert.ok(s.stableRelease.median >= 260 && s.stableRelease.median <= 320, `release ${s.stableRelease.median}`);
});

test('LatencyProbe records a miss when the camera never sees the dark square', () => {
  const p = runProbe({ rawDelay: 0, stableDelay: 0, trials: 4, blind: true });
  const s = p.summary();
  assert.equal(s.trials, 4);
  assert.equal(s.missed, 4);
  assert.equal(s.stableOnset.n, 0);
});

test('analyzeConnectivity: stalled windows from slow or missing reports', () => {
  const mk = (ids) => Object.fromEntries(ids.map((id) => [id, []]));
  const reports = mk(['a', 'b', 'c']);
  for (let s = 0; s < 60; s++) {
    const t = s * 1000;
    reports.a.push({ t, median: 80, max: 150 });                       // healthy
    reports.b.push({ t, median: 90, max: s >= 10 && s < 15 ? 900 : 200 });   // one stalled window (10-15 s)
    if (s < 30) reports.c.push({ t, median: 100, max: 200 });          // phone dropped halfway: windows 6..11 missing
  }
  const r = analyzeConnectivity(reports, 0, 60000);
  assert.equal(r.windows, 12);
  const by = Object.fromEntries(r.perPhone.map((p) => [p.id, p]));
  assert.equal(by.a.stalledWindows, 0);
  assert.equal(by.b.stalledWindows, 1);
  assert.equal(by.c.stalledWindows, 6);
  assert.ok(near(r.stalledFrac, 7 / 36));
});

const goodResults = () => ({
  calibration: { ok: true, contrast: 0.5, validFrac: 0.97, cw: 640, ch: 360 },
  latency: { summary: { trials: 20, missed: 0, rawOnset: { median: 120 }, stableOnset: { median: 200, p95: 300 }, stableRelease: { median: 220 } } },
  quiet: [{ label: 'clean room', durationS: 60, events: [], perMinHalf: [0, 0], peakCoverage: 0 }],
  ring: [{ label: 'ring', r: 70, trials: Array.from({ length: 10 }, () => ({ success: true, forming: 2, peakIoU: 0.8 })), summary: { n: 10, median: 2, sd: 0.4 } }],
});

test('evaluate: a healthy setup is GO; each failure mode flips the right gate', () => {
  assert.equal(overall(evaluate(goodResults())), 'GO');

  const slow = goodResults(); slow.latency.summary.stableOnset = { median: 420, p95: 600 };
  assert.equal(overall(evaluate(slow)), 'CAUTION');
  slow.latency.summary.stableOnset = { median: 700, p95: 900 };
  assert.equal(overall(evaluate(slow)), 'NO-GO');

  const missed = goodResults(); missed.latency.summary.missed = 5;
  assert.equal(overall(evaluate(missed)), 'NO-GO');

  const ghost = goodResults(); ghost.quiet[0].perMinHalf = [3, 0];
  assert.equal(overall(evaluate(ghost)), 'NO-GO');

  const ring = goodResults(); ring.ring[0].trials = ring.ring[0].trials.map((t, i) => ({ ...t, success: i < 7 }));
  assert.equal(overall(evaluate(ring)), 'CAUTION');
  ring.ring[0].trials = ring.ring[0].trials.map((t, i) => ({ ...t, success: i < 3 }));
  assert.equal(overall(evaluate(ring)), 'NO-GO');

  const noisy = goodResults(); noisy.ring[0].summary.sd = 1.6;
  const rows = evaluate(noisy);
  assert.equal(overall(rows), 'GO', 'noise is a feature gate, not a kill');
  assert.equal(rows.find((r) => r.id.startsWith('noise')).status, 'warn');

  const dim = goodResults(); dim.calibration.validFrac = 0.8;
  assert.equal(overall(evaluate(dim)), 'CAUTION');
  const failedCal = goodResults(); failedCal.calibration = { ok: false, error: 'cut-off', contrast: 0.4 };
  assert.equal(overall(evaluate(failedCal)), 'NO-GO');
  failedCal.calibration.manual = true; failedCal.calibration.validFrac = 0.95; failedCal.calibration.ok = false;
  assert.notEqual(overall(evaluate(failedCal)), 'NO-GO', 'manual corners are a legitimate way through');
});

test('evaluate: missing gate tests make the verdict INCOMPLETE, not GO', () => {
  const r = goodResults(); delete r.latency;
  assert.equal(overall(evaluate(r)), 'INCOMPLETE');
  assert.equal(overall(evaluate({})), 'INCOMPLETE');
});

test('evaluate: connectivity and recalibration rows', () => {
  const r = goodResults();
  r.connectivity = { phones: 3, stalledFrac: 0.4, perPhone: [{ medianRtt: 90, worst: 1200 }] };
  r.recal = { ok: true, ms: 4200, shiftPx: 7.5 };
  const rows = evaluate(r);
  assert.equal(rows.find((x) => x.id === 'connectivity').status, 'fail');
  assert.equal(rows.find((x) => x.id === 'recal').status, 'pass');
  r.recal.ms = 12000;
  assert.equal(evaluate(r).find((x) => x.id === 'recal').status, 'fail');
  r.connectivity = { phones: 0, stalledFrac: null, perPhone: [] };
  assert.equal(evaluate(r).find((x) => x.id === 'connectivity').status, 'skipped');
});

test('formatReport prints the verdict, every row with its threshold, and the setup', () => {
  const rows = evaluate(goodResults());
  const text = formatReport({ meta: { when: '2026-10-12T10:00:00Z', sim: false, setup: { camera: 'USB Cam', size: [640, 360] } }, results: goodResults(), rows });
  assert.match(text, /Overall: GO/);
  assert.match(text, /\[PASS\] Latency/);
  assert.match(text, /want <= 300 \/ 450/);
  assert.match(text, /camera: USB Cam/);
  assert.match(formatReport({ meta: { when: 'x', sim: true, setup: {} }, results: {}, rows: [] }), /SIMULATOR/);
  assert.ok(THRESHOLDS.ringIoU === 0.6);
});
