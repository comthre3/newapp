// Shared helpers for the browser tests: start the server on a free port and launch Chromium.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createUmbraServer } from '../server.js';

export function chromePath() {
  for (const p of ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH]) {
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return undefined; // let playwright find its own
}

export async function boot() {
  const app = createUmbraServer();
  const port = await app.listen(0, '127.0.0.1');
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  return { app, port, base: `http://127.0.0.1:${port}`, browser, async close() { await browser.close(); await app.close(); } };
}

/** New page that records console errors / page errors. */
export async function newPage(context, { width = 1280, height = 720 } = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  return page;
}
