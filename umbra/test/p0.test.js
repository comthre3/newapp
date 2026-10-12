import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GW, GH, fillDisc, fillRect } from '../public/js/game/world.js';
import {
  THRESHOLDS, LABELS, percentile, median, mean, sd, summarize, findBlobs, BlobEvents, ringIoU, discCover, RingTrial,
  LatencyProbe, analyzeConnectivity, evaluate, overall, notRun, attention, formatReport,
} from '../public/js/p0/metrics.js';

const grid = () => new Uint8Array(GW * GH);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const left = (cells = 20) => [{ cells, cx: 30, cy: 40 }];
const right = (cells = 20) => [{ cells, cx: 120, cy: 40 }];

test('statistics: percentile, median, sd, and tolerance of junk values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.ok(near(percentile([0, 10], 50), 5));
  assert.ok(near(percentile([1, 2, 3, 4, 5], 95), 4.8));
  assert.ok(near(sd([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7)));
  assert.equal(sd([5]), null);
  assert.equal(median([]), null);
  assert.equal(mean([1, NaN, null, 3]), 2);
  const s = summarize([100, 200, NaN, 300]);
  assert.deepEqual([s.n, s.min, s.max, s.median], [3, 100, 300, 200]);
});

test('findBlobs separates components, drops specks, reports centroids', () => {
  const m = grid();
  fillRect(m, 60, 60, 60, 60);
  fillRect(m, 600, 300, 60, 60);
  m[5 * GW + 100] = 1;
  const blobs = findBlobs(m, GW, GH, 6);
  assert.equal(blobs.length, 2);
  const [a, b] = blobs.sort((p, q) => p.cx - q.cx);
  assert.equal(a.cells, 100);
  assert.ok(Math.abs(a.cx - 14.5) < 0.6 && Math.abs(b.cx - 104.5) < 0.6);
  assert.equal(findBlobs(m, GW, GH, 200).length, 0);
});

// ---------------------------------------------------------------- phantom shadows (review findings MV-1, V1)
test('BlobEvents counts each appearance per lane and survives a short dropout inside one event', () => {
  const ev = new BlobEvents({ quietTicks: 3 });
  let t = 0;
  const tick = (b) => ev.update(b, t++ * 0.05);
  for (let i = 0; i < 5; i++) tick([]);
  for (let i = 0; i < 4; i++) tick(left());
  tick([]); tick(left());                          // one-tick dropout: same event
  for (let i = 0; i < 5; i++) tick([]);
  for (let i = 0; i < 3; i++) tick(right());
  assert.deepEqual(ev.events.map((e) => e.half), [0, 1]);
  assert.deepEqual(ev.perMinute(30), [2, 2]);
});

test('a permanent ghost is measured by duty and longest run, not hidden as "one event"', () => {
  const ev = new BlobEvents();
  for (let i = 0; i < 1200; i++) ev.update(left(400), i * 0.05);
  assert.equal(ev.events.length, 1);
  assert.ok(ev.duty()[0] > 0.99 && ev.duty()[1] === 0, JSON.stringify(ev.duty()));
  assert.ok(ev.longest()[0] > 59 && ev.longest()[1] === 0, JSON.stringify(ev.longest()));
});

test('flicker with gaps of two ticks or more is counted again each time', () => {
  const ev = new BlobEvents({ quietTicks: 2 });
  for (let i = 0; i < 1200; i++) ev.update(i % 4 < 2 ? left() : [], i * 0.05);   // on 2, off 2
  assert.ok(ev.events.length > 250, `${ev.events.length} events`);
  assert.ok(ev.perMinute(60)[0] > 250);
});

