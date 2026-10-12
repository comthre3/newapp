// End-to-end for the projector test page (/p0.html) in the simulator: a scripted "virtual hand" plays the
// human, real phone pages join the connectivity probe. Screenshots land in test/out/p0-*.png.
//   npm run e2e:p0
// The first scenarios are the happy path; the rest are the ways a real run goes wrong (see docs/P0_TEST.md,
// "How the page protects the result"): each one must end in a visible, correct verdict, never a quiet PASS.
import assert from 'node:assert/strict';
import { boot, newPage } from './e2e-lib.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
const b = await boot();
let failures = 0;
const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { failures++; results.push(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 6).join('\n      ')}`); }
}
const noise = (e) => /Failed to load resource/.test(e);

const open = async (ctx, query = 'sim=1&fast=1') => {
  const page = await newPage(ctx, { width: 1280, height: 720 });
  await page.goto(`${b.base}/p0.html?${query}`);
  await page.waitForFunction(() => window.__p0 && window.__p0.phase === 'ready', null, { timeout: 30000 });
  return page;
};
const openFresh = async (query) => open(await b.browser.newContext(), query);
const objects = (page) => page.evaluate(() => window.__p0.editor.camera.objects.length);
const addObject = (page, o) => page.evaluate((x) => window.__p0.editor.camera.objects.push(x), o);
const clearObjects = (page) => page.evaluate(() => { window.__p0.editor.camera.objects.length = 0; });
const runStepAndWait = async (page, id, timeout = 90000) => {
  await page.evaluate((i) => { window.__done = false; window.__p0.runStep(i).then(() => { window.__done = true; }); }, id);
  await page.waitForFunction(() => window.__done === true, null, { timeout });
};
const reportText = (page) => page.evaluate(() => window.__p0.reportText());

/** A virtual human: puts a hand where the ring is, a crowd in the beam, and presses Recalibrate. */
const startAutopilot = (page) => page.evaluate(() => {
  const objs = () => window.__p0.editor.camera.objects;
  const clear = () => { const o = objs(); for (let i = o.length - 1; i >= 0; i--) if (o[i].auto) o.splice(i, 1); };
  window.__auto = setInterval(() => {
    const s = window.__p0.activeStep;
    const kind = s && s.constructor.name;
    clear();
    if (kind === 'RingStep' && s.phase === 'live') objs().push({ auto: true, kind: 'disc', x: s.cx, y: s.cy, r: s.r * 0.97, a: 0 });
    if (kind === 'BeamStep') {
      objs().push({ auto: true, kind: 'disc', x: 250, y: 220, r: 60, a: 0 }, { auto: true, kind: 'rect', x: 700, y: 220, w: 160, h: 200, a: 0.2 });
    }
    if (kind === 'RecalStep' && !s.busy) document.querySelector('#p0buttons button.primary')?.click();
  }, 40);
});
const stopAutopilot = (page) => page.evaluate(() => { clearInterval(window.__auto); const o = window.__p0.editor.camera.objects; o.length = 0; });

// ------------------------------------------------------------------ the happy path
await scenario('page loads, sim calibrates automatically, live view reaches "ready"', async () => {
  const page = await openFresh();
  assert.equal(await page.evaluate(() => window.__p0.results.calibration.ok), true);
  assert.ok(await page.evaluate(() => window.__p0.results.calibration.validFrac) > 0.9);
  const cal = await page.evaluate(() => window.__p0.results.calibration);
  assert.ok(cal.edgeMarginPx > 3 && cal.quad.length === 4, JSON.stringify(cal));
  await page.screenshot({ path: OUT + 'p0-1-ready.png' });
  assert.deepEqual(page.errors, []);
});

await scenario('live view follows a virtual hand (coverage rises, falls back to zero)', async () => {
  const page = await openFresh();
  await addObject(page, { kind: 'disc', x: 480, y: 200, r: 90, a: 0 });
  await page.waitForFunction(() => window.__p0.vis.coverage > 0.03, null, { timeout: 5000 });
  await clearObjects(page);
  await page.waitForFunction(() => window.__p0.vis.coverage < 0.002, null, { timeout: 5000 });
});

await scenario('latency probe really paints a black square on the wall, and white again in between', async () => {
  const page = await openFresh();
  await page.evaluate(() => {
    window.__seen = { black: 0, white: 0, wrongBlack: 0, wrongWhite: 0 };
    const px = () => {
      const s = window.__p0.activeStep; if (!s || !s.region) return;
      const st = window.__p0.stage, c = st.canvas;
      const x = Math.round(st.ox + (s.region.x + s.region.w / 2) * st.scale), y = Math.round(st.oy + (s.region.y + s.region.h / 2) * st.scale);
      const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
      const black = d[0] < 30 && d[1] < 30 && d[2] < 30, white = d[0] > 225 && d[1] > 225 && d[2] > 225;
      if (s.probe.dark) { if (black) window.__seen.black++; else window.__seen.wrongBlack++; }
      else if (white) window.__seen.white++; else window.__seen.wrongWhite++;
    };
    window.__pxTimer = setInterval(px, 8);
  });
  await runStepAndWait(page, 'latency', 60000);
  const seen = await page.evaluate(() => { clearInterval(window.__pxTimer); return window.__seen; });
  assert.ok(seen.black > 3 && seen.white > 3, JSON.stringify(seen));
  assert.ok(seen.wrongBlack <= seen.black * 0.2 && seen.wrongWhite <= seen.white * 0.2, `canvas disagreed with the probe state: ${JSON.stringify(seen)}`);
});

await scenario('guided run end to end: every step runs, a phone joins and is told when the probe is over, report says GO', async () => {
  const ctx = await b.browser.newContext();
  const page = await open(ctx);
  await page.evaluate(() => { document.querySelector('#projlink').value = 'HDMI cable'; document.querySelector('#notes').value = 'living room test'; });
  await startAutopilot(page);
  await page.evaluate(() => { window.__done = false; window.__p0.runGuided().then(() => { window.__done = true; }); });

  // when the connectivity step starts, a phone joins its probe through the relay
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'ConnStep' && window.__p0.relay.code, null, { timeout: 120000 });
  const code = await page.evaluate(() => window.__p0.relay.code);
  const phoneCtx = await b.browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const phone = await newPage(phoneCtx, { width: 390, height: 780 });
  await phone.goto(`${b.base}/p0-phone.html?room=${code}`);
  await phone.waitForFunction(() => document.querySelector('#conn').textContent === 'online');
  await page.screenshot({ path: OUT + 'p0-2-connectivity.png' });

  await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
  await stopAutopilot(page);
  await phone.waitForFunction(() => document.querySelector('#rtt').textContent === '✓', null, { timeout: 5000 });   // told "done", stopped pinging
  await phone.screenshot({ path: OUT + 'p0-3-phone.png' });
  await page.screenshot({ path: OUT + 'p0-4-report.png' });

  const rep = await page.evaluate(() => ({ text: window.__p0.reportText(), r: window.__p0.results }));
  const status = (id) => (rep.text.match(new RegExp(`\\[(\\w+)\\] ${id}`)) || [])[1];
  assert.equal(status('Calibration'), 'PASS', rep.text);
  assert.equal(status('Latency'), 'PASS', rep.text);
  assert.match(rep.text, /\[PASS\] Phantom shadows: clean room/);
  assert.match(rep.text, /\[PASS\] Phantom shadows: lantern and people nearby/);
  assert.match(rep.text, /\[PASS\] Shadow fit: ring \(r=70\)/);
  assert.match(rep.text, /\[PASS\] Shadow fit: small ring \(r=42\)/);
  assert.match(rep.text, /\[INFO\] Bodies in the beam/);
  assert.match(rep.text, /\[PASS\] Recalibration after a bump/);
  assert.match(rep.text, /\[WARN\] Connectivity.*local network/s, 'one phone on the LAN is only a provisional pass: ' + rep.text);
  assert.match(rep.text, /Overall: GO/);
  assert.match(rep.text, /SIMULATOR/);
  assert.match(rep.text, /NOT A VALID MEASUREMENT: fast mode/, 'a shortened run says so');
  assert.match(rep.text, /projectorConnection: HDMI cable/);
  assert.match(rep.text, /notes: living room test/);
  assert.match(rep.text, /calibrationQuad: \[\[/);
  assert.match(rep.text, /controlStripBlindShare/);

  // measurements are plausible, not just "pass"
  assert.ok(rep.r.latency.summary.stableOnset.median < 400, `latency ${rep.r.latency.summary.stableOnset.median}`);
  assert.equal(rep.r.latency.summary.missed, 0);
  assert.equal(rep.r.ring[0].trials.every((t) => t.success), true);
  assert.ok(rep.r.beam.peakHalf[0] > 0.02 && rep.r.beam.peakHalf[1] > 0.02, JSON.stringify(rep.r.beam));
  assert.ok(rep.r.beam.ignoredFrac.every((x) => x < 0.05), `the control strip should hide little during a test: ${JSON.stringify(rep.r.beam.ignoredFrac)}`);
  assert.ok(rep.r.quiet.every((q) => q.ticks >= q.expectedTicks * 0.8), JSON.stringify(rep.r.quiet.map((q) => [q.ticks, q.expectedTicks])));
  assert.ok(rep.r.recal.ms > 0 && rep.r.recal.shiftPx < 3, JSON.stringify(rep.r.recal));
  assert.ok(rep.r.connectivity.phones === 1 && rep.r.connectivity.stalledFrac === 0 && rep.r.connectivity.lan === true, JSON.stringify(rep.r.connectivity));

  // the report overlay is visible and copy does something
  assert.equal(await page.isVisible('#p0report'), true);
  assert.match(await page.textContent('#p0report'), /Overall: GO/);
  await page.click('#rep-copy');
  await page.waitForFunction(() => document.querySelector('#rep-msg').textContent.length > 0);
  assert.deepEqual(page.errors.filter((e) => !noise(e)), []);
  assert.deepEqual(phone.errors, []);
});

// ------------------------------------------------------------------ verdicts must not lie
await scenario('nobody fits the ring: FAIL and NO-GO, even though most tests were never run', async () => {
  const page = await openFresh();
  await runStepAndWait(page, 'ring');
  const text = await reportText(page);
  assert.match(text, /\[FAIL\] Shadow fit: ring \(r=70\)/);
  assert.match(text, /Overall: NO-GO/, 'a failed gate is decisive');
  assert.match(text, /Not run or invalid: .*Latency/);
  await page.screenshot({ path: OUT + 'p0-5-fail.png' });
});

await scenario('a phantom appears from nowhere in the quiet test: FAIL', async () => {
  const page = await openFresh();
  await page.evaluate(() => { window.__done = false; window.__p0.runStep('quiet').then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'QuietStep', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await addObject(page, { kind: 'disc', x: 200, y: 300, r: 50, a: 0 });
  await page.waitForTimeout(1200);
  await clearObjects(page);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const q = await page.evaluate(() => window.__p0.results.quiet[0]);
  assert.equal(q.events.length >= 1, true, JSON.stringify(q.events));
  assert.equal(q.events[0].half, 0, 'left half');
  assert.match(await reportText(page), /\[FAIL\] Phantom shadows: clean room/);
});

await scenario('a ghost that never leaves is not "just one event": the quiet test FAILs on how long it stays', async () => {
  const page = await openFresh();
  await addObject(page, { kind: 'disc', x: 200, y: 300, r: 60, a: 0 });          // there from the very start, in the left lane
  await page.waitForFunction(() => window.__p0.vis.coverage > 0.01, null, { timeout: 5000 });
  await runStepAndWait(page, 'quiet');
  const q = await page.evaluate(() => window.__p0.results.quiet[0]);
  assert.ok(q.duty[0] > 0.9 && q.duty[1] === 0, JSON.stringify(q.duty));
  assert.match(await reportText(page), /\[FAIL\] Phantom shadows: clean room/);
});

await scenario('something already in the latency square voids the run instead of scoring an instant detection', async () => {
  const page = await openFresh();
  await addObject(page, { kind: 'rect', x: 480, y: 260, w: 280, h: 280, a: 0 });
  await page.waitForFunction(() => window.__p0.vis.coverage > 0.05, null, { timeout: 5000 });
  await runStepAndWait(page, 'latency', 60000);
  const l = await page.evaluate(() => window.__p0.results.latency.summary);
  assert.equal(l.aborted, 'square-not-clear');
  assert.equal(l.trials, 0, 'nothing was scored');
  const text = await reportText(page);
  assert.match(text, /\[SKIP\] Latency/);
  assert.match(text, /Invalid run/);
  assert.match(text, /Overall: INCOMPLETE/);
});

await scenario('a shadow left on the ring voids the ring test instead of scoring instant successes', async () => {
  const page = await openFresh();
  await addObject(page, { kind: 'disc', x: 480, y: 240, r: 90, a: 0 });
  await page.waitForFunction(() => window.__p0.vis.coverage > 0.03, null, { timeout: 5000 });
  await runStepAndWait(page, 'ring', 120000);
  const r = await page.evaluate(() => window.__p0.results.ring[0]);
  assert.ok(r.neverClear >= 1, JSON.stringify(r));
  assert.ok(r.trials.every((t) => !t.success), 'a ring that was covered from the start never counts as fitted');
  assert.match(await reportText(page), /\[SKIP\] Shadow fit: ring \(r=70\)[\s\S]*still covered/);
});

await scenario('a big body in a lane is measured at its real size (control strip does not hide it)', async () => {
  const page = await openFresh();
  await page.evaluate(() => { window.__done = false; window.__p0.runStep('beam').then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'BeamStep', null, { timeout: 5000 });
  await addObject(page, { kind: 'rect', x: 240, y: 380, w: 250, h: 300, a: 0 });   // about 29% of the left lane
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const beam = await page.evaluate(() => window.__p0.results.beam);
  assert.ok(beam.peakHalf[0] > 0.25, `the 25% cap should have triggered: ${JSON.stringify(beam.peakHalf)}`);
  assert.ok(beam.ignoredFrac.every((x) => x < 0.05), JSON.stringify(beam.ignoredFrac));
  assert.match(await reportText(page), /the cap would have triggered/);
});

await scenario('a phone that left before the probe is not scored as a network failure', async () => {
  const ctx = await b.browser.newContext();
  const page = await open(ctx);
  await page.evaluate(() => { window.__done = false; window.__p0.runStep('conn').then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__p0.relay.code, null, { timeout: 10000 });
  const code = await page.evaluate(() => window.__p0.relay.code);
  const join = async () => {
    const c = await b.browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true });
    const p = await newPage(c, { width: 390, height: 780 });
    await p.goto(`${b.base}/p0-phone.html?room=${code}`);
    await p.waitForFunction(() => document.querySelector('#conn').textContent === 'online');
    return p;
  };
  const stays = await join();
  const leaves = await join();
  await page.waitForFunction(() => [...window.__p0.relay.phones.values()].filter((p) => p.online && p.lastReportAt).length === 2, null, { timeout: 8000 });
  await leaves.context().close();                                                 // closed the tab before the probe
  await page.waitForFunction(() => [...window.__p0.relay.phones.values()].filter((p) => p.online).length === 1, null, { timeout: 8000 });
  await page.click('#p0buttons button.primary');                                  // Start probe
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const k = await page.evaluate(() => window.__p0.results.connectivity);
  assert.equal(k.phones, 1, JSON.stringify(k));
  assert.equal(k.stalledFrac, 0, JSON.stringify(k));
  assert.doesNotMatch(await reportText(page), /\[FAIL\] Connectivity/);
  await stays.context().close();
});

await scenario('a persistent page error is reported once, makes the run INVALID (not a hardware verdict), and can be cleared', async () => {
  const page = await openFresh();
  await page.evaluate(() => { window.__realWorld = window.__p0.stage.world; window.__p0.stage.world = () => { throw new Error('boom'); }; });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__p0.stage.world = window.__realWorld; });
  const errs = await page.evaluate(() => window.__p0.results.errors);
  assert.equal(errs.length, 1, JSON.stringify(errs));
  const text = await reportText(page);
  assert.match(text, /Overall: INVALID RUN/);
  await page.evaluate(() => window.__p0.showReport());
  await page.click('#rep-reset');
  assert.equal(await page.evaluate(() => window.__p0.results.errors), undefined);
  assert.equal(await page.evaluate(() => window.__p0.results.calibration.ok), true, 'clearing results keeps the calibration');
  assert.doesNotMatch(await reportText(page), /INVALID RUN/);
});

// ------------------------------------------------------------------ the world changes under the test
await scenario('window resized after calibration: the calibration is marked stale, tests refuse to run, recalibrating fixes it', async () => {
  const page = await openFresh();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(() => window.__p0.calStale !== '', null, { timeout: 5000 });
  await page.evaluate(() => window.__p0.runStep('latency'));
  assert.equal(await page.evaluate(() => window.__p0.results.latency), undefined, 'no result measured against a stale calibration');
  assert.match(await page.textContent('#p0panel'), /out of date/);
  await page.click('#p0buttons button.primary');                                   // Calibrate again -> aim view
  await page.waitForFunction(() => window.__p0.phase === 'aim');
  await page.click('#p0buttons button.primary');                                   // Calibrate
  await page.waitForFunction(() => window.__p0.phase === 'ready' && window.__p0.calStale === '', null, { timeout: 30000 });
});

await scenario('page hidden mid-test (locked screen): the test is discarded with a visible notice', async () => {
  const page = await openFresh();
  await page.evaluate(() => { window.__p0.runSingle('quiet'); });
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'QuietStep', null, { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.__p0.phase === 'ready' && window.__p0.notice.length > 0, null, { timeout: 5000 });
  await page.evaluate(() => { delete document.hidden; });
  assert.match(await page.evaluate(() => window.__p0.notice), /hidden/);
  assert.equal(await page.evaluate(() => window.__p0.results.quiet), undefined, 'a hidden-page run is never scored');
  assert.match(await page.textContent('#p0panel'), /Interrupted/);
});

await scenario('camera freezes mid-test: the test is discarded and the page returns to setup', async () => {
  const page = await openFresh();
  await page.evaluate(() => { window.__p0.runSingle('quiet'); });
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'QuietStep', null, { timeout: 5000 });
  await page.evaluate(() => { window.__p0.camera.health = () => ({ ok: false, reason: 'the camera stopped delivering pictures' }); });
  await page.waitForFunction(() => window.__p0.phase === 'setup', null, { timeout: 5000 });
  assert.match(await page.textContent('#setupmsg'), /camera stopped/);
  assert.equal(await page.evaluate(() => window.__p0.results.quiet), undefined);
  assert.equal(await page.evaluate(() => window.__p0.results.calibration), undefined, 'a lost camera takes its calibration with it');
});

await scenario('Escape before any camera exists keeps the page usable (no broken "ready" state)', async () => {
  const ctx = await b.browser.newContext();
  const page = await newPage(ctx, { width: 1280, height: 720 });
  await page.goto(`${b.base}/p0.html?fast=1`);
  await page.waitForFunction(() => window.__p0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__p0.phase), 'setup');
  assert.equal(await page.isVisible('#p0setup'), true);
  assert.equal(await page.isVisible('#p0panel'), false);
  assert.deepEqual(page.errors.filter((e) => !noise(e)), []);
});

// ------------------------------------------------------------------ real camera path
await scenario('real camera path (Chromium fake camera): one camera for a double tap; a failed auto-calibration needs hand-placed corners and stays a warning', async () => {
  const ctx = await b.browser.newContext({ permissions: ['camera'] });
  const page = await newPage(ctx, { width: 1280, height: 720 });
  await page.addInitScript(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__gum = 0;
    navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return gum(c); };
  });
  await page.goto(`${b.base}/p0.html?fast=1`);
  await page.waitForFunction(() => window.__p0);
  await page.evaluate(() => { const btn = document.querySelector('#btn-cam'); btn.click(); btn.click(); });   // an impatient double tap
  await page.waitForFunction(() => window.__p0.phase === 'aim', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__gum), 1, 'a second tap must not open a second camera');
  assert.ok((await page.locator('#camsel option').count()) >= 2, 'camera list populated');
  await page.screenshot({ path: OUT + 'p0-6-aim.png' });
  await page.click('#p0buttons button.primary');          // Calibrate
  await page.waitForFunction(() => window.__p0.phase === 'review', null, { timeout: 30000 });
  assert.match(await page.textContent('#p0text'), /(camera|projection|picture|bright)/i);
  await page.screenshot({ path: OUT + 'p0-7-review.png' });
  await page.click('#p0buttons button.primary');          // accept without touching the corners: refused
  assert.equal(await page.evaluate(() => window.__p0.phase), 'review', 'a failed auto-calibration cannot be accepted untouched');
  await page.locator('#p0buttons button', { hasText: 'Adjust corners' }).click();
  const [x, y] = await page.evaluate(() => window.__p0.quadClient(0));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 16, { steps: 5 });
  await page.mouse.up();
  await page.locator('#p0buttons button', { hasText: 'Done adjusting' }).click();
  await page.click('#p0buttons button.primary');          // Use my corners
  await page.waitForFunction(() => window.__p0.phase === 'ready');
  const cal = await page.evaluate(() => window.__p0.results.calibration);
  assert.equal(cal.manual, true);
  assert.equal(cal.ok, false);
  assert.match(await reportText(page), /\[(WARN|FAIL)\] Calibration[\s\S]*auto-calibration failed/, 'hand-placed corners never erase the auto failure');
  const info = await page.evaluate(() => ({ stats: window.__p0.camera.frameStats(), desc: window.__p0.camera.describe() }));
  assert.ok(info.desc.label.length > 0 && info.stats.supported === true, JSON.stringify(info));
  assert.deepEqual(page.errors.filter((e) => !noise(e)), []);
});

await scenario('phone probe page: handles a missing room and a bad room code without crashing', async () => {
  const ctx = await b.browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true });
  const p = await newPage(ctx, { width: 390, height: 780 });
  await p.goto(`${b.base}/p0-phone.html`);
  assert.equal(await p.textContent('#conn'), 'no room');
  await p.goto(`${b.base}/p0-phone.html?room=ZZZZ`);
  await p.waitForFunction(() => /Room not found/.test(document.querySelector('#conn').textContent));
  assert.deepEqual(p.errors.filter((e) => !/WebSocket|Failed to load resource/.test(e)), []);
});

await b.close();
console.log(`\nUmbra P0 e2e\n${results.join('\n')}\n\n${failures ? `${failures} FAILED` : 'all passed'} — screenshots in test/out/p0-*.png\n`);
process.exit(failures ? 1 : 0);
