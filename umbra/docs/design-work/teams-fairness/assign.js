'use strict';
// UMBRA room-decides-the-teams: assignment module (pure functions, no I/O).
// Players are referred to by index into parallel arrays P.est[] (skill estimate in "par" units)
// and P.band[] ('kid' | 'teen' | 'adult' | 'unknown', as DECLARED by the player's optional tap).

const BAND_LIST = ['kid', 'teen', 'adult'];
const DEFAULT_CFG = {
  wSkill: 1.0,        // weight on |mean skill gap| between teams (par units)
  wAge: 0.03,         // cost per unit of age-band imbalance beyond 1
  wNoGrownUp: 0.25,   // cost per team that has no teen/adult/unknown when that is avoidable
  wRep: 0.08,         // cost if every pair of teammates repeats from the previous act (scaled by fraction)
  tieEps: 0.02,       // choose randomly among splits within this much of the best cost
  maxTeamSize: 5,
  maxTeams: 4,
  maxActive: 16,      // players beyond this become audience
  soloMax: 1,
  coopMax: 3,
  preferPerfect: false,
};

function sizesFor(N, k) {
  const base = Math.floor(N / k), rem = N % k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}

// ---- how many teams ------------------------------------------------------------------------
function chooseTeamCount(N, cfgIn) {
  const cfg = { ...DEFAULT_CFG, ...(cfgIn || {}) };
  const active = Math.min(N, cfg.maxActive);
  const audience = N - active;
  if (active <= cfg.soloMax) return { mode: 'solo', k: 1, sizes: [active], audience };
  if (active <= cfg.coopMax) return { mode: 'coop', k: 1, sizes: [active], audience };
  let k = 2;
  while (Math.ceil(active / k) > cfg.maxTeamSize && k < cfg.maxTeams) k++;
  if (cfg.preferPerfect && active % k !== 0) {
    for (let k2 = k + 1; k2 <= cfg.maxTeams; k2++) {
      if (active % k2 === 0 && active / k2 >= 3) { k = k2; break; }
    }
  }
  return { mode: 'teams', k, sizes: sizesFor(active, k), audience };
}

// ---- cost J of a candidate split (lower is better) ----------------------------------------
function cost(teams, P, cfg, prevTeamOf) {
  let mn = Infinity, mx = -Infinity;
  for (const t of teams) {
    let s = 0; for (const i of t) s += P.est[i];
    const m = s / t.length;
    if (m < mn) mn = m; if (m > mx) mx = m;
  }
  let J = cfg.wSkill * (mx - mn);
  for (const b of BAND_LIST) {
    let lo = 1e9, hi = -1;
    for (const t of teams) {
      let c = 0; for (const i of t) if (P.band[i] === b) c++;
      if (c < lo) lo = c; if (c > hi) hi = c;
    }
    J += cfg.wAge * Math.max(0, hi - lo - 1);
  }
  let lacking = 0, nonKid = 0;
  for (const t of teams) {
    let has = false;
    for (const i of t) if (P.band[i] !== 'kid') { has = true; nonKid++; }
    if (!has) lacking++;
  }
  J += cfg.wNoGrownUp * Math.max(0, lacking - Math.max(0, teams.length - nonKid));
  if (prevTeamOf) {
    let rep = 0, pairs = 0;
    for (const t of teams) {
      for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) {
        pairs++;
        if (prevTeamOf[t[a]] !== undefined && prevTeamOf[t[a]] === prevTeamOf[t[b]]) rep++;
      }
    }
    J += cfg.wRep * (rep / Math.max(1, pairs));
  }
  return J;
}

// ---- snake draft ---------------------------------------------------------------------------
function snakeDeal(sortedIdx, sizes) {
  const k = sizes.length;
  const teams = Array.from({ length: k }, () => []);
  const fwd = [...Array(k).keys()], rev = fwd.slice().reverse();
  let r = 0, pos = 0;
  while (pos < sortedIdx.length) {
    for (const t of (r % 2 === 0 ? fwd : rev)) {
      if (pos >= sortedIdx.length) break;
      if (teams[t].length < sizes[t]) teams[t].push(sortedIdx[pos++]);
    }
    r++;
  }
  return teams;
}
// try every rotation of the size list (who gets the top pick vs the extra seat) and keep the best
function snakeBest(idx, sizes, P, cfg, rng, prevTeamOf) {
  const order = idx.slice();
  rng.shuffle(order);                                   // random tie-break
  order.sort((a, b) => P.est[b] - P.est[a]);            // stable sort keeps the shuffle for ties
  let best = null, bestJ = Infinity;
  for (let r = 0; r < sizes.length; r++) {
    const sz = sizes.map((_, i) => sizes[(i + r) % sizes.length]);
    const teams = snakeDeal(order, sz);
    const J = cost(teams, P, cfg, prevTeamOf);
    if (J < bestJ - 1e-12) { bestJ = J; best = teams; }
  }
  return best;
}

