// Quick numeric checks for the Echo Dunes fairness rules (pure maths, no repo access).
const N = 200000;
const rnd = Math.random;
function shieldsMean(n, q) { let c = 0; for (let i = 0; i < n; i++) if (rnd() < q) c++; return Math.round(2 * c / n); } // 0..2
function shieldsSum(n, q) { let c = 0; for (let i = 0; i < n; i++) if (rnd() < q) c++; return Math.min(2, Math.floor(c / 2)); }
function anyCorrect(n, q) { for (let i = 0; i < n; i++) if (rnd() < q) return 1; return 0; }
for (const q of [0.35, 0.65]) {
  console.log(`\nper-player success q=${q}`);
  for (const n of [3, 4, 5]) {
    let m = 0, s = 0, a = 0, mm = 0;
    for (let t = 0; t < N; t++) { const x = shieldsMean(n, q); m += x; mm += x >= 1 ? 1 : 0; s += shieldsSum(n, q); a += anyCorrect(n, q); }
    console.log(`n=${n}  mean-rule: E[shields]=${(m / N).toFixed(3)} P(>=1)=${(mm / N).toFixed(3)} | sum-rule E=${(s / N).toFixed(3)} | any-correct P=${(a / N).toFixed(3)}`);
  }
}
// nudge command: sum vs mean-of-active when k of n players push the same way
console.log('\nnudge: orb command magnitude if everyone pushes (sum clamped to 1 vs mean of active)');
for (const n of [3, 4, 5]) console.log(`n=${n} sumRaw=${n} (clamped 1) meanActive=1.00`);
// recording memory
const bytesPerFrame = Math.ceil(160 * 90 / 8); const frames = 15 * 12;
console.log(`\nrecord: ${bytesPerFrame} B/frame x ${frames} frames = ${(bytesPerFrame * frames / 1024).toFixed(0)} KiB per take; 2 takes x 2 teams = ${(bytesPerFrame * frames * 4 / 1024 / 1024).toFixed(2)} MiB`);
// balancer search size
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
console.log('splits for N=16 into 8/8:', C(16, 8), ' N=9 into 5/4:', C(9, 4));
