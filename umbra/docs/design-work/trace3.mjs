import { World, GW, GH } from './world-lane.mjs';
const course = { id:'p', name:'p', spawn:[60,100], goal:[435,474,22],
  walls:[[0,130,190,16],[330,230,126,16],[240,350,120,16],[300,500,156,40]], beams:[{a:[405,400],b:[405,500]}], stars:[] };
const w = new World(course);
for (let i=0;i<60*4;i++){
  const o=w.orbs[0];
  const u = Math.max(-1, Math.min(1, (430 - o.x) / 25 - o.vx / 130));
  w.setShadow(new Uint8Array(GW*GH));
  w.step(1/60,{nudge:u});
  if(i%12===0) console.log((i/60).toFixed(2), o.x.toFixed(0), o.y.toFixed(0), o.vx.toFixed(0), o.vy.toFixed(0), u.toFixed(2), o.dead, w.completed);
}
