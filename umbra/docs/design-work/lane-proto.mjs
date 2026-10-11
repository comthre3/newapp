// Prototype: run the EXISTING World physics at lane size (456 x 540 = half of the 960 board) and check that
//  - a 180 px gap cannot be jumped (needs a shadow bridge/ramp),
//  - a laser needs a shadow shield,
//  - the mirrored copy of the course (x -> 456 - x, inputs mirrored) behaves identically (fair lanes).
import { World, fillLine, fillRect, GW, GH, W, H } from './world-lane.mjs';

const mx = (x) => W - x;
const mirrorLevel = (l) => ({
  ...l,
  spawn: [mx(l.spawn[0]), l.spawn[1]],
  goal: [mx(l.goal[0]), l.goal[1], l.goal[2]],
  walls: l.walls.map(([x, y, w, h]) => [W - x - w, y, w, h]),
  beams: l.beams.map((b) => ({ a: [mx(b.a[0]), b.a[1]], b: [mx(b.b[0]), b.b[1]] })),
});

const course = {
  id: 'proto', name: 'proto',
  spawn: [165, 100],
  goal: [442, 474, 18],
  walls: [
    [0, 130, 190, 16],     // ledge A (start, short run-up)
    [370, 230, 86, 16],    // ledge B (gap of 180 px from A)
    [250, 350, 140, 16],   // ledge C
    [330, 500, 126, 40],   // floor D (oasis)
  ],
  beams: [{ a: [420, 400], b: [420, 500] }],
  stars: [],
};

function run(level, { ramp, shield, mirror = false }) {
  const world = new World(level);
  const dt = 1 / 60;
  const fx = (x) => (mirror ? mx(x) : x);
  const rampMask = new Uint8Array(GW * GH); fillLine(rampMask, fx(180), 138, fx(375), 240, 16);
  const shieldMask = new Uint8Array(GW * GH);
  fillRect(shieldMask, mirror ? W - 400 - 40 : 400, 420, 40, 60);
  let t = 0, falls = 0, lastDead = false, reachedB = false;
  while (!world.completed && t < 60) {
    const o = world.orbs[0];
    let nudge = 0;
    if (o && !o.dead) {
      const ox = mirror ? mx(o.x) : o.x;               // pilot reasons in "left-lane" coordinates
      const ovx = mirror ? -o.vx : o.vx;
      if (ox > 380 && o.y > 212 && o.y < 222 && o.contact) reachedB = true;
      let goX = 430;
      if (reachedB) goX = o.y < 300 ? 358 : 445;
      const u = Math.max(-1, Math.min(1, (goX - ox) / 25 - ovx / 130));
      nudge = mirror ? -u : u;
    }
    const m = new Uint8Array(GW * GH);
    if (ramp && !reachedB) m.set(rampMask);            // casters drop the ramp once the lantern is across
    if (shield && o && o.y > 340) for (let i = 0; i < m.length; i++) m[i] |= shieldMask[i];
    world.setShadow(m);
    world.step(dt, { nudge });
    const dead = o && o.dead;
    if (dead && !lastDead) { falls++; }
    lastDead = dead;
    t += dt;
  }
  return { done: world.completed, t: +t.toFixed(2), falls };
}

const L = course, R = mirrorLevel(course);
console.log('lane world', W, 'x', H, '=', GW, 'x', GH, 'cells');
console.log('no shadows         :', run(L, {}));
console.log('ramp only          :', run(L, { ramp: true }));
console.log('ramp + shield      :', run(L, { ramp: true, shield: true }));
console.log('MIRRORED lane      :', run(R, { ramp: true, shield: true, mirror: true }));
console.log('--- symmetry check (ramp only) ---');
console.log('left lane  :', run(L, { ramp: true }));
console.log('right lane :', run(R, { ramp: true, mirror: true }));
