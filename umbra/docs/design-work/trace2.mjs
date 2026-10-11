import { World, fillLine, GW, GH } from './world-lane.mjs';
const course = { id:'p', name:'p', spawn:[60,100], goal:[435,474,22],
  walls:[[0,130,190,16],[330,230,126,16],[240,350,120,16],[300,500,156,40]], beams:[{a:[405,400],b:[405,500]}], stars:[] };
const w = new World(course);
const ramp = new Uint8Array(GW*GH); fillLine(ramp,185,134,335,236,16);
let reachedB=false;
for (let i=0;i<60*8;i++){
  const o=w.orbs[0];
  let goX=430;
  if(o.x>340&&o.y>212&&o.y<222&&o.contact)reachedB=true;
  if(reachedB) goX = o.y<300?300:440;
  const n = Math.abs(goX-o.x)>6?Math.sign(goX-o.x):0;
  w.setShadow(reachedB?new Uint8Array(GW*GH):ramp);
  w.step(1/60,{nudge:n});
  if(i%15===0) console.log((i/60).toFixed(2), o.x.toFixed(0), o.y.toFixed(0), o.vx.toFixed(0), o.vy.toFixed(0), n, reachedB, o.dead);
}
