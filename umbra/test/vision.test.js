import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveHomography, invertH, applyH, UNIT_SQUARE, analyzeCalibration, averageFrames } from '../public/js/core/vision-core.js';
import { createSimCamera, DEFAULT_QUAD } from '../public/js/core/sim-core.js';
import { PW, PH, GW, GH, flat, gameLike, truthMask, iou, calibrate, makeDetector, detectStable } from './helpers.js';

test('homography maps the corners it was solved for and inverts cleanly', () => {
  const dst = [[100, 50], [500, 80], [540, 330], [60, 300]];
  const H = solveHomography(UNIT_SQUARE, dst);
  UNIT_SQUARE.forEach((p, i) => {
    const [x, y] = applyH(H, p[0], p[1]);
    assert.ok(Math.hypot(x - dst[i][0], y - dst[i][1]) < 1e-6);
  });
  const Hi = invertH(H);
  const [u, v] = applyH(Hi, ...applyH(H, 0.3, 0.7));
  assert.ok(Math.abs(u - 0.3) < 1e-9 && Math.abs(v - 0.7) < 1e-9);
});

test('calibration finds the projection corners within 3 px (noise + vignette + ambient light)', () => {
  const cam = createSimCamera({ ambient: 0.08, noise: 0.006 });
  const cal = calibrate(cam);
  assert.equal(cal.result.ok, true, cal.result.error);
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const err = Math.hypot(cal.result.corners[k][0] - cam.cornersPx[k][0], cal.result.corners[k][1] - cam.cornersPx[k][1]);
    assert.ok(err < 3, `${k} corner off by ${err.toFixed(2)}px`);
  }
});

test('calibration reports actionable errors', () => {
  const cam = createSimCamera({ ambient: 0.05 });
  const fr = (img, gain) => averageFrames([cam.render(img, PW, PH, null, new Uint8ClampedArray(cam.cw * cam.ch * 4), gain)], cam.cw, cam.ch);
  // projector off: black == white
  const dead = analyzeCalibration(fr(flat(0, 0, 0), 1), fr(flat(0, 0, 0), 1), cam.cw, cam.ch);
  assert.equal(dead.error, 'low-contrast');
  // camera sees only a corner of the picture
  const big = createSimCamera({ quad: { tl: [-0.3, -0.3], tr: [0.7, -0.2], br: [0.75, 0.7], bl: [-0.25, 0.75] } });
  const f2 = (img) => averageFrames([big.render(img, PW, PH, null, new Uint8ClampedArray(big.cw * big.ch * 4), 1)], big.cw, big.ch);
  assert.equal(analyzeCalibration(f2(flat(0, 0, 0)), f2(flat(255, 255, 255)), big.cw, big.ch).error, 'cut-off');
  // projection is a speck in the corner
  const tiny = createSimCamera({ quad: { tl: [0.05, 0.05], tr: [0.2, 0.05], br: [0.2, 0.2], bl: [0.05, 0.2] } });
  const f3 = (img) => averageFrames([tiny.render(img, PW, PH, null, new Uint8ClampedArray(tiny.cw * tiny.ch * 4), 1)], tiny.cw, tiny.ch);
  assert.equal(analyzeCalibration(f3(flat(0, 0, 0)), f3(flat(255, 255, 255)), tiny.cw, tiny.ch).error, 'too-small');
});

const SHAPES = {
  hand: [{ kind: 'disc', x: 160, y: 90, r: 22 }],
  ramp: [{ kind: 'rect', x: 150, y: 80, w: 130, h: 10, a: 0.4 }],
  two: [{ kind: 'disc', x: 60, y: 50, r: 16 }, { kind: 'rect', x: 240, y: 120, w: 40, h: 26, a: -0.3 }],
};

for (const [name, shapes] of Object.entries(SHAPES)) {
  test(`detector recovers a '${name}' shadow (IoU >= 0.8) over a game-like image`, () => {
    const cam = createSimCamera({ ambient: 0.06 });
    const cal = calibrate(cam);
    const det = makeDetector(cam, cal);
    const m = detectStable(cam, det, gameLike(), shapes);
    const score = iou(m, truthMask(shapes));
    assert.ok(score >= 0.8, `IoU ${score.toFixed(3)}`);
  });
}

