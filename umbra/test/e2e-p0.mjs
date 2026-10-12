// End-to-end for the projector test page (/p0.html) in the simulator: a scripted "virtual hand" plays the
// human, a real phone page joins the connectivity probe. Screenshots land in test/out/p0-*.png.
//   npm run e2e:p0
import assert from 'node:assert/strict';
import { boot, newPage } from './e2e-lib.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
const b = await boot();
let failures = 0;
const results = [];
async function scenario(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
  catch (e) { failures++; results.push(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 5).join('\n      ')}`); }
}

const open = async (ctx, query = 'sim=1&fast=1') => {
  const page = await newPage(ctx, { width: 1280, height: 720 });
  await page.goto(`${b.base}/p0.html?${query}`);
  await page.waitForFunction(() => window.__p0 && window.__p0.phase === 'ready', null, { timeout: 30000 });
  return page;
};

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

await scenario('page loads, sim calibrates automatically, live view reaches "ready"', async () => {
  const page = await open(await b.browser.newContext());
  assert.equal(await page.evaluate(() => window.__p0.results.calibration.ok), true);
  assert.ok(await page.evaluate(() => window.__p0.results.calibration.validFrac) > 0.9);
  await page.screenshot({ path: OUT + 'p0-1-ready.png' });
  assert.deepEqual(page.errors, []);
});

await scenario('live view follows a virtual hand (coverage rises, falls back to zero)', async () => {
  const page = await open(await b.browser.newContext());
  await page.evaluate(() => window.__p0.editor.camera.objects.push({ kind: 'disc', x: 480, y: 200, r: 90, a: 0 }));
  await page.waitForFunction(() => window.__p0.vis.coverage > 0.03, null, { timeout: 5000 });
  await page.evaluate(() => { window.__p0.editor.camera.objects.length = 0; });
  await page.waitForFunction(() => window.__p0.vis.coverage < 0.002, null, { timeout: 5000 });
});

await scenario('latency probe really paints a black square on the wall, and white again in between', async () => {
  const page = await open(await b.browser.newContext());
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
    window.__done = false; window.__p0.runStep('latency').then(() => { window.__done = true; });
  });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  const seen = await page.evaluate(() => { clearInterval(window.__pxTimer); return window.__seen; });
  assert.ok(seen.black > 3 && seen.white > 3, JSON.stringify(seen));
  assert.ok(seen.wrongBlack <= seen.black * 0.2 && seen.wrongWhite <= seen.white * 0.2, `canvas disagreed with the probe state: ${JSON.stringify(seen)}`);
});

await scenario('guided run end to end: every step runs, phone joins the probe, report says GO', async () => {
  const ctx = await b.browser.newContext();
  const page = await open(ctx);
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
  await phone.screenshot({ path: OUT + 'p0-3-phone.png' });
  await page.screenshot({ path: OUT + 'p0-4-report.png' });

  const rep = await page.evaluate(() => ({ text: window.__p0.reportText(), r: window.__p0.results }));
  const status = (id) => (rep.text.match(new RegExp(`\\[(\\w+)\\] ${id}`)) || [])[1];
  assert.equal(status('Calibration'), 'PASS', rep.text);
  assert.equal(status('Latency'), 'PASS', rep.text);
  assert.match(rep.text, /\[PASS\] Phantom shadows: clean room/);
  assert.match(rep.text, /\[PASS\] Phantom shadows: lantern and people/);
  assert.match(rep.text, /\[PASS\] Shadow fit: ring \(r=70\)/);
  assert.match(rep.text, /\[PASS\] Shadow fit: small ring \(r=42\)/);
  assert.match(rep.text, /\[INFO\] Bodies in the beam/);
  assert.match(rep.text, /\[PASS\] Recalibration after a bump/);
  assert.match(rep.text, /\[PASS\] Connectivity/);
  assert.match(rep.text, /Overall: GO/);
  assert.match(rep.text, /SIMULATOR/);

  // measurements are plausible, not just "pass"
  assert.ok(rep.r.latency.summary.stableOnset.median < 400, `latency ${rep.r.latency.summary.stableOnset.median}`);
  assert.equal(rep.r.latency.summary.missed, 0);
  assert.equal(rep.r.ring[0].trials.every((t) => t.success), true);
  assert.ok(rep.r.beam.peakHalf[0] > 0.02 && rep.r.beam.peakHalf[1] > 0.02, JSON.stringify(rep.r.beam));
  assert.ok(rep.r.recal.ms > 0 && rep.r.recal.shiftPx < 3, JSON.stringify(rep.r.recal));
  assert.ok(rep.r.connectivity.phones === 1 && rep.r.connectivity.stalledFrac === 0, JSON.stringify(rep.r.connectivity));

  // the report overlay is visible and copy does something
  assert.equal(await page.isVisible('#p0report'), true);
  assert.match(await page.textContent('#p0report'), /Overall: GO/);
  await page.click('#rep-copy');
  await page.waitForFunction(() => document.querySelector('#rep-msg').textContent.length > 0);
  assert.deepEqual(page.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  assert.deepEqual(phone.errors, []);
});

await scenario('nobody fits the ring: the page reports FAIL / NO-GO instead of pretending', async () => {
  const page = await open(await b.browser.newContext());
  await page.evaluate(() => { window.__done = false; window.__p0.runStep('ring').then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 90000 });
  const text = await page.evaluate(() => window.__p0.reportText());
  assert.match(text, /\[FAIL\] Shadow fit: ring \(r=70\)/);
  assert.match(text, /Overall: INCOMPLETE/, 'one failing test is not a full run');
  await page.screenshot({ path: OUT + 'p0-5-fail.png' });
});

await scenario('a phantom shadow shows up in the quiet test (virtual blob appears from nowhere)', async () => {
  const page = await open(await b.browser.newContext());
  await page.evaluate(() => { window.__done = false; window.__p0.runStep('quiet').then(() => { window.__done = true; }); });
  await page.waitForFunction(() => window.__p0.activeStep && window.__p0.activeStep.constructor.name === 'QuietStep', null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__p0.editor.camera.objects.push({ kind: 'disc', x: 200, y: 300, r: 50, a: 0 }));
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__p0.editor.camera.objects.length = 0; });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const q = await page.evaluate(() => window.__p0.results.quiet[0]);
  assert.equal(q.events.length >= 1, true, JSON.stringify(q.events));
  assert.equal(q.events[0].half, 0, 'left half');
  assert.match(await page.evaluate(() => window.__p0.reportText()), /\[FAIL\] Phantom shadows: clean room/);
});

await scenario('real camera path (Chromium fake camera): errors are explained, manual corners can proceed to the tests', async () => {
  const ctx = await b.browser.newContext({ permissions: ['camera'] });
  const page = await newPage(ctx, { width: 1280, height: 720 });
  await page.goto(`${b.base}/p0.html?fast=1`);
  await page.waitForFunction(() => window.__p0);
  await page.click('#btn-cam');
  await page.waitForFunction(() => window.__p0.phase === 'aim', null, { timeout: 15000 });
  assert.ok((await page.locator('#camsel option').count()) >= 2, 'camera list populated');
  await page.screenshot({ path: OUT + 'p0-6-aim.png' });
  await page.click('#p0buttons button.primary');          // Calibrate
  await page.waitForFunction(() => window.__p0.phase === 'review', null, { timeout: 30000 });
  assert.match(await page.textContent('#p0text'), /(camera|projection|picture|bright)/i);
  await page.screenshot({ path: OUT + 'p0-7-review.png' });
  await page.click('#p0buttons button.primary');          // Looks right (manual corners)
  await page.waitForFunction(() => window.__p0.phase === 'ready');
  const cal = await page.evaluate(() => window.__p0.results.calibration);
  assert.equal(cal.manual, true);
  const info = await page.evaluate(() => ({ stats: window.__p0.camera.frameStats(), desc: window.__p0.camera.describe() }));
  assert.ok(info.desc.label.length > 0 && info.stats.supported === true, JSON.stringify(info));
  assert.deepEqual(page.errors.filter((e) => !/Failed to load resource/.test(e)), []);
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