test('a ghost in one lane cannot hide phantoms in the other lane, and simultaneous blobs both count', () => {
  const ev = new BlobEvents({ quietTicks: 2 });
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const rightPhantom = i % 100 >= 50 && i % 100 < 60;     // a right-lane phantom every 5 s
    ev.update([...left(300), ...(rightPhantom ? right() : [])], t++ * 0.05);
  }
  const perLane = [0, 1].map((h) => ev.events.filter((e) => e.half === h).length);
  assert.equal(perLane[0], 1);
  assert.equal(perLane[1], 6);
  const both = new BlobEvents({ quietTicks: 2 });
  for (let i = 0; i < 4; i++) both.update([], i * 0.05);
  both.update([...left(50), ...right(20)], 0.25);
  assert.deepEqual(both.events.map((e) => e.half).sort(), [0, 1]);
});

// ---------------------------------------------------------------- ring
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
  assert.equal(t1.update(good, 2.0), 'running');
  assert.equal(t1.update(grid(), 2.5), 'running');
  assert.equal(t1.update(good, 3.0), 'running');
  assert.equal(t1.update(good, 3.9), 'running');
  assert.equal(t1.update(good, 4.05), 'success');
  assert.ok(near(t1.result().forming, 3.0), `forming ${t1.result().forming}`);
  const t2 = new RingTrial({ cx, cy, r, holdS: 1, timeoutS: 10 });
  t2.start(0);
  assert.equal(t2.update(grid(), 9.9), 'running');
  assert.equal(t2.update(grid(), 10.1), 'timeout');
  assert.equal(t2.result().forming, null);
});

