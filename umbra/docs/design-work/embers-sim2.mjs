// Fix for the rounding bias seen with "mean per player then round": give every TEAM the same number of answer slots (12),
// dealt round-robin across its players, so embers = round(3 * correct / 12) has the SAME distribution for any team size.
// Heterogeneous knowledge: kid q~0.55, teen 0.65, adult 0.75 (assumption); teams are age-balanced by the room.
const bands = [0.55, 0.65, 0.75];
function team(n, rule) {
  const qs = Array.from({ length: n }, () => 0.65);   // homogeneous: isolates the scoring rule from team composition
  if (rule === 'E') { let c = 0; for (let s = 0; s < 12; s++) if (Math.random() < qs[s % n]) c++; return Math.round(3 * c / 12); }
  if (rule === 'G') { let c = 0; for (let s = 0; s < 12; s++) if (Math.random() < qs[s % n]) c++; return 3 * c / 12; } // continuous gauge
  if (rule === 'M') { let c = 0; for (const q of qs) for (let k = 0; k < 2; k++) if (Math.random() < q) c++; return Math.round(3 * c / (2 * n)); }
}
const N = 300000;
for (const [a, b] of [[4, 3], [5, 4], [3, 2], [7, 6]]) {
  for (const rule of ['M', 'E', 'G']) {
    let w1 = 0, w2 = 0, t = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < N; i++) { const x = team(a, rule), y = team(b, rule); e1 += x; e2 += y; if (x > y) w1++; else if (y > x) w2++; else t++; }
    console.log(`${a}v${b} rule ${rule}: embers big ${(e1 / N).toFixed(3)} small ${(e2 / N).toFixed(3)} | big>small ${(100 * w1 / N).toFixed(1)}% small>big ${(100 * w2 / N).toFixed(1)}% tie ${(100 * t / N).toFixed(1)}%`);
  }
}