// ---- exhaustive split for 2 teams (N <= ~20) -----------------------------------------------
function bestSplit2(idx, sizes, P, cfg, prevTeamOf, rng) {
  const N = idx.length, m = sizes[0];
  const fixFirst = sizes[0] === sizes[1];               // symmetric: pin player 0 to team 0
  const cands = [];
  let bestJ = Infinity;
  const evalChosen = (chosen) => {
    const inT0 = new Uint8Array(N);
    const t0 = [], t1 = [];
    for (const c of chosen) inT0[c] = 1;
    for (let i = 0; i < N; i++) (inT0[i] ? t0 : t1).push(idx[i]);
    const J = cost([t0, t1], P, cfg, prevTeamOf);
    if (J < bestJ) bestJ = J;
    cands.push({ J, t0, t1 });
  };
  const rec = (start, chosen) => {
    if (chosen.length === m) { evalChosen(chosen); return; }
    const need = m - chosen.length;
    for (let i = start; i <= N - need; i++) { chosen.push(i); rec(i + 1, chosen); chosen.pop(); }
  };
  if (fixFirst) rec(1, [0]); else rec(0, []);
  const near = cands.filter(c => c.J <= bestJ + cfg.tieEps);
  const pick = near[rng.int(near.length)];
  return [pick.t0, pick.t1];
}

// ---- local search for k >= 3 or very large rooms -------------------------------------------
function localSearch(idx, sizes, P, cfg, prevTeamOf, rng, restarts = 4, iters = 2500) {
  let best = null, bestJ = Infinity;
  const k = sizes.length;
  for (let r = 0; r < restarts; r++) {
    let teams;
    if (r === 0) teams = snakeBest(idx, sizes, P, cfg, rng, prevTeamOf);
    else {
      const sh = rng.shuffle(idx.slice());
      teams = []; let p = 0;
      for (const s of sizes) { teams.push(sh.slice(p, p + s)); p += s; }
    }
    let J = cost(teams, P, cfg, prevTeamOf);
    for (let it = 0; it < iters; it++) {
      const a = rng.int(k); let b = rng.int(k - 1); if (b >= a) b++;
      const ia = rng.int(teams[a].length), ib = rng.int(teams[b].length);
      const x = teams[a][ia], y = teams[b][ib];
      teams[a][ia] = y; teams[b][ib] = x;
      const J2 = cost(teams, P, cfg, prevTeamOf);
      if (J2 < J - 1e-12) J = J2; else { teams[a][ia] = x; teams[b][ib] = y; }
    }
    if (J < bestJ) { bestJ = J; best = teams.map(t => t.slice()); }
  }
  return best;
}

// ---- public entry point: initial assignment ------------------------------------------------
// returns array of teams (arrays of player indices), largest team first.
function assignTeams(idx, k, P, cfg0, rng, opts = {}) {
  const cfg = { ...DEFAULT_CFG, ...(cfg0 || {}) };
  const sizes = opts.sizes || sizesFor(idx.length, k);
  if (k === 2 && idx.length <= 20) return bestSplit2(idx, sizes, P, cfg, opts.prevTeamOf, rng);
  return localSearch(idx, sizes, P, cfg, opts.prevTeamOf, rng);
}

// ---- late joiner: goes to a smallest team, whichever keeps J lowest ------------------------
function placeLate(teams, i, P, cfg0, rng) {
  const cfg = { ...DEFAULT_CFG, ...(cfg0 || {}) };
  const minSize = Math.min(...teams.map(t => t.length));
  const cands = teams.map((_, ti) => ti).filter(ti => teams[ti].length === minSize);
  let bestJ = Infinity, ties = [];
  for (const ti of cands) {
    teams[ti].push(i);
    const J = cost(teams, P, cfg);
    teams[ti].pop();
    if (J < bestJ - 1e-9) { bestJ = J; ties = [ti]; } else if (Math.abs(J - bestJ) <= 1e-9) ties.push(ti);
  }
  const chosen = ties[rng.int(ties.length)];
  teams[chosen].push(i);
  return chosen;
}

