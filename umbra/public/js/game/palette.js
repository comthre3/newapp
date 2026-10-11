// Projector-safe palette.
//
// Dark ink on a projector is just "no light", which the camera reads as a shadow. So everything the
// game draws must keep at least one colour channel at (nearly) full intensity. The test-suite
// enforces this for every entry (see test/world.test.js).

export const PAL = {
  bg: '#ffffff',
  wall: '#3d6bff',
  wallHi: '#8fa9ff',
  orb: '#ff2f92',
  orbHi: '#ffd1e6',
  goal: '#00e676',
  goalSoft: '#b8ffd9',
  star: '#ff9f0a',
  spike: '#ff3b30',
  beam: '#ff2d55',
  beamOff: '#ffb3c1',
  text: '#2f5bff',
  textSoft: '#8fa9ff',
  hint: '#a9bbff',
  keys: {
    A: '#a855ff',
    B: '#ff8a00',
    C: '#00ecd8',
    D: '#ff2f92',
  },
  fx: ['#ff2f92', '#ff9f0a', '#00e676', '#3d6bff', '#a855ff', '#00ecd8'],
};

/** Highest channel of a #rrggbb colour as 0..1. */
export function brightestChannel(hex) {
  const n = parseInt(hex.slice(1), 16);
  return Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255) / 255;
}

export function allPaletteColors() {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(PAL);
  return out;
}