// ---------------------------------------------------------------- latency probe
/** Run a LatencyProbe against a fake camera/detector with known delays and a 20 Hz poll. */
function runProbe({ rawDelay, stableDelay, releaseRaw = rawDelay, releaseStable = stableDelay, trials = 12, pollMs = 50, blind = false, stuck = false, squareDirtyUntilMs = 0, maxContaminated, clearTimeoutS }) {
  const seed = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const probe = new LatencyProbe({ trials, timeoutS: 2, gapS: [0.3, 0.6], rng: seed, ...(maxContaminated ? { maxContaminated } : {}), ...(clearTimeoutS ? { clearTimeoutS } : {}) });
  let paintedDarkAt = null, paintedLightAt = null, lastTick = -1;
  let rd = { t: -1, rawDark: false, stableDark: false, rawLit: true, stableClear: true };
  for (let ms = 0; ms < 240000 && !probe.done; ms++) {
    const now = ms / 1000;
    if (ms - lastTick >= pollMs) {
      lastTick = ms;
      const darkFor = paintedDarkAt === null ? -1 : ms - paintedDarkAt;
      const lightFor = paintedLightAt === null ? -1 : ms - paintedLightAt;
      const showsDark = paintedDarkAt !== null && (paintedLightAt === null || paintedDarkAt > paintedLightAt);
      const dirty = ms < squareDirtyUntilMs;               // a hand or shadow is in the square
      rd = {
        t: now,
        rawDark: !blind && (dirty || (showsDark && darkFor >= rawDelay)),
        stableDark: !blind && (dirty || (showsDark && darkFor >= stableDelay)),
        rawLit: !dirty && !(stuck && paintedDarkAt !== null) && !showsDark && (paintedLightAt === null || lightFor >= releaseRaw),
        stableClear: !dirty && !(stuck && paintedDarkAt !== null) && !showsDark && (paintedLightAt === null || lightFor >= releaseStable),
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
  assert.ok(s.stableOnset.median > s.rawOnset.median);
  assert.ok(s.stableRelease.median >= 260 && s.stableRelease.median <= 320, `release ${s.stableRelease.median}`);
});

test('LatencyProbe: misses stay in the statistics as the timeout value', () => {
  const p = runProbe({ rawDelay: 0, stableDelay: 0, trials: 4, blind: true });
  const s = p.summary();
  assert.equal(s.missed, 4);
  assert.equal(s.stableOnset.n, 0);
  assert.equal(s.stableOnsetCensored.n, 4);
  assert.equal(s.stableOnsetCensored.median, 2000);
});

test('LatencyProbe never flashes while something is already in the square (no absurd instant "detections")', () => {
  const p = runProbe({ rawDelay: 100, stableDelay: 180, trials: 6, squareDirtyUntilMs: 4000 });
  assert.equal(p.results.length, 6);
  const s = p.summary();
  assert.ok(s.stableOnset.min >= 100, `fastest ${s.stableOnset.min} ms: a pre-existing shadow must not score as a detection`);
  assert.equal(s.aborted, null);
});

test('LatencyProbe gives up, flagged, when the square is never clear', () => {
  const p = runProbe({ rawDelay: 100, stableDelay: 180, trials: 6, squareDirtyUntilMs: 1e9, maxContaminated: 3 });
  const s = p.summary();
  assert.equal(s.aborted, 'square-not-clear');
  assert.equal(s.trials, 0);
  assert.ok(s.contaminated >= 3);
});

test('LatencyProbe grades a shadow that never clears after the square goes white', () => {
  const p = runProbe({ rawDelay: 60, stableDelay: 120, trials: 3, stuck: true, maxContaminated: 2 });
  const s = p.summary();
  assert.ok(s.missedRelease >= 1 || s.aborted === 'square-not-clear', JSON.stringify(s));
});

// ---------------------------------------------------------------- connectivity (review findings F7, R1, V7, MV-4)
const mkReports = (spec) => Object.fromEntries(Object.entries(spec).map(([id, f]) => [id, f]));
const secs = (from, to, o = {}) => Array.from({ length: to - from }, (_, i) => ({ t: (from + i) * 1000, median: 80, max: 150, ...o }));

test('analyzeConnectivity scores only the phones that were there at the start', () => {
  const reports = mkReports({
    a: secs(0, 60),
    b: secs(0, 60, { max: 200 }),
    ghost: [],                                    // joined an earlier run, never reports now
    late: secs(35, 60),                           // scanned the QR code halfway through
  });
  const r = analyzeConnectivity(reports, 0, 60000, { participants: ['a', 'b'] });
  assert.equal(r.phones, 2);
  assert.equal(r.stalledFrac, 0);
  const all = analyzeConnectivity(reports, 0, 60000);        // the old behaviour: everyone counted
  assert.ok(all.stalledFrac > 0.25, 'ghosts and late joiners used to cause a false fail');
});

test('a phone that drops mid-probe is reported as dropped and does not fake a network failure', () => {
  const reports = mkReports({ a: secs(0, 60), b: secs(0, 30) });
  const r = analyzeConnectivity(reports, 0, 60000, { participants: ['a', 'b'], left: ['b'] });
  assert.equal(r.phones, 1);
  assert.equal(r.dropped, 1);
  assert.equal(r.stalledFrac, 0);
});

test('stalls and sleeping phones: slow replies count, a hidden page does not', () => {
  const slow = secs(0, 60).map((x) => (x.t >= 10000 && x.t < 15000 ? { ...x, max: 900 } : x));
  const sleepy = secs(0, 60).map((x) => (x.t >= 20000 && x.t < 30000 ? { ...x, max: 9999, hidden: true } : x));
  const r = analyzeConnectivity({ slow, sleepy }, 0, 60000);
  const by = Object.fromEntries(r.perPhone.map((p) => [p.id, p]));
  assert.equal(by.slow.stalledWindows, 1);
  assert.equal(by.sleepy.stalledWindows, 0);
  assert.equal(by.sleepy.sleptWindows, 2);
});

// ---------------------------------------------------------------- verdicts
const ringRun = (label, ok = 10, n = 10, sdv = 0.4) => ({ label, r: 70, trials: Array.from({ length: n }, (_, i) => ({ success: i < ok, forming: 2, peakIoU: 0.8 })), summary: { n: ok, median: 2, sd: sdv } });
const quietRun = (label, over = {}) => ({ label, durationS: 60, ticks: 1190, expectedTicks: 1200, events: [], perMinHalf: [0, 0], duty: [0, 0], longest: [0, 0], peakCoverage: 0, ...over });
const goodResults = () => ({
  calibration: { ok: true, manual: false, contrast: 0.5, validFrac: 0.97, cw: 640, ch: 360 },
  latency: { summary: { trials: 20, missed: 0, missedRelease: 0, contaminated: 0, aborted: null, timeoutMs: 2000, rawOnset: { median: 120 }, stableOnset: { median: 200, p95: 300 }, stableOnsetCensored: { median: 200, p95: 300 }, stableRelease: { median: 220 } } },
  quiet: [quietRun(LABELS.quietClean), quietRun(LABELS.quietLantern)],
  ring: [ringRun(LABELS.ring), ringRun(LABELS.ringSmall)],
});
const statusOf = (rows, id) => (rows.find((r) => r.id === id) || {}).status;

test('evaluate: a complete healthy run is GO', () => {
  assert.equal(overall(evaluate(goodResults())), 'GO');
});

test('every required gate always has a row: skipping one can never leave a GO (finding F2, V5, MV-10)', () => {
  for (const drop of ['calibration', 'latency']) {
    const r = goodResults(); delete r[drop];
    assert.equal(overall(evaluate(r)), 'INCOMPLETE', drop);
  }
  const noLantern = goodResults(); noLantern.quiet = [noLantern.quiet[0]];
  const rows = evaluate(noLantern);
  assert.equal(overall(rows), 'INCOMPLETE');
  assert.equal(statusOf(rows, `quiet:${LABELS.quietLantern}`), 'skipped');
  assert.ok(notRun(rows).some((t) => /lantern/.test(t)));
  const noRing = goodResults(); noRing.ring = [noRing.ring[1]];
  assert.equal(overall(evaluate(noRing)), 'INCOMPLETE');
  assert.equal(overall(evaluate({})), 'INCOMPLETE');
});

test('a failed gate is NO-GO even when other tests were not run (finding V8)', () => {
  const r = { calibration: { ok: false, error: 'cut-off', contrast: 0.4 } };
  assert.equal(overall(evaluate(r)), 'NO-GO');
});

test('the child-size ring informs but does not decide; the adult ring follows the design bar exactly (finding V9)', () => {
  const small = goodResults(); small.ring[1] = ringRun(LABELS.ringSmall, 3);
  const rows = evaluate(small);
  assert.equal(statusOf(rows, `ring:${LABELS.ringSmall}`), 'fail');
  assert.equal(overall(rows), 'GO', 'a non-gate row never flips the headline');
  assert.ok(attention(rows).some((a) => /small ring/.test(a)), 'but it is called out');
  const adult = goodResults(); adult.ring[0] = ringRun(LABELS.ring, 7);
  assert.equal(overall(evaluate(adult)), 'NO-GO', '7 of 10 is below the design bar of 8');
  adult.ring[0] = ringRun(LABELS.ring, 8);
  assert.equal(overall(evaluate(adult)), 'GO');
});

test('latency: missed squares count as the timeout, so 1-2 misses cannot hide behind a good p95 (finding V3, MV-2)', () => {
  const mk = (missed, trials = 20) => {
    const good = Array.from({ length: trials - missed }, (_, i) => 180 + (i * 7) % 120);
    const censored = [...good, ...Array(missed).fill(2000)];
    const q = (a, p) => percentile(a, p);
    const r = goodResults();
    r.latency.summary = { trials, missed, missedRelease: 0, contaminated: 0, aborted: null, timeoutMs: 2000, rawOnset: { median: 100 }, stableOnset: summarize(good), stableOnsetCensored: { median: q(censored, 50), p95: q(censored, 95) }, stableRelease: { median: 200 } };
    return evaluate(r);
  };
  assert.equal(statusOf(mk(0), 'latency'), 'pass');
  assert.equal(statusOf(mk(1), 'latency'), 'warn', 'one miss in 20 is a warning');
  assert.equal(statusOf(mk(2), 'latency'), 'fail', 'two misses in 20 (10%) fail');
  const slow = goodResults(); slow.latency.summary.stableOnsetCensored = { median: 420, p95: 600 };
  assert.equal(overall(evaluate(slow)), 'CAUTION');
  slow.latency.summary.stableOnsetCensored = { median: 700, p95: 900 };
  assert.equal(overall(evaluate(slow)), 'NO-GO');
  const stuck = goodResults(); stuck.latency.summary.missedRelease = 4;
  assert.equal(statusOf(evaluate(stuck), 'latency'), 'fail', 'a shadow that does not clear is a failure');
  const dirty = goodResults(); dirty.latency.summary = { ...dirty.latency.summary, trials: 0, aborted: 'square-not-clear', contaminated: 6 };
  assert.equal(overall(evaluate(dirty)), 'INCOMPLETE', 'an invalid probe is not a pass');
});

test('phantoms: a permanent or long-lived ghost fails even when it is "only one event" (finding MV-1, V1)', () => {
  const ghost = goodResults(); ghost.quiet[0] = quietRun(LABELS.quietClean, { events: [{ half: 0 }], perMinHalf: [1, 0], duty: [0.99, 0], longest: [59, 0] });
  const rows = evaluate(ghost);
  assert.equal(statusOf(rows, `quiet:${LABELS.quietClean}`), 'fail');
  assert.equal(overall(rows), 'NO-GO');
  const flicker = goodResults(); flicker.quiet[1] = quietRun(LABELS.quietLantern, { events: Array(5).fill({ half: 1 }), perMinHalf: [0, 5], duty: [0, 0.02], longest: [0, 1] });
  assert.equal(overall(evaluate(flicker)), 'NO-GO');
  const invalid = goodResults(); invalid.quiet[0] = quietRun(LABELS.quietClean, { ticks: 40 });
  const iv = evaluate(invalid);
  assert.equal(statusOf(iv, `quiet:${LABELS.quietClean}`), 'skipped');
  assert.match(iv.find((r) => r.id === `quiet:${LABELS.quietClean}`).summary, /only 40 of about 1200/);
  assert.equal(overall(iv), 'INCOMPLETE', 'a throttled run must not pass on almost no data (finding R2)');
});

test('calibration: hand-placed corners never erase an auto failure, and cap the result at a warning (finding V4)', () => {
  const r = goodResults();
  r.calibration = { ok: false, manual: true, error: 'cut-off', contrast: 0.5, validFrac: 1, cw: 640, ch: 360, edgeMarginPx: 1 };
  const rows = evaluate(r);
  const cal = rows.find((x) => x.id === 'calibration');
  assert.equal(cal.status, 'warn');
  assert.match(cal.summary, /cut-off/);
  assert.match(cal.summary, /edge of the camera view/);
  assert.equal(overall(rows), 'CAUTION');
  r.calibration = { ok: true, manual: false, contrast: 0.5, validFrac: 0.97, cw: 640, ch: 360 };
  assert.equal(statusOf(evaluate(r), 'calibration'), 'pass');
});

test('recalibration: a failure says it failed, not that it was slow (finding F10); a "bump" that moved nothing is flagged', () => {
  const r = goodResults();
  r.recal = { ok: false, ms: 9000, error: 'cut-off', shiftPx: null };
  const f = evaluate(r).find((x) => x.id === 'recal');
  assert.equal(f.status, 'fail');
  assert.match(f.summary, /FAILED \(cut-off\)/);
  assert.doesNotMatch(f.consequence, /settle/);
  r.recal = { ok: true, ms: 3000, shiftPx: 0.2 };
  const ok = evaluate(r).find((x) => x.id === 'recal');
  assert.equal(ok.status, 'pass');
  assert.match(ok.summary, /not actually bumped/);
});

test('connectivity: a LAN run, a handful of phones or a dropout only earn a provisional pass (findings MV-6, V11)', () => {
  const base = { phones: 8, dropped: 0, stalledFrac: 0.02, relayHost: 'relay.example.com', lan: false, perPhone: Array.from({ length: 8 }, () => ({ medianRtt: 90, worst: 220 })) };
  const run = (over) => { const r = goodResults(); r.connectivity = { ...base, ...over }; return evaluate(r).find((x) => x.id === 'connectivity'); };
  assert.equal(run({}).status, 'pass');
  assert.equal(run({ lan: true, relayHost: '192.168.1.20:3000' }).status, 'warn');
  assert.match(run({ lan: true, relayHost: '192.168.1.20:3000' }).summary, /mobile data/);
  assert.equal(run({ phones: 2, perPhone: [{ medianRtt: 90, worst: 200 }, { medianRtt: 90, worst: 200 }] }).status, 'warn');
  assert.equal(run({ dropped: 1 }).status, 'warn');
  assert.equal(run({ stalledFrac: 0.4 }).status, 'fail');
  assert.equal(run({ phones: 0, perPhone: [] }).status, 'skipped');
  const missing = goodResults();
  assert.equal(statusOf(evaluate(missing), 'connectivity'), 'skipped', 'always a row, even when never run');
});

test('failed non-gate rows are listed under the headline (finding V6)', () => {
  const r = goodResults();
  r.connectivity = { phones: 8, dropped: 0, stalledFrac: 0.5, relayHost: 'relay.example.com', lan: false, perPhone: [{ medianRtt: 90, worst: 2000 }] };
  const rows = evaluate(r);
  assert.equal(overall(rows), 'GO');
  assert.ok(attention(rows).some((a) => /Connectivity/.test(a) && /offline/.test(a)));
  const text = formatReport({ meta: { when: 'x', sim: false, flags: [], setup: {} }, results: r, rows });
  assert.match(text, /Needs attention: .*Connectivity/);
});

test('an internal page error is an INVALID RUN, deduplicated, and never a hardware verdict (finding V10)', () => {
  const r = goodResults();
  r.errors = Array(500).fill('draw failed: x is undefined');
  const rows = evaluate(r);
  assert.equal(rows.filter((x) => x.id === 'error').length, 1);
  assert.equal(overall(rows), 'INVALID RUN');
});

test('the report says what was not run and flags fast-mode runs as invalid measurements (findings F2, R7, V12)', () => {
  const r = goodResults(); r.quiet = [r.quiet[0]];
  const rows = evaluate(r);
  const text = formatReport({ meta: { when: '2026-10-12T10:00:00Z', sim: false, flags: ['fast mode (shortened tests)', 'custom thresholds on=0.2'], setup: { camera: 'USB Cam', calibrationQuad: [[1, 2], [3, 4]] } }, results: r, rows });
  assert.match(text, /Overall: INCOMPLETE/);
  assert.match(text, /Not run or invalid: .*lantern/);
  assert.match(text, /NOT A VALID MEASUREMENT: fast mode/);
  assert.match(text, /\[PASS\] Latency/);
  assert.match(text, /want <= 300 \/ 450/);
  assert.match(text, /calibrationQuad/);
  assert.match(formatReport({ meta: { when: 'x', sim: true, setup: {} }, results: {}, rows: [] }), /SIMULATOR/);
  assert.ok(THRESHOLDS.ringIoU === 0.6);
});

test('a target that cannot be measured, or a ring that was never clear, voids the run instead of scoring it (findings MV-5, MV-7)', () => {
  const r = goodResults();
  r.latency = { ...r.latency, blindFrac: 0.4 };
  let rows = evaluate(r);
  assert.equal(rows.find((x) => x.id === 'latency').status, 'skipped');
  assert.match(rows.find((x) => x.id === 'latency').summary, /Invalid run: 40%/);
  assert.equal(overall(rows), 'INCOMPLETE');

  const r2 = goodResults();
  r2.ring = r2.ring.map((x, i) => (i === 0 ? { ...x, neverClear: 2 } : x));
  rows = evaluate(r2);
  assert.equal(rows.find((x) => x.id === `ring:${LABELS.ring}`).status, 'skipped');
  assert.match(rows.find((x) => x.id === `ring:${LABELS.ring}`).summary, /still covered/);

  const r3 = goodResults();
  r3.ring = r3.ring.map((x, i) => (i === 0 ? { ...x, blindFrac: 0.3 } : x));
  assert.equal(evaluate(r3).find((x) => x.id === `ring:${LABELS.ring}`).status, 'skipped');
});