// ---- rebalance at a round boundary when sizes differ by 2 or more --------------------------
// movePenalty[i]: extra cost of moving player i (already moved before, long tenure, etc.)
function rebalance(teams, P, cfg0, movePenalty = {}) {
  const cfg = { ...DEFAULT_CFG, ...(cfg0 || {}) };
  const moves = [];
  for (;;) {
    const sizes = teams.map(t => t.length);
    const mx = Math.max(...sizes), mn = Math.min(...sizes);
    if (mx - mn < 2) break;
    const from = sizes.indexOf(mx), to = sizes.indexOf(mn);
    let bestI = -1, bestV = Infinity;
    for (let pos = 0; pos < teams[from].length; pos++) {
      const i = teams[from][pos];
      teams[from].splice(pos, 1); teams[to].push(i);
      const V = cost(teams, P, cfg) + (movePenalty[i] || 0);
      teams[to].pop(); teams[from].splice(pos, 0, i);
      if (V < bestV) { bestV = V; bestI = i; }
    }
    teams[from].splice(teams[from].indexOf(bestI), 1); teams[to].push(bestI);
    moves.push({ player: bestI, from, to });
  }
  return moves;
}

// ---- re-draft after round one (ratings now measured) ---------------------------------------
// 1) re-rank by updated rating and take the snake-draft target; align its labels to the current
//    teams so as few players as possible move; 2) accept it only if it moves <= maxMoves players
//    and gains >= minGain; 3) otherwise fall back to the best <= floor(maxMoves/2) swaps.
function redraft(teams, P, cfg0, rng, opt = {}) {
  const cfg = { ...DEFAULT_CFG, ...(cfg0 || {}) };
  const N = teams.reduce((s, t) => s + t.length, 0);
  const maxMoves = opt.maxMoves != null ? opt.maxMoves : Math.ceil(N / 4);
  const minGain = opt.minGain != null ? opt.minGain : 0.03;
  const k = teams.length;
  const J0 = cost(teams, P, cfg);
  const idx = teams.flat();
  const sizes = teams.map(t => t.length);

  // snake target aligned to current labels (k <= 4 so at most 24 permutations)
  const target = snakeBest(idx, sizes.slice().sort((a, b) => b - a), P, cfg, rng);
  let aligned = null, alignedMoves = Infinity;
  const perms = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((v, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [v, ...p]));
  for (const perm of perms([...Array(k).keys()])) {
    if (!teams.every((t, ti) => target[perm[ti]].length === t.length)) continue;
    let moved = 0;
    teams.forEach((t, ti) => { const set = new Set(target[perm[ti]]); for (const i of t) if (!set.has(i)) moved++; });
    if (moved < alignedMoves) { alignedMoves = moved; aligned = teams.map((_, ti) => target[perm[ti]].slice()); }
  }
  const candidates = [];
  if (aligned && alignedMoves <= maxMoves) candidates.push({ teams: aligned, moves: alignedMoves });

  // bounded greedy swaps
  const sw = teams.map(t => t.slice());
  let swaps = 0, J = J0;
  while (swaps < Math.floor(maxMoves / 2)) {
    let bestJ = J, bestSwap = null;
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++)
      for (let x = 0; x < sw[a].length; x++) for (let y = 0; y < sw[b].length; y++) {
        const ia = sw[a][x], ib = sw[b][y];
        sw[a][x] = ib; sw[b][y] = ia;
        const J2 = cost(sw, P, cfg);
        sw[a][x] = ia; sw[b][y] = ib;
        if (J2 < bestJ - 1e-9) { bestJ = J2; bestSwap = [a, x, b, y]; }
      }
    if (!bestSwap) break;
    const [a, x, b, y] = bestSwap;
    const t = sw[a][x]; sw[a][x] = sw[b][y]; sw[b][y] = t;
    J = bestJ; swaps++;
  }
  if (swaps > 0) candidates.push({ teams: sw, moves: swaps * 2 });

  let best = null, bestJ = J0 - minGain;
  for (const c of candidates) {
    const Jc = cost(c.teams, P, cfg);
    if (Jc < bestJ) { bestJ = Jc; best = c; }
  }
  return best ? { teams: best.teams, moved: best.moves, changed: true } : { teams, moved: 0, changed: false };
}

module.exports = { DEFAULT_CFG, sizesFor, chooseTeamCount, cost, snakeDeal, snakeBest, bestSplit2, localSearch, assignTeams, placeLate, rebalance, redraft };
