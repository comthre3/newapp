import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, GW, GH, CELL, ORB_R, fillRect, fillLine, fillDisc } from '../public/js/game/world.js';
import { LEVELS } from '../public/js/game/levels.js';
import { allPaletteColors, brightestChannel } from '../public/js/game/palette.js';

const byId = (id) => LEVELS.find((l) => l.id === id);

/**
 * Drive a world at 60 Hz. `ctl(world, t)` returns { nudge?, gravity?, shadow? (fn that paints the grid), switches? }.
 * Stops early when the level is cleared.
 */
function play(world, seconds, ctl = () => ({})) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds && !world.completed; t += dt) {
    const c = ctl(world, t) || {};
    world.shadow.fill(0);
    if (c.shadow) c.shadow(world.shadow, t);
    if (c.gravity) world.setGravity(c.gravity);
    world.step(dt, { nudge: c.nudge || 0 });
  }
  return world;
}

test('every palette colour keeps a channel >= 0.9 so the camera never mistakes art for a shadow', () => {
  const colors = allPaletteColors();
  assert.ok(colors.length > 15);
  for (const c of colors) {
    if (c === '#ffffff') continue;
    // textSoft / hint are only used for faint hints on a white background and are checked separately
    if (['#8fa9ff', '#a9bbff', '#b8ffd9', '#ffd1e6', '#ffb3c1'].includes(c)) {
      assert.ok(brightestChannel(c) >= 0.9, `${c} too dark`);
      continue;
    }
    assert.ok(brightestChannel(c) >= 0.9, `${c} has brightest channel ${brightestChannel(c).toFixed(2)}`);
  }
});

test('levels are well-formed', () => {
  for (const lv of LEVELS) {
    const w = new World(lv);
    const o = w.orbs[0];
    assert.ok(w.circleFree(o.x, o.y, ORB_R), `${lv.id}: spawn is inside a wall`);
    if (lv.goal) assert.ok(!w.solidAt(lv.goal[0], lv.goal[1]), `${lv.id}: goal inside a wall`);
    for (const s of lv.stars || []) assert.ok(!w.solidAt(s[0], s[1]), `${lv.id}: star inside a wall`);
    for (const g of lv.gates || []) {
      assert.ok((lv.plates || []).some((p) => p.key === g.key) || (lv.switches || []).some((s) => s.key === g.key), `${lv.id}: gate ${g.key} has no opener`);
    }
    for (const p of lv.plates || []) assert.ok(p.x - p.r >= 0 && p.x + p.r <= 960 && p.y - p.r >= 0 && p.y + p.r <= 540, `${lv.id}: plate off-screen`);
    if (!lv.sandbox) assert.ok(lv.goal, `${lv.id}: needs a goal`);
  }
});

test('an orb comes to rest on solid ground and does not jitter', () => {
  const w = new World(byId('bridge'));
  play(w, 3);
  const o = w.orbs[0];
  assert.ok(Math.abs(o.y - (210 - ORB_R)) < 1.5, `rests at y=${o.y}`);
  assert.ok(Math.hypot(o.vx, o.vy) < 25, 'at rest (sub-pixel settling only)');
  assert.equal(w.deaths, 0);
});

test('falling into the void kills the orb, which respawns', () => {
  const w = new World(byId('bridge'));
  play(w, 4, () => ({ nudge: 1 }));
  assert.ok(w.deaths >= 1);
  assert.ok(w.orbs[0].x < 800);
  const events = w.drainEvents().map((e) => e.type);
  assert.ok(events.includes('death') && events.includes('spawn'));
});

test('First Bridge: a shadow ramp carries the orb to the goal', () => {
  const w = new World(byId('bridge'));
  play(w, 25, (_, t) => ({ nudge: t < 1 ? 1 : 0, shadow: (g) => fillLine(g, 246, 210, 714, 424, 16) }));
  assert.equal(w.completed, true, 'level should be cleared');
  assert.equal(w.deaths, 0);
  assert.ok(w.clearTime < 15);
});

test('First Bridge: without a ramp it is impossible (the orb dies in the gap)', () => {
  const w = new World(byId('bridge'));
  play(w, 15, () => ({ nudge: 1 }));
  assert.equal(w.completed, false);
  assert.ok(w.deaths > 0);
});

