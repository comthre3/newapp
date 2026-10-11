// Monte Carlo: pit-stop Embers for uneven teams. Each player answers 2 own-tier cards, p(correct)=0.65 (assumption).
// Rule M: embers = round(3 * mean correct fraction).  Rule S: embers = min(3, round(sum correct / 2.5)) (sum-based strawman).
// Rule C: "team answers once, any knower counts" (collective-answer strawman): embers = number of 3 cards where >=1 member knows.
function trial(nA, nB, q, rule) {
  const team = (n) => {
    let correct = 0; const per = [];
    for (let i = 0; i < n; i++) { let c = 0; for (let k = 0; k < 2; k++) if (Math.random() < q) c++; per.push(c); correct += c; }
    if (rule === 'M') return Math.round(3 * correct / (2 * n));
    if (rule === 'S') return Math.min(3, Math.round(correct / 2.5));
    if (rule === 'C') { let e = 0; for (let k = 0; k < 3; k++) { let any = false; for (let i = 0; i < n; i++) if (Math.random() < q * 0.6) any = true; if (any) e++; } return e; }
  };
  return [team(nA), team(nB)];
}
for (const [nA, nB] of [[4, 3], [5, 4], [3, 2]]) {
  for (const rule of ['M', 'S', 'C']) {
    let aWin = 0, bWin = 0, tie = 0, eA = 0, eB = 0; const N = 200000;
    for (let i = 0; i < N; i++) { const [a, b] = trial(nA, nB, 0.65, rule); eA += a; eB += b; if (a > b) aWin++; else if (b > a) bWin++; else tie++; }
    console.log(`${nA}v${nB} rule ${rule}: mean embers big ${(eA / N).toFixed(2)} small ${(eB / N).toFixed(2)} | big>small ${(100 * aWin / N).toFixed(1)}%  small>big ${(100 * bWin / N).toFixed(1)}%  tie ${(100 * tie / N).toFixed(1)}%`);
  }
}
// active-seat share
for (const [n, s] of [[4, 3], [5, 4], [5, 3], [7, 3]]) console.log(`team of ${n}, ${s} active seats -> each player active ${(100 * s / n).toFixed(0)}% of legs if rotated evenly`);
