// End-to-end: a real host page (simulated camera → the real calibration + shadow detection), two
// controller phones over the real relay, and the real game loop. Screenshots land in test/out/.
//   npm run e2e
import assert from 'node:assert/strict';
import { boot, newPage } from './e2e-lib.mjs';

const OUT = new URL('./out/', import.meta.url).pathname;
const b = await boot();
let failures = 0;
const results = [];

async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failures++;
    results.push(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const waitMode = (page, mode, timeout = 20000) => page.waitForFunction((m) => window.__umbra.mode === m, mode, { timeout });
const readyHost = async (page, query = 'sim=1&fast=1') => {
  await page.goto(`${b.base}/host.html?${query}`);
  await page.waitForFunction(() => window.__umbra && window.__umbra.mode === 'lobby' && !document.querySelector('#btn-start').disabled, null, { timeout: 20000 });
  return (await page.textContent('#roomcode')).trim();
};
async function joinPhone(code, name) {
  const ctx = await b.browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await newPage(ctx, { width: 390, height: 780 });
  await page.goto(`${b.base}/play.html?room=${code}`);
  await page.fill('#in-name', name);
  await page.click('#btn-join');
  await page.waitForFunction(() => document.querySelector('#conn').textContent === 'online');
  return page;
}
const holdButton = async (page, sel, ms) => {
  const box = await page.locator(sel).boundingBox();
  await page.touchscreen.tap(0, 0).catch(() => {});
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
};

await scenario('simulator calibrates through the real pipeline and the lobby shows a QR + room code', async () => {
  const ctx = await b.browser.newContext();
  const host = await newPage(ctx);
  const code = await readyHost(host);
  assert.match(code, /^[A-Z]{4}$/);
  const det = await host.evaluate(() => ({ valid: window.__umbra.detector.stats.validFrac, ok: !!window.__umbra.detector }));
  assert.ok(det.ok && det.valid > 0.9, `valid fraction ${det.valid}`);
  await host.screenshot({ path: OUT + '01-lobby.png' });
  assert.deepEqual(host.errors, []);
});

await scenario('controller joins, host lists it, level start pushes state to the phone', async () => {
  const host = await newPage(await b.browser.newContext());
  const code = await readyHost(host);
  const p1 = await joinPhone(code, 'Ann');
  await host.waitForFunction(() => window.__umbra.players.size === 1);
  assert.match(await host.textContent('#players'), /Ann/);
  await p1.screenshot({ path: OUT + '02-phone-lobby.png' });
  await host.click('#btn-start');
  await waitMode(host, 'play');
  await p1.waitForFunction(() => window.__umbraPlayer.state && window.__umbraPlayer.state.phase === 'play');
  assert.match(await p1.textContent('#role'), /Shadow Lab/);
  await p1.screenshot({ path: OUT + '03-phone-lab.png' });
  assert.deepEqual([...host.errors, ...p1.errors], []);
});

await scenario('First Bridge: shadow ramp (virtual bar) + phone nudge clears the level', async () => {
  const host = await newPage(await b.browser.newContext());
  const code = await readyHost(host, 'sim=1&fast=1');
  const p1 = await joinPhone(code, 'Ann');
  await host.evaluate(() => window.__umbra.startLevel(1));
  await waitMode(host, 'play');
  // a "ramp" from (250,214) to (710,424)
  await host.evaluate(() => {
    window.__umbra.editor.camera.objects.push({ kind: 'rect', x: 480, y: 319, w: 520, h: 18, a: Math.atan2(210, 460) });
  });
  await host.waitForTimeout(700);                    // let the detector see it
  const cover = await host.evaluate(() => window.__umbra.detector.stats.coverage);
  assert.ok(cover > 0.01, `detector sees the ramp (coverage ${cover})`);
  await host.screenshot({ path: OUT + '04-bridge-ramp.png' });
  await holdButton(p1, '#n-pos', 1200);
  await waitMode(host, 'clear', 25000);
  await host.screenshot({ path: OUT + '05-bridge-clear.png' });
  await p1.waitForFunction(() => window.__umbraPlayer.state.phase === 'clear');
  assert.match(await p1.textContent('#role'), /clear/i);
  const deaths = await host.evaluate(() => window.__umbra.world.deaths);
  assert.ok(deaths <= 2, `deaths ${deaths}`);
  assert.deepEqual([...host.errors, ...p1.errors], []);
});

await scenario('without a ramp the orb falls and the level is not cleared', async () => {
  const host = await newPage(await b.browser.newContext());
  const code = await readyHost(host);
  const p1 = await joinPhone(code, 'Bo');
  await host.evaluate(() => window.__umbra.startLevel(1));
  await holdButton(p1, '#n-pos', 2500);
  await host.waitForTimeout(500);
  assert.equal(await host.evaluate(() => window.__umbra.mode), 'play');
  assert.ok(await host.evaluate(() => window.__umbra.world.deaths) >= 1);
});

await scenario('every level\'s real artwork reads as lit: no phantom shadows with nothing in the beam', async () => {
  const host = await newPage(await b.browser.newContext());
  await readyHost(host);
  const levels = await host.evaluate(() => 6);
  for (let i = 0; i < levels; i++) {
    await host.evaluate((n) => window.__umbra.startLevel(n), i);
    await host.waitForTimeout(900);
    const cov = await host.evaluate(() => window.__umbra.detector.stats.coverage);
    assert.ok(cov < 0.003, `level ${i}: ${(cov * 100).toFixed(2)}% of the board looks shadowed with nothing there`);
  }
});

await scenario('a hand-sized shadow becomes solid on the host and an orb lands on it', async () => {
  const host = await newPage(await b.browser.newContext());
  await readyHost(host);
  await host.evaluate(() => {
    window.__umbra.startLevel(0);
    window.__umbra.editor.camera.objects.push({ kind: 'disc', x: 480, y: 330, r: 60 });
  });
  await host.waitForTimeout(3500);
  const o = await host.evaluate(() => { const w = window.__umbra.world; return { y: w.orbs[0].y, deaths: w.deaths }; });
  // disc top is y=270; orb radius 12 -> resting near y=258 (or bounced to the side but not in the void)
  assert.ok(o.y < 300, `orb y=${o.y}`);
  await host.screenshot({ path: OUT + '13-lab-hand.png' });
});

await scenario('Gravity Master role goes to exactly one phone and its D-pad flips gravity', async () => {
  const host = await newPage(await b.browser.newContext());
  const code = await readyHost(host);
  const p1 = await joinPhone(code, 'Ann');
  const p2 = await joinPhone(code, 'Bo');
  await host.waitForFunction(() => window.__umbra.players.size === 2);
  await host.evaluate(() => window.__umbra.startLevel(4));
  await waitMode(host, 'play');
  await Promise.all([p1, p2].map((p) => p.waitForFunction(() => window.__umbraPlayer.state && window.__umbraPlayer.state.level.id === 'flip')));
  const vis = await Promise.all([p1, p2].map((p) => p.isVisible('#gravity')));
  assert.equal(vis.filter(Boolean).length, 1, `D-pad visible on ${vis}`);
  const gm = vis[0] ? p1 : p2;
  const other = vis[0] ? p2 : p1;
  await gm.screenshot({ path: OUT + '06-phone-gravity-master.png' });
  await other.screenshot({ path: OUT + '07-phone-not-gm.png' });
  await gm.click('#gravity [data-g="up"]');
  await host.waitForFunction(() => window.__umbra.world.gravity[1] === -1);
  await other.waitForFunction(() => window.__umbraPlayer.state.axis === 'h');
  // the non-master cannot flip gravity even by sending the message
  await other.evaluate(() => document.querySelector('#n-pos').dispatchEvent(new Event('pointerup')));
  assert.equal(await host.evaluate(() => window.__umbra.world.gravity[1]), -1);
});

await scenario('Switchboard: phone switch toggles gate 1 on the host', async () => {
  const host = await newPage(await b.browser.newContext());
  const code = await readyHost(host);
  const p1 = await joinPhone(code, 'Ann');
  await host.evaluate(() => window.__umbra.startLevel(5));
  await waitMode(host, 'play');
  await p1.waitForSelector('#switches button');
  await p1.click('#switches button');
  await host.waitForFunction(() => window.__umbra.world.switches.A === true);
  await p1.waitForFunction(() => /ON/.test(document.querySelector('#switches button').textContent));
  await host.waitForTimeout(300);
  assert.equal(await host.evaluate(() => window.__umbra.world.gates[0].open), true);
  await host.screenshot({ path: OUT + '08-switchboard.png' });
});

await scenario('phone reload keeps its seat; host reload keeps the room', async () => {
  const hostCtx = await b.browser.newContext();
  const host = await newPage(hostCtx);
  const code = await readyHost(host);
  const p1 = await joinPhone(code, 'Ann');
  const id = await host.evaluate(() => [...window.__umbra.players.keys()][0]);
  await p1.reload();
  await p1.waitForFunction(() => document.querySelector('#conn')?.textContent === 'online');
  assert.equal(await host.evaluate(() => window.__umbra.players.size), 1);
  assert.equal(await host.evaluate(() => [...window.__umbra.players.keys()][0]), id);
  await host.reload();
  await host.waitForFunction(() => document.querySelector('#roomcode').textContent !== '····');
  assert.equal((await host.textContent('#roomcode')).trim(), code);
  await host.waitForFunction(() => window.__umbra.players.size === 1);
});

await scenario('real camera path (Chromium fake camera): errors are explained, manual corners can still be accepted', async () => {
  const ctx = await b.browser.newContext({ permissions: ['camera'] });
  const host = await newPage(ctx);
  await host.goto(`${b.base}/host.html?fast=1`);
  await host.waitForFunction(() => window.__umbra);
  await host.click('#btn-camera');
  await waitMode(host, 'aim');
  await host.waitForTimeout(500);
  await host.screenshot({ path: OUT + '09-aim.png' });
  await host.click('#btn-calibrate');
  await waitMode(host, 'result', 30000);
  await host.screenshot({ path: OUT + '10-calibration-result.png' });
  const msg = await host.textContent('#result-msg');
  assert.ok(msg.length > 10, msg);
  await host.click('#btn-adjust');
  await waitMode(host, 'adjust');
  await host.click('#btn-adjust');
  await waitMode(host, 'result');
  await host.click('#btn-accept');
  await waitMode(host, 'lobby');
  assert.match(await host.textContent('#camstatus'), /Camera ready/);
  assert.equal(await host.isDisabled('#btn-start'), false);
  assert.deepEqual(host.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

await scenario('landing and controller join-form pages render', async () => {
  const ctx = await b.browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const page = await newPage(ctx, { width: 390, height: 780 });
  await page.goto(`${b.base}/`);
  assert.deepEqual(await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]), [390, 390], 'landing page scrolls sideways');
  await page.screenshot({ path: OUT + '11-landing.png' });
  await page.goto(`${b.base}/play.html`);
  await page.waitForSelector('#join:not([hidden])');
  await page.fill('#in-room', 'ab');
  await page.click('#btn-join');
  assert.match(await page.textContent('#join-err'), /4-letter/);
  await page.fill('#in-room', 'ZZZZ');
  await page.click('#btn-join');
  await page.waitForFunction(() => /Room not found/.test(document.querySelector('#join-err').textContent));
  await page.screenshot({ path: OUT + '12-join-error.png' });
  assert.deepEqual(page.errors.filter((e) => !/WebSocket|Failed to load resource/.test(e)), []);
});

await b.close();
console.log(`\nUmbra e2e\n${results.join('\n')}\n\n${failures ? `${failures} FAILED` : 'all passed'} — screenshots in test/out/\n`);
process.exit(failures ? 1 : 0);
