// Shared test fixtures: a fake projector image, virtual shadow objects and a ground-truth mask.
import { createSimCamera } from '../public/js/core/sim-core.js';
import { averageFrames, analyzeCalibration, ShadowDetector } from '../public/js/core/vision-core.js';

export const PW = 320, PH = 180;      // projector snapshot size
export const GW = 160, GH = 90;       // mask grid

export function flat(r, g, b) {
  const a = new Uint8ClampedArray(PW * PH * 4);
  for (let i = 0; i < PW * PH; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; }
  return a;
}

/** A game-like image: white with a blue wall, a green ring, a magenta orb, a red hazard. */
export function gameLike() {
  const a = flat(255, 255, 255);
  const fill = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * PW + x) * 4; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2];
    }
  };
  fill(0, 70, 90, 8, [60, 110, 255]);
  fill(230, 140, 90, 8, [60, 110, 255]);
  fill(250, 100, 20, 20, [0, 200, 100]);
  fill(40, 40, 8, 8, [255, 60, 150]);
  fill(150, 160, 30, 6, [255, 60, 50]);
  return a;
}

/** Shape → coverage 0..1 at a point in unit projector space (soft 1.5px edge). */
export function shapeCoverage(shape, ux, uy) {
  const x = ux * PW, y = uy * PH;
  let d;
  if (shape.kind === 'disc') {
    d = Math.hypot(x - shape.x, y - shape.y) - shape.r;
  } else {
    const c = Math.cos(-shape.a || 0), s = Math.sin(-shape.a || 0);
    const dx = x - shape.x, dy = y - shape.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    d = Math.max(Math.abs(lx) - shape.w / 2, Math.abs(ly) - shape.h / 2);
  }
  return d <= -0.75 ? 1 : d >= 0.75 ? 0 : 0.5 - d / 1.5;
}

export function objectAlpha(shapes) {
  const a = new Uint8Array(PW * PH);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    let cov = 0;
    for (const s of shapes) cov = Math.max(cov, shapeCoverage(s, (x + 0.5) / PW, (y + 0.5) / PH));
    a[y * PW + x] = Math.round(cov * 255);
  }
  return a;
}

export function truthMask(shapes) {
  const m = new Uint8Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    let cov = 0;
    for (const s of shapes) cov = Math.max(cov, shapeCoverage(s, (i + 0.5) / GW, (j + 0.5) / GH));
    m[j * GW + i] = cov >= 0.5 ? 1 : 0;
  }
  return m;
}

export function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { inter += a[i] & b[i]; uni += a[i] | b[i]; }
  return uni === 0 ? 1 : inter / uni;
}

export function calibrate(cam, { frames = 6, gain = 1 } = {}) {
  const grab = (img) => {
    const fs = [];
    for (let i = 0; i < frames; i++) fs.push(cam.render(img, PW, PH, null, new Uint8ClampedArray(cam.cw * cam.ch * 4), gain));
    return averageFrames(fs, cam.cw, cam.ch);
  };
  const black = grab(flat(0, 0, 0));
  const white = grab(flat(255, 255, 255));
  const result = analyzeCalibration(black, white, cam.cw, cam.ch);
  return { black, white, result };
}

export function makeDetector(cam, cal, opts = {}) {
  return new ShadowDetector({ gw: GW, gh: GH, cw: cam.cw, ch: cam.ch, corners: cal.result.corners, black: cal.black, white: cal.white, ...opts });
}

/** Run the detector for a few frames (it needs 2 to flip a cell) and return the mask. */
export function detectStable(cam, det, img, shapes, { frames = 4, gain = 1 } = {}) {
  const alpha = shapes.length ? objectAlpha(shapes) : null;
  const buf = new Uint8ClampedArray(cam.cw * cam.ch * 4);
  let m;
  for (let i = 0; i < frames; i++) m = det.detect(cam.render(img, PW, PH, alpha, buf, gain));
  return m;
}
