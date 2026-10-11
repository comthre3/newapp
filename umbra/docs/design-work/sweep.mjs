// Which gaps can the lantern JUMP with no shadow at all (full nudge, 100 px drop)? => where a shadow bridge is really needed.
import { World, GW, GH } from './world-lane.mjs';
const edge = 190;
console.log('gap(px) -> lands on far ledge without any shadow? (run-up 0 / 20 / 40 / 80 px)');
for (const gap of [60, 80, 100, 120, 140, 160, 180, 200]) {
  const row = [];
  for (const run of [0, 20, 40, 80]) {
    const farX = edge + gap;
    const lv = { id: 's', name: 's', spawn: [edge - run, 100], goal: null,
      walls: [[0, 130, edge, 16], [farX, 230, 456 - farX, 16]], stars: [] };
    const w = new World(lv);
    let landed = false;
    for (let i = 0; i < 60 * 4 && !landed; i++) {
      const o = w.orbs[0];
      w.setShadow(new Uint8Array(GW * GH));
      w.step(1 / 60, { nudge: 1 });
      if (o.contact && o.y > 210 && o.y < 225 && o.x > farX) landed = true;
      if (o.dead) break;
    }
    row.push(landed ? 'JUMPS' : 'needs');
  }
  console.log(String(gap).padStart(4), row.join('  '));
}
