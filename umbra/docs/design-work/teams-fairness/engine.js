'use strict';
// "World" model + rule sets for the UMBRA team-fairness simulation.
// The world is a PLAUSIBLE ASSUMPTION, not measured data: per-head effort falls with team size
// (Ringelmann-style, p(n) = 1 - delta*(n-1)) and the shared beam saturates (diminishing returns per extra caster).

const BAND_MU = { kid: Math.log(0.60), teen: Math.log(0.85), adult: 0 };
const PRIOR = { kid: 0.60, teen: 0.85, adult: 1.0, unknown: 0.85 };

const DEFAULT_WORLD = {
  delta: 0.07,      // per-extra-head loss of effort (Moede/Ringelmann fit: 100,93,85 ... ~7 points per head)
  phi: 0,           // share of the size effect driven by TOTAL team size even for non-active members (0 = only active seats matter)
  pMin: 0.35,
  beamCap: 3,       // casters that fit in the beam before extra hands only add rho each
  rho: 0.25,
  sigEps: 0.30,     // per-player per-round performance noise (lognormal sigma)
  gateK: 3.0,       // gate success rate q = 1 - exp(-gateK * theta * p)
  nQ: 5,            // questions per knowledge round
  knowQ: 0.45,      // P(a player knows an answer) = knowQ * theta (clamped)
};

function pfun(n, delta, pMin = 0.35) {
  return Math.min(1.3, Math.max(pMin, 1 - delta * (n - 1)));
}

// ---- roster generation (family camp / adults only / youth) ---------------------------------
let SKILL_SD = 0.25;
function setSkillSd(x) { SKILL_SD = x; }
function genRoster(N, rng) {
  const r = rng.u();
  const type = r < 0.5 ? 'family' : r < 0.75 ? 'adults' : 'youth';
  const bands = [];
  if (type === 'family') {
    while (bands.length < N) {                       // households scan together, adults first
      const h = 2 + rng.int(3);
      const nAd = rng.u() < 0.6 ? 2 : 1;
      for (let j = 0; j < h; j++) bands.push(j < nAd ? 'adult' : (rng.u() < 0.65 ? 'kid' : 'teen'));
    }
    bands.length = N;
  } else if (type === 'adults') {
    for (let i = 0; i < N; i++) bands.push('adult');
  } else {
    for (let i = 0; i < N; i++) { const x = rng.u(); bands.push(x < 0.05 ? 'kid' : x < 0.55 ? 'teen' : 'adult'); }
  }
  const players = bands.map((b, i) => {
    const theta = Math.exp(BAND_MU[b] + SKILL_SD * rng.normal());
    const declared = rng.u() < 0.15 ? 'unknown' : b;      // 15% skip the optional age tap
    return { id: i, band: b, declared, theta, est: PRIOR[declared], est0: PRIOR[declared], joinSeq: i, active: 0 };
  });
  return { type, players };
}
// 45-second warm-up: one noisy measurement per player, shrunk toward the age-band prior
function applyMeasurement(players, rng, W, kappa = 2) {
  for (const p of players) {
    const m = p.theta * rng.logn1(W.sigEps);
    p.meas = m;
    p.est = (kappa * p.est0 + m) / (kappa + 1);
  }
}
function arraysOf(players) {
  return { est: players.map(p => p.est), band: players.map(p => p.declared) };
}