test('no phantom shadows on an empty, game-like scene (coloured game art reads as lit)', () => {
  const cam = createSimCamera({ ambient: 0.06 });
  const det = makeDetector(cam, calibrate(cam));
  const m = detectStable(cam, det, gameLike(), []);
  const n = m.reduce((a, b) => a + b, 0);
  assert.ok(n < GW * GH * 0.002, `${n} false cells`);
});

test('survives bright rooms (ambient 0.25) with weaker contrast', () => {
  const cam = createSimCamera({ ambient: 0.25, noise: 0.008 });
  const cal = calibrate(cam);
  assert.equal(cal.result.ok, true);
  const det = makeDetector(cam, cal);
  const m = detectStable(cam, det, gameLike(), SHAPES.hand);
  assert.ok(iou(m, truthMask(SHAPES.hand)) >= 0.75);
});

test('auto-exposure drift is compensated', () => {
  const cam = createSimCamera({ ambient: 0.06 });
  const det = makeDetector(cam, calibrate(cam));
  for (const gain of [0.8, 1.25]) {
    const m = detectStable(cam, det, gameLike(), SHAPES.ramp, { frames: 14, gain });
    const s = iou(m, truthMask(SHAPES.ramp));
    assert.ok(s >= 0.7, `gain ${gain}: IoU ${s.toFixed(3)}`);
  }
});

test('shadows appear and disappear within a few frames and hysteresis stops flicker', () => {
  const cam = createSimCamera();
  const det = makeDetector(cam, calibrate(cam));
  const img = gameLike();
  detectStable(cam, det, img, [], { frames: 3 });
  const on = detectStable(cam, det, img, SHAPES.hand, { frames: 3 });
  assert.ok(iou(on, truthMask(SHAPES.hand)) > 0.8, 'shadow should be present after 3 frames');
  const off = detectStable(cam, det, img, [], { frames: 3 });
  assert.ok(off.reduce((a, b) => a + b, 0) < 20, 'shadow should be gone after 3 frames');
});

test('ignore rectangles suppress shadows (used under on-screen debug panels)', () => {
  const cam = createSimCamera();
  const det = makeDetector(cam, calibrate(cam));
  det.setIgnore([{ x: 60, y: 30, w: 40, h: 30 }]);
  const m = detectStable(cam, det, gameLike(), SHAPES.hand);
  let inside = 0;
  for (let j = 30; j < 60; j++) for (let i = 60; i < 100; i++) inside += m[j * GW + i];
  assert.equal(inside, 0);
});

test('a letter-boxed view maps only the world rectangle', () => {
  const cam = createSimCamera();
  const cal = calibrate(cam);
  // world occupies the centre 50% of the width of the projector image
  const det = makeDetector(cam, cal, { view: { x: 0.25, y: 0, w: 0.5, h: 1 } });
  // a disc at projector x=160 (centre) → grid centre
  const m = detectStable(cam, det, gameLike(), [{ kind: 'disc', x: 160, y: 90, r: 20 }]);
  let cx = 0, cy = 0, c = 0;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (m[j * GW + i]) { cx += i; cy += j; c++; }
  assert.ok(c > 20);
  assert.ok(Math.abs(cx / c - GW / 2) < 3 && Math.abs(cy / c - GH / 2) < 3);
  // the view is half as wide as it is tall in projector px, so the disc stretches to a 20 x 10 cell
  // ellipse: area = pi*20*10, i.e. equivalent radius sqrt(200)
  assert.ok(Math.abs(Math.sqrt(c / Math.PI) - Math.sqrt(200)) < 1.5, `radius ${Math.sqrt(c / Math.PI)}`);
});

test('DEFAULT_QUAD is a sane keystone (guards the sim defaults)', () => {
  assert.ok(DEFAULT_QUAD.tl[0] < DEFAULT_QUAD.tr[0] && DEFAULT_QUAD.tl[1] < DEFAULT_QUAD.bl[1]);
});
