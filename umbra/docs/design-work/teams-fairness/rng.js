'use strict';
// Small seeded PRNG so every simulation number is reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let x = 0; while (x === 0) x = u();
    const y = u();
    const r = Math.sqrt(-2 * Math.log(x));
    spare = r * Math.sin(2 * Math.PI * y);
    return r * Math.cos(2 * Math.PI * y);
  };
  return {
    u, normal,
    int: (n) => Math.floor(u() * n),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(u() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    // lognormal noise with mean exactly 1
    logn1: (sig) => Math.exp(sig * normal() - sig * sig / 2),
  };
}
module.exports = { makeRng };
