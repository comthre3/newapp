import { World, fillLine, fillRect, GW, GH } from './world-lane.mjs';
const course = { id:'p', name:'p', spawn:[165,100], goal:[442,474,18],
  walls:[[0,130,190,16],[370,230,86,16],[250,350,140,16],[330,500,126,40]], beams:[{a:[420,400],b:[420,500]}], stars:[] };
const w = new World(course);
const ramp = new Uint8Array(GW*GH); fillLine(ramp,185,134,375,236,16);
let reachedB=false;
for (let i=0;i<60*12;i++){
  const o=w.orbs[0];
  if(o.x>380&&o.y>212&&o.y<222&&o.contact)reachedB=true;
  let goX=430; if(reachedB) goX=o.y<300?358:445;
  const u=Math.max(-1,Math.min(1,(goX-o.x)/25-o.vx/130));
  w.setShadow(reachedB?new Uint8Array(GW*GH):ramp);
  w.step(1/60,{nudge:u});
  if(i%20===0) console.log((i/60).toFixed(2), o.x.toFixed(0), o.y.toFixed(0), o.vx.toFixed(0), o.vy.toFixed(0), u.toFixed(2), reachedB);
}
