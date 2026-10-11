// Throwaway prototype: can a silhouette matcher on the existing 160x90 shadow bit-grid be
// (a) invariant to shift/scale/small rotation/mirror, (b) cheap enough to run every frame?
// Shapes here are SYNTHETIC polygons, NOT real hand shadows. This tests the pipeline, not the animals.
const GW = 160, GH = 90, N = 48; // detector grid, canonical frame size

function rasterPoly(poly, gw = GW, gh = GH) {
  const m = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y + .5) !== (yj > y + .5) && x + .5 < ((xj - xi) * (y + .5 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    m[y * gw + x] = inside ? 1 : 0;
  }
  return m;
}
const xf = (poly, { s = 1, rot = 0, dx = 0, dy = 0, mirror = false }) => {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return poly.map(([x, y]) => { x = mirror ? -x : x; return [(x * c - y * sn) * s + dx, (x * sn + y * c) * s + dy]; });
};
// base shapes in a +-1 box: body + feature(s)
const body = [[-.5,.9],[-.5,-.1],[.5,-.1],[.5,.9]];
const SHAPES = {
  rabbit: [[-.45,.9],[-.45,.0],[-.35,-.9],[-.2,-.9],[-.15,-.05],[.15,-.05],[.2,-.9],[.35,-.9],[.45,.0],[.45,.9]],       // two tall ears
  bird:   [[-.9,.5],[-.5,-.5],[0,.1],[.5,-.5],[.9,.5],[.3,.3],[-.3,.3]],                                                // wings
  camel:  [[-.9,.9],[-.9,.1],[-.5,.1],[-.35,-.5],[-.1,-.5],[0,.1],[.2,.1],[.35,-.9],[.55,-.9],[.6,-.5],[.5,.1],[.5,.9]], // hump + neck
  swan:   [[-.6,.9],[-.6,.3],[-.2,.1],[.1,-.4],[.1,-.9],[.3,-.9],[.3,-.3],[.5,.2],[.6,.9]],                              // neck curve
  gazelle:[[-.5,.9],[-.5,-.1],[-.4,-.9],[-.25,-.4],[-.1,-.1],[.1,-.1],[.25,-.4],[.4,-.9],[.5,-.1],[.5,.9]],             // two horns (rabbit look-alike)
  fox:    [[-.5,.9],[-.5,.0],[-.4,-.7],[-.2,-.1],[.2,-.1],[.4,-.7],[.5,.0],[.5,.9]],                                    // short ears (rabbit look-alike)
};

