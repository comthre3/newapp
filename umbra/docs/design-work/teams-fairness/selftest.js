'use strict';
// Sanity tests for the assignment module and the engine. Run: node selftest.js
const assert = require('assert');
const { makeRng } = require('./rng');
const A = require('./assign');
const E = require('./engine');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };

// 1. team count policy
const tc = (N, c) => A.chooseTeamCount(N, c);
ok(tc(1).mode === 'solo', 'N=1 solo');
ok(tc(2).mode === 'coop' && tc(3).mode === 'coop', 'N=2,3 coop vs the Night');
ok(tc(4).k === 2 && tc(4).sizes.join() === '2,2', 'N=4 -> 2v2');
ok(tc(7).sizes.join() === '4,3', 'N=7 -> 4v3');
ok(tc(10).k === 2 && tc(10).sizes.join() === '5,5', 'N=10 -> 5v5');
ok(tc(11).k === 3 && tc(11).sizes.join() === '4,4,3', 'N=11 -> 4/4/3');
ok(tc(12).k === 3 && tc(12).sizes.join() === '4,4,4', 'N=12 -> 4/4/4');
ok(tc(16).k === 4 && tc(16).sizes.join() === '4,4,4,4', 'N=16 -> 4x4');
ok(tc(19).audience === 3 && tc(19).sizes.reduce((a, b) => a + b) === 16, 'N=19 -> 16 players + 3 audience');
ok(tc(9, { preferPerfect: true, maxTeams: 3 }).k === 3, 'N=9 perfect 3x3 when concept allows 3 lanes');
for (let N = 4; N <= 16; N++) {
  const s = tc(N).sizes; ok(Math.max(...s) - Math.min(...s) <= 1, 'sizes differ by <=1 at N=' + N);
  ok(Math.max(...s) <= 5, 'max team size <=5 at N=' + N);
}

// 2. assignment keeps sizes within 1, covers everyone once, never leaves a team without a grown-up when avoidable
const rng = makeRng(7);
for (let trial = 0; trial < 300; trial++) {
  const N = 4 + rng.int(13);
  const ro = E.genRoster(N, rng);
  E.applyMeasurement(ro.players, rng, E.DEFAULT_WORLD);
  const P = E.arraysOf(ro.players);
  const t = A.chooseTeamCount(N);
  const teams = A.assignTeams([...Array(N).keys()], t.k, P, {}, rng);
  const flat = teams.flat().sort((a, b) => a - b);
  ok(flat.length === N && flat.every((v, i) => v === i), 'everyone exactly once');
  const sz = teams.map(x => x.length);
  ok(Math.max(...sz) - Math.min(...sz) <= 1, 'sizes within 1');
  const nonKid = ro.players.filter(p => p.declared !== 'kid').length;
  if (nonKid >= t.k) ok(teams.every(tm => tm.some(i => P.band[i] !== 'kid')), 'every team has a non-kid when avoidable');
}

// 3. late joiner goes to a smallest team; rebalance only when gap >= 2
{
  const N = 8;
  const ro = E.genRoster(N, rng); const P = E.arraysOf(ro.players);
  const teams = [[0, 1, 2, 3], [4, 5, 6]];
  A.placeLate(teams, 7, P, {}, rng);
  ok(teams[1].length === 4 && teams[0].length === 4, 'late joiner fills the smaller team');
  const t2 = [[0, 1, 2, 3, 4], [5, 6, 7]];
  const mv = A.rebalance(t2, P, {});
  ok(mv.length === 1 && t2[0].length === 4 && t2[1].length === 4, 'rebalance moves exactly one player 5v3 -> 4v4');
  const t3 = [[0, 1, 2, 3], [4, 5, 6]];
  ok(A.rebalance(t3, P, {}).length === 0, 'no move when gap is 1');
}

// 4. redraft only moves a bounded number of players
{
  const N = 8;
  const ro = E.genRoster(N, rng); E.applyMeasurement(ro.players, rng, E.DEFAULT_WORLD);
  const P = E.arraysOf(ro.players);
  const teams = A.assignTeams([...Array(N).keys()], 2, P, {}, rng);
  const before = teams.map(t => new Set(t));
  const r = A.redraft(teams, P, {}, rng, { maxMoves: 2, minGain: 0 });
  if (r.changed) {
    let moved = 0; r.teams.forEach((t, ti) => t.forEach(i => { if (!before[ti].has(i)) moved++; }));
    ok(moved <= 2, 'redraft respects maxMoves');
  }
}

// 5. engine: symmetric even teams are 50/50 under every rule
{
  for (const rn of Object.keys(E.RULES)) {
    let w = 0; const R = 3000;
    for (let i = 0; i < R; i++) {
      const ro = E.genRoster(8, rng);
      const sh = rng.shuffle(ro.players.slice());
      const pts = E.playSession([sh.slice(0, 4), sh.slice(4)], rn, E.DEFAULT_WORLD, rng);
      w += pts[0] > pts[1] ? 1 : pts[0] === pts[1] ? 0.5 : 0;
    }
    const wr = w / R;
    ok(Math.abs(wr - 0.5) < 0.035, rn + ' even 4v4 shuffled is ~50% (got ' + wr.toFixed(3) + ')');
  }
}
console.log('selftest passed: ' + n + ' checks');