// ---- one round, from the world's point of view ---------------------------------------------
function playRound(type, thetas, n, W, rng) {
  const a = thetas.length;
  const neff = a + W.phi * (n - a);
  const p = pfun(neff, W.delta, W.pMin);
  if (type === 'PAR') return thetas.map(t => t * p * rng.logn1(W.sigEps));
  if (type === 'BEAM') {
    const q = thetas.map(t => t * rng.logn1(W.sigEps)).sort((x, y) => y - x);
    let tot = 0;
    q.forEach((v, k) => { tot += v * (k < W.beamCap ? 1 : W.rho); });
    return p * tot;
  }
  if (type === 'KNOW') {
    const qs = [];
    for (let j = 0; j < W.nQ; j++) qs.push(thetas.map(t => (rng.u() < Math.min(0.9, Math.max(0.03, W.knowQ * t)) ? 1 : 0)));
    return qs;
  }
  if (type === 'GATE') {
    const gs = [];
    for (let j = 0; j < 3; j++) gs.push(thetas.map(t => (rng.u() < Math.min(0.99, Math.max(0.05, 1 - Math.exp(-W.gateK * t * p))) ? 1 : 0)));
    return gs;
  }
  throw new Error('bad round type ' + type);
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => sum(a) / a.length;

function roundScore(type, out, rule) {
  if (type === 'PAR') return rule.agg === 'sum' ? sum(out) : mean(out);
  if (type === 'BEAM') return out;
  if (type === 'KNOW') return rule.know === 'pooled' ? sum(out.map(row => (row.some(v => v === 1) ? 1 : 0))) : sum(out.map(mean));
  if (type === 'GATE') return rule.gate === 'allornothing' ? sum(out.map(row => (row.every(v => v === 1) ? 1 : 0))) : sum(out.map(mean));
  throw new Error('bad type');
}

// ---- rule sets -----------------------------------------------------------------------------
const RULES = {
  R0_naive_sum:    { seats: 'all',  agg: 'sum',  know: 'pooled', gate: 'allornothing', F: null, flat: null, catchup: false, beta: 0 },
  R1_mean:         { seats: 'all',  agg: 'mean', know: 'indiv',  gate: 'fraction',     F: null, flat: null, catchup: false, beta: 0 },
  R2_mean_sizeF:   { seats: 'all',  agg: 'mean', know: 'indiv',  gate: 'fraction',     F: { deltaHat: 0.07 }, flat: null, catchup: false, beta: 0 },
  R2h_sizeF_half:  { seats: 'all',  agg: 'mean', know: 'indiv',  gate: 'fraction',     F: { deltaHat: 0.035 }, flat: null, catchup: false, beta: 0 },
  R3_flatBonusB:   { seats: 'all',  agg: 'mean', know: 'indiv',  gate: 'fraction',     F: null, flat: 1.08, catchup: false, beta: 0 },
  R4_even:         { seats: 'even', agg: 'mean', know: 'indiv',  gate: 'fraction',     F: null, flat: null, catchup: false, beta: 0 },
  R4s_even_spot2:  { seats: 'even', agg: 'mean', know: 'indiv',  gate: 'fraction',     F: null, flat: null, catchup: false, beta: 0.02 },
  R5_even_catchup: { seats: 'even', agg: 'mean', know: 'indiv',  gate: 'fraction',     F: null, flat: null, catchup: true,  beta: 0 },
};

function pickActive(team, S, rng) {
  // least-active-first, random tie-break  (this is exactly the production rotation rule)
  const order = rng.shuffle(team.slice()).sort((a, b) => a.active - b.active);
  const act = order.slice(0, S);
  for (const p of act) p.active++;
  return act;
}

const REF_CACHE = new Map();
function calibrate(ruleName, W, seed = 12345, trials = 1500) {
  const key = ruleName + JSON.stringify(W);
  if (REF_CACHE.has(key)) return REF_CACHE.get(key);
  const { makeRng } = require('./rng');
  const rng = makeRng(seed);
  const rule = RULES[ruleName];
  const refs = {};
  for (const type of ['PAR', 'BEAM', 'KNOW', 'GATE']) {
    let s = 0;
    for (let t = 0; t < trials; t++) {
      const ro = genRoster(8, rng);
      const th = ro.players.slice(0, 4).map(p => p.theta);
      s += roundScore(type, playRound(type, th, 4, W, rng), rule);
    }
    refs[type] = s / trials;
  }
  REF_CACHE.set(key, refs);
  return refs;
}

const SEQ_MIX = ['BEAM', 'PAR', 'KNOW', 'GATE', 'BEAM'];

// teams: array of arrays of player objects. returns points per team.
function playSession(teams, ruleName, W, rng, seq = SEQ_MIX, ruleOverride = null, carry = null) {
  const rule = ruleOverride || RULES[ruleName];
  const refs = calibrate(ruleName, W);
  const k = teams.length;
  const sizes = teams.map(t => t.length);
  const nMin = Math.min(...sizes);
  for (const t of teams) for (const p of t) p.active = 0;
  const pts = carry ? carry.slice() : new Array(k).fill(0);
  for (let r = 0; r < seq.length; r++) {
    const type = seq[r];
    const mult = new Array(k).fill(1);
    if (rule.catchup && (r > 0 || carry)) {
      const lead = Math.max(...pts), trail = Math.min(...pts);
      if (lead > 0) {
        const g = (lead - trail) / lead;
        const kk = rule.cuK != null ? rule.cuK : 0.25, cap = rule.cuCap != null ? rule.cuCap : 0.10;
        for (let t = 0; t < k; t++) if (pts[t] === trail) mult[t] = 1 + Math.min(cap, kk * g);
      }
    }
    for (let t = 0; t < k; t++) {
      const surplus = rule.seats === 'even' && sizes[t] > nMin;
      const act = surplus ? pickActive(teams[t], nMin, rng) : teams[t];
      const out = playRound(type, act.map(p => p.theta), sizes[t], W, rng);
      let f = 1;
      if (rule.F) {
        const d = rule.F.deltaHat;
        f = Math.min(1.1, Math.max(0.9, pfun(nMin, d) / pfun(sizes[t], d)));
      }
      if (rule.flat && sizes[t] > nMin) f *= rule.flat;
      if (surplus) f *= 1 + rule.beta;
      pts[t] += 100 * roundScore(type, out, rule) / refs[type] * f * mult[t];
    }
  }
  return pts;
}

module.exports = { setSkillSd, BAND_MU, PRIOR, DEFAULT_WORLD, pfun, genRoster, applyMeasurement, arraysOf, playRound, roundScore, RULES, pickActive, calibrate, playSession, SEQ_MIX, sum, mean };