test('a shadow dropped on top of the orb ejects it instead of trapping it', () => {
  const w = new World(byId('bridge'));
  play(w, 2);
  const o = w.orbs[0];
  const { x, y } = o;
  play(w, 1, () => ({ shadow: (g) => fillDisc(g, x, y, 40) }));
  assert.ok(!o.dead, 'not crushed');
  assert.ok(Math.hypot(o.x - x, o.y - y) > 20, 'was pushed out of the shadow');
  assert.ok(w.circleFree(o.x, o.y, ORB_R) || w.solidAt(o.x, o.y) === false);
});

test('Shadow Key: gate stays shut without a shadow on the plate, opens with one', () => {
  const lv = byId('gate');
  const closed = new World(lv);
  play(closed, 14, () => ({ nudge: 1 }));
  assert.equal(closed.completed, false);
  assert.ok(closed.orbs[0].x < 640, 'blocked by the gate');

  const open = new World(lv);
  play(open, 20, () => ({ nudge: 1, shadow: (g) => fillDisc(g, 460, 240, 30) }));
  assert.equal(open.completed, true, 'cleared with a hand on the plate');
  assert.equal(open.deaths, 0);
});

test('plate release is sticky for ~1s so a wobbling hand does not slam the gate', () => {
  const w = new World(byId('gate'));
  play(w, 0.2, () => ({ shadow: (g) => fillDisc(g, 460, 240, 30) }));
  assert.equal(w.plates[0].active, true);
  play(w, 0.5, () => ({}));
  assert.equal(w.plates[0].active, true, 'still held open');
  play(w, 1.5, () => ({}));
  assert.equal(w.plates[0].active, false);
  assert.equal(w.gates[0].open, false);
});

test('Laser Hall: lasers kill, a shadow bar across both beams switches them off', () => {
  const lv = byId('lasers');
  const burn = new World(lv);
  play(burn, 14, () => ({ nudge: 1 }));
  assert.equal(burn.completed, false);
  assert.ok(burn.deaths > 0, 'orb should hit a laser');

  const safe = new World(lv);
  play(safe, 25, () => ({ nudge: 1, shadow: (g) => fillRect(g, 380, 280, 340, 14) }));
  assert.equal(safe.completed, true);
  assert.equal(safe.deaths, 0);
});

test('Upside Down: bridge + gravity flips clear the level', () => {
  const w = new World(byId('flip'));
  let phase = 'right';
  play(w, 40, (wd) => {
    const o = wd.orbs[0];
    const shadow = (g) => fillRect(g, 410, 494, 160, 14);       // bridge over the gap
    if (phase === 'right' && o.x > 600) phase = 'up';
    if (phase === 'up' && o.y < 40 && o.x > 710) phase = 'down';
    if (phase === 'down' && o.y > 400) phase = 'finish';
    const gravity = phase === 'up' ? [0, -1] : [0, 1];
    return { nudge: 1, gravity, shadow };
  });
  assert.equal(w.completed, true, 'cleared');
  assert.ok(w.starsTaken >= 1);
});

test('Upside Down: the gap is deadly without a bridge', () => {
  const w = new World(byId('flip'));
  play(w, 10, () => ({ nudge: 1 }));
  assert.ok(w.deaths > 0);
});

test('Switchboard: needs the phone switch, the plate shadow and the laser cut', () => {
  const lv = byId('board');
  const full = new World(lv);
  play(full, 60, (wd, t) => {
    if (t > 2 && !wd.switches.A) wd.setSwitch('A', true);
    return {
      nudge: 1,
      shadow: (g) => { fillDisc(g, 540, 150, 30); fillRect(g, 770, 150, 60, 12); },
    };
  });
  assert.equal(full.completed, true);
  assert.equal(full.deaths, 0);

  const noSwitch = new World(lv);
  play(noSwitch, 15, () => ({ nudge: 1, shadow: (g) => { fillDisc(g, 540, 150, 30); fillRect(g, 770, 150, 60, 12); } }));
  assert.equal(noSwitch.completed, false);
  assert.ok(noSwitch.orbs[0].x < 380);
});

test('Shadow Lab: more orbs can be spawned up to the limit; there is no goal to clear', () => {
  const w = new World(byId('lab'));
  while (w.spawnOrb());
  assert.equal(w.orbs.length, 6);
  play(w, 10);
  assert.equal(w.completed, false);
});

test('grid helpers agree with the CELL size', () => {
  assert.equal(GW * CELL, 960);
  assert.equal(GH * CELL, 540);
  const g = new Uint8Array(GW * GH);
  fillRect(g, 0, 0, 12, 12);
  assert.equal(g.reduce((a, b) => a + b, 0), 4);
});