function stats(m, gw = GW, gh = GH) {
  let a = 0, cx = 0, cy = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (m[y * gw + x]) { a++; cx += x; cy += y; }
  return { a, cx: cx / (a || 1), cy: cy / (a || 1) };
}
// Resample a mask into the canonical NxN frame: centre on centroid, scale so area is constant, rotate, optionally mirror.
function canon(m, rot = 0, mirror = false, gw = GW, gh = GH) {
  const { a, cx, cy } = stats(m, gw, gh);
  const out = new Uint8Array(N * N);
  if (a < 20) return out;
  const s = Math.sqrt(a) / (N * 0.40);           // grid-cells per canonical-cell (shape side ~ 0.4*N... area-normalised)
  const c = Math.cos(rot), sn = Math.sin(rot);
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    let x = (u - N / 2) * s, y = (v - N / 2) * s;
    if (mirror) x = -x;
    const gx = Math.round(cx + x * c - y * sn), gy = Math.round(cy + x * sn + y * c);
    if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) out[v * N + u] = m[gy * gw + gx];
  }
  return out;
}
// chamfer-ish tolerance: dilate by r (cheap box dilation)
function dilate(m, r) {
  const o = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let hit = 0;
    for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && m[yy * N + xx]) { hit = 1; break; }
    }
    o[y * N + x] = hit;
  }
  return o;
}
// Forgiving score: share of player pixels that are inside dilated template AND share of template covered by dilated player; take the lower.
function score(P, T, Td, Pd) {
  let p = 0, t = 0, pin = 0, tin = 0;
  for (let i = 0; i < N * N; i++) {
    if (P[i]) { p++; if (Td[i]) pin++; }
    if (T[i]) { t++; if (Pd[i]) tin++; }
  }
  return p && t ? Math.min(pin / p, tin / t) : 0;
}
function iou(P, T) { let i = 0, u = 0; for (let k = 0; k < N * N; k++) { const a = P[k], b = T[k]; if (a && b) i++; if (a || b) u++; } return u ? i / u : 0; }
// tolerant IoU: a mismatched cell only counts if it is NOT within 1 cell of the other shape (forgives boundary jitter, not missing ears)
function tiou(P, T, Td, Pd) { let i = 0, u = 0; for (let k = 0; k < N * N; k++) { const a = P[k], b = T[k]; if (a && b) { i++; u++; } else if (a && !Td[k]) u++; else if (b && !Pd[k]) u++; } return u ? i / u : 0; }
const MODE = process.argv[2] || 'contain';
const ROTS = [-.5, -.35, -.17, 0, .17, .35, .5];
function matchOne(playerMask, tmpl) {
  let best = 0;
  for (const mir of [false, true]) for (const r of ROTS) {
    const P = canon(playerMask, r, mir);
    const s = MODE === 'iou' ? iou(P, tmpl.T) : MODE === 'tiou' ? tiou(P, tmpl.T, tmpl.Td, dilate(P, 1)) : score(P, tmpl.T, tmpl.Td, dilate(P, 1));
    if (s > best) best = s;
  }
  return best;
}
function makeTemplate(poly) {
  const m = rasterPoly(xf(poly, { s: 28, dx: 80, dy: 45 }));
  const T = canon(m); return { T, Td: dilate(T, 1) };
}

const T = Object.fromEntries(Object.entries(SHAPES).map(([k, p]) => [k, makeTemplate(p)]));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
function noisy(m) { // flip boundary cells randomly ~ detector noise
  const o = m.slice();
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const k = y * GW + x, nb = m[k - 1] + m[k + 1] + m[k - GW] + m[k + GW];
    if (m[k] !== (nb >= 2 ? 1 : 0) && rnd() < .5) o[k] = 1 - m[k];
    else if (nb > 0 && nb < 4 && rnd() < .12) o[k] = 1 - m[k];
  }
  return o;
}
const names = Object.keys(SHAPES);
const trials = 40;
const rows = [];
for (const truth of names) {
  const same = [], other = {};
  for (let i = 0; i < trials; i++) {
    const tf = { s: 18 + rnd() * 22, rot: (rnd() - .5) * .5, dx: 55 + rnd() * 50, dy: 35 + rnd() * 20, mirror: rnd() < .5 };
    const m = noisy(rasterPoly(xf(SHAPES[truth], tf)));
    same.push(matchOne(m, T[truth]));
    for (const o of names) if (o !== truth) (other[o] ||= []).push(matchOne(m, T[o]));
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const worstOther = Object.entries(other).map(([k, v]) => [k, avg(v)]).sort((a, b) => b[1] - a[1])[0];
  rows.push({ truth, selfMean: avg(same).toFixed(2), selfMin: Math.min(...same).toFixed(2), closestImpostor: worstOther[0], impostorMean: worstOther[1].toFixed(2) });
}
console.table(rows);

// timing: 20 templates, per frame
const bigSet = Array.from({ length: 20 }, (_, i) => T[names[i % names.length]]);
const pm = rasterPoly(xf(SHAPES.camel, { s: 30, dx: 80, dy: 45 }));
const t0 = performance.now(); const frames = 30;
for (let f = 0; f < frames; f++) for (const t of bigSet) matchOne(pm, t);
console.log(`classify against 20 templates (7 rot x 2 mirror): ${((performance.now() - t0) / frames).toFixed(1)} ms/frame (node, unoptimised, canon recomputed per template)`);
const t1 = performance.now();
for (let f = 0; f < 200; f++) matchOne(pm, bigSet[0]);
console.log(`verify one target: ${((performance.now() - t1) / 200).toFixed(2)} ms/frame`);
