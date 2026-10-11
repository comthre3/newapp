'use strict';
// Usage: node sim.js [exp1|exp2|exp2b|exp3|exp4|exp5|exp6|all]
const { makeRng } = require('./rng');
const A = require('./assign');
const E = require('./engine');

const W0 = { ...E.DEFAULT_WORLD };
if (process.env.SIG_EPS) W0.sigEps = +process.env.SIG_EPS;
if (process.env.SKILL_SD) E.setSkillSd(+process.env.SKILL_SD);
if (process.env.SIG_EPS || process.env.SKILL_SD) console.log(`[world override: sigEps=${W0.sigEps}, skillSd=${process.env.SKILL_SD || 0.25}]`);
const pct = (x) => (100 * x).toFixed(1);
const fmt = (x, d = 3) => x.toFixed(d);

// ---------- helpers ----------
function makeRoster(N, rng, sizes, method = 'WARM') {
  const ro = E.genRoster(N, rng);
  E.applyMeasurement(ro.players, rng, W0);
  const idx = [...Array(N).keys()];
  // WARM  = what the product can really do: age-band prior + one 45 s warm-up measurement
  // ORACLE = balance on TRUE skill; used only to isolate the head-count effect from skill-estimate noise
  const P = method === 'ORACLE'
    ? { est: ro.players.map(p => p.theta), band: ro.players.map(p => p.declared) }
    : E.arraysOf(ro.players);
  const teams = A.assignTeams(idx, sizes.length, P, {}, rng, { sizes });
  return { ro, P, teams: teams.map(t => t.map(i => ro.players[i])) };
}

// big-team win probability for one roster
function rosterP(teamObjs, rule, W, S, rng, seq, ruleOverride) {
  let w = 0;
  for (let s = 0; s < S; s++) {
    const pts = E.playSession(teamObjs, rule, W, rng, seq, ruleOverride);
    w += pts[0] > pts[1] ? 1 : pts[0] === pts[1] ? 0.5 : 0;
  }
  return w / S;
}
function summarize(Ps, S) {
  const R = Ps.length;
  const m = Ps.reduce((a, b) => a + b, 0) / R;
  const v = Ps.reduce((a, b) => a + (b - m) ** 2, 0) / (R - 1);
  const se = Math.sqrt(v / R);
  const noise = Ps.reduce((a, b) => a + b * (1 - b) / S, 0) / R;
  const trueSd = Math.sqrt(Math.max(0, v - noise));
  const blow = Ps.filter(p => p < 0.35 || p > 0.65).length / R;
  return { mean: m, ci: 1.96 * se, sd: trueSd, blow };
}

// ---------- Exp 1: assignment methods, balance quality ----------
function exp1() {
  console.log('\n=== EXP 1: how well does each assignment method balance the two teams? ===');
  console.log('(true skill gap = |mean true skill A - mean true skill B| in par units; adult par = 1.0)');
  const splits = [[4, 3], [5, 4], [6, 5], [6, 6]];
  const methods = ['ALT_JOIN', 'RANDOM', 'SNAKE_PRIOR', 'OPT_PRIOR', 'OPT_PRIOR+REDRAFT', 'OPT_WARM', 'ORACLE'];
  const R = 1500;
  const rng = makeRng(101);
  for (const [nb, ns] of splits) {
    const N = nb + ns;
    const stats = {};
    for (const m of methods) stats[m] = { gap: 0, gapHi: 0, ageEx: 0, noGrownUp: 0, nGrownUpCases: 0, moved: 0 };
    for (let r = 0; r < R; r++) {
      const ro = E.genRoster(N, rng);
      const pl = ro.players;
      const idx = [...Array(N).keys()];
      const sizes = [nb, ns];
      const priorP = { est: pl.map(p => p.est0), band: pl.map(p => p.declared) };
      // measured estimates (warm-up) on a copy
      E.applyMeasurement(pl, rng, W0);
      const warmP = { est: pl.map(p => p.est), band: pl.map(p => p.declared) };
      const trueP = { est: pl.map(p => p.theta), band: pl.map(p => p.declared) };
      const out = {};
      out.ALT_JOIN = (() => { const a = [], b = []; idx.forEach(i => (i % 2 === 0 ? a : b).push(i)); return [a, b]; })();
      out.RANDOM = (() => { const sh = rng.shuffle(idx.slice()); return [sh.slice(0, nb), sh.slice(nb)]; })();
      out.SNAKE_PRIOR = A.snakeBest(idx, sizes, priorP, A.DEFAULT_CFG, rng);
      out.OPT_PRIOR = A.assignTeams(idx, 2, priorP, {}, rng, { sizes });
      const rd = A.redraft(out.OPT_PRIOR.map(t => t.slice()), warmP, {}, rng);
      out['OPT_PRIOR+REDRAFT'] = rd.teams;
      stats['OPT_PRIOR+REDRAFT'].moved += rd.moved;
      out.OPT_WARM = A.assignTeams(idx, 2, warmP, {}, rng, { sizes });
      out.ORACLE = A.assignTeams(idx, 2, trueP, {}, rng, { sizes });
      for (const m of methods) {
        const teams = out[m];
        const mt = teams.map(t => t.reduce((s, i) => s + pl[i].theta, 0) / t.length);
        const gap = Math.abs(mt[0] - mt[1]);
        stats[m].gap += gap; if (gap > 0.10) stats[m].gapHi++;
        let ex = 0;
        for (const b of ['kid', 'teen', 'adult']) {
          const c = teams.map(t => t.filter(i => pl[i].band === b).length);
          ex += Math.max(0, Math.max(...c) - Math.min(...c) - 1);
        }
        stats[m].ageEx += ex;
        const nonKid = pl.filter(p => p.band !== 'kid').length;
        if (nonKid >= 2) { stats[m].nGrownUpCases++; if (!teams.every(t => t.some(i => pl[i].band !== 'kid'))) stats[m].noGrownUp++; }
      }
    }
    console.log(`\n${nb}v${ns} (N=${N}), ${R} random rooms`);
    console.log('method'.padEnd(20) + 'mean gap'.padStart(10) + 'gap>0.10'.padStart(10) + 'age excess'.padStart(12) + 'kid-only team'.padStart(15) + 'avg moved'.padStart(11));
    for (const m of methods) {
      const s = stats[m];
      console.log(m.padEnd(20) + fmt(s.gap / R).padStart(10) + (pct(s.gapHi / R) + '%').padStart(10) + fmt(s.ageEx / R, 2).padStart(12) + (pct(s.noGrownUp / Math.max(1, s.nGrownUpCases)) + '%').padStart(15) + (m.includes('REDRAFT') ? fmt(s.moved / R, 2) : '-').padStart(11));
    }
  }
}

// ---------- Exp 2: bigger-team win rate by rule set and split ----------
function runCell(split, ruleName, W, R, S, seed, seq, ruleOverride, mode = 'ORACLE') {
  const rng = makeRng(seed);
  const [nb, ns] = split;
  const Ps = [];
  for (let r = 0; r < R; r++) {
    const { teams } = makeRoster(nb + ns, rng, [nb, ns], mode);
    Ps.push(rosterP(teams, ruleName, W, S, rng, seq, ruleOverride));
  }
  return summarize(Ps, S);
}

function exp2() {
  const splits = [[4, 4], [4, 3], [5, 4], [6, 5], [7, 5]];
  const rules = Object.keys(E.RULES);
  for (const [mode, R, S, title] of [
    ['ORACLE', 1500, 60, 'PART A - size effect isolated: teams balanced on TRUE skill (not achievable in the product, only used to measure head-count bias)'],
    ['WARM', 2500, 40, 'PART B - realistic: teams balanced on age-band prior + one warm-up measurement (what the product can actually do)'],
  ]) {
    console.log(`\n=== EXP 2 ${title} ===`);
    console.log('win rate of the BIGGER team over a mixed 5-round session (BEAM, PAR, KNOW, GATE, BEAM); world delta 0.07, phi 0. 50.0 = fair. +/- = 95% CI over rosters.');
    console.log('rule'.padEnd(18) + splits.map(s => (s[0] === s[1] ? s.join('v') + ' ctrl' : s.join('v'))).map(x => x.padStart(14)).join(''));
    const detail = {};
    for (const rn of rules) {
      let line = rn.padEnd(18);
      for (const sp of splits) {
        const c = runCell(sp, rn, W0, R, S, 2000 + sp[0] * 10 + sp[1], E.SEQ_MIX, null, mode);
        line += `${pct(c.mean)}±${(100 * c.ci).toFixed(1)}`.padStart(14);
        detail[rn + sp.join('v')] = c;
      }
      console.log(line);
    }
    console.log('roster-level spread (noise-corrected SD of per-roster win prob, points) / blowout share (<35% or >65%)');
    for (const rn of rules) {
      let line = rn.padEnd(18);
      for (const sp of splits) { const c = detail[rn + sp.join('v')]; line += `${(100 * c.sd).toFixed(1)} / ${pct(c.blow)}%`.padStart(14); }
      console.log(line);
    }
  }
}

// ---------- Exp 2b: per round type ----------
function exp2b() {
  console.log('\n=== EXP 2b: bigger-team win rate by ROUND TYPE (5 rounds of the same type; teams balanced on true skill to isolate head-count) ===');
  const types = ['PAR', 'BEAM', 'KNOW', 'GATE'];
  const splits = [[4, 3], [5, 4], [6, 5], [7, 5]];
  const rules = ['R0_naive_sum', 'R1_mean', 'R2_mean_sizeF', 'R4_even', 'R4s_even_spot2'];
  const R = 1200, S = 60;
  for (const sp of splits) {
    console.log(`\n${sp.join('v')}`);
    console.log('rule'.padEnd(18) + types.map(t => t.padStart(14)).join(''));
    for (const rn of rules) {
      let line = rn.padEnd(18);
      for (const t of types) {
        const c = runCell(sp, rn, W0, R, S, 3000 + sp[0], [t, t, t, t, t]);
        line += `${pct(c.mean)}±${(100 * c.ci).toFixed(1)}`.padStart(14);
      }
      console.log(line);
    }
  }
}

// ---------- Exp 3: sensitivity to the true size effect and spill-over ----------
function exp3() {
  console.log('\n=== EXP 3: what if the world is NOT the one the rules assumed? bigger-team win rate (teams balanced on true skill) ===');
  console.log('delta = true per-head effort loss (0 = no loafing, 0.07 = assumed, 0.11 = heavy). phi = share of the size effect driven by total team size even for benched players.');
  const deltas = [0, 0.035, 0.07, 0.11];
  const phis = [0, 0.5, 1];
  const splits = [[4, 3], [5, 4], [7, 5]];
  const rules = ['R1_mean', 'R2_mean_sizeF', 'R4_even', 'R5_even_catchup'];
  const R = 700, S = 60;
  for (const sp of splits) {
    console.log(`\nsplit ${sp.join('v')}`);
    console.log('rule'.padEnd(18) + 'phi'.padEnd(5) + deltas.map(d => ('d=' + d).padStart(14)).join(''));
    for (const rn of rules) {
      for (const phi of phis) {
        if (phi > 0 && !rn.startsWith('R4') && !rn.startsWith('R5')) continue; // phi only matters when seats are benched
        let line = rn.padEnd(18) + String(phi).padEnd(5);
        for (const d of deltas) {
          const W = { ...W0, delta: d, phi };
          const c = runCell(sp, rn, W, R, S, 4000 + sp[0] * 7 + Math.round(d * 1000), E.SEQ_MIX);
          line += `${pct(c.mean)}±${(100 * c.ci).toFixed(1)}`.padStart(14);
        }
        console.log(line);
      }
    }
  }
  console.log('\nSpotter bonus sensitivity (R4_even, delta 0.07, phi 0): bigger-team win rate vs beta');
  for (const beta of [0, 0.02, 0.05, 0.10]) {
    const ov = { ...E.RULES.R4_even, beta };
    let line = ('beta=' + beta).padEnd(12);
    for (const sp of [[4, 3], [5, 4], [7, 5]]) {
      const c = runCell(sp, 'R4_even', W0, 1000, 60, 5000 + sp[0], E.SEQ_MIX, ov);
      line += `${sp.join('v')}: ${pct(c.mean)}±${(100 * c.ci).toFixed(1)}   `;
    }
    console.log(line);
  }
}

// ---------- Exp 4: roster lopsidedness by assignment method ----------
function exp4() {
  console.log('\n=== EXP 4: does the assignment method matter for lopsided rooms? (rule R5, world default) ===');
  console.log('per-roster win prob of the bigger team: mean, noise-corrected SD (points), blowout share (<35% or >65%)');
  const splits = [[4, 3], [5, 4], [6, 6]];
  const methods = ['ALT_JOIN', 'RANDOM', 'OPT_PRIOR', 'OPT_WARM'];
  const R = 300, S = 250;
  for (const sp of splits) {
    console.log(`\n${sp.join('v')}`);
    for (const m of methods) {
      const rng = makeRng(6000 + sp[0] * 3);
      const Ps = [];
      for (let r = 0; r < R; r++) {
        const N = sp[0] + sp[1];
        const ro = E.genRoster(N, rng); const pl = ro.players;
        const idx = [...Array(N).keys()];
        const priorP = { est: pl.map(p => p.est0), band: pl.map(p => p.declared) };
        E.applyMeasurement(pl, rng, W0);
        const warmP = { est: pl.map(p => p.est), band: pl.map(p => p.declared) };
        let teams;
        if (m === 'ALT_JOIN') { const a = [], b = []; idx.forEach(i => (i % 2 === 0 ? a : b).push(i)); teams = [a, b]; }
        else if (m === 'RANDOM') { const sh = rng.shuffle(idx.slice()); teams = [sh.slice(0, sp[0]), sh.slice(sp[0])]; }
        else if (m === 'OPT_PRIOR') teams = A.assignTeams(idx, 2, priorP, {}, rng, { sizes: sp });
        else teams = A.assignTeams(idx, 2, warmP, {}, rng, { sizes: sp });
        Ps.push(rosterP(teams.map(t => t.map(i => pl[i])), 'R5_even_catchup', W0, S, rng, E.SEQ_MIX));
      }
      const s = summarize(Ps, S);
      console.log(m.padEnd(12) + `bigger-team win ${pct(s.mean)}±${(100 * s.ci).toFixed(1)}   roster SD ${(100 * s.sd).toFixed(1)} pts   blowout ${pct(s.blow)}%`);
    }
  }
}

// ---------- Exp 5: reshuffle with repeat-pair penalty ----------
function exp5() {
  console.log('\n=== EXP 5: reshuffle at the act break: how many teammates repeat? ===');
  const rng = makeRng(777);
  for (const sizes of [[4, 4], [4, 3], [5, 5]]) {
    const N = sizes[0] + sizes[1];
    const R = 1500;
    const acc = { none: [0, 0], pen: [0, 0], rnd: [0, 0] };
    for (let r = 0; r < R; r++) {
      const ro = E.genRoster(N, rng); E.applyMeasurement(ro.players, rng, W0);
      const P = E.arraysOf(ro.players); const idx = [...Array(N).keys()];
      const t1 = A.assignTeams(idx, 2, P, {}, rng, { sizes });
      const prev = {}; t1.forEach((t, ti) => t.forEach(i => { prev[i] = ti; }));
      const run = (teams, key) => {
        let rep = 0, pairs = 0;
        for (const t of teams) for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) { pairs++; if (prev[t[a]] === prev[t[b]]) rep++; }
        acc[key][0] += rep / pairs;
        const mt = teams.map(t => t.reduce((s, i) => s + ro.players[i].theta, 0) / t.length);
        acc[key][1] += Math.abs(mt[0] - mt[1]);
      };
      run(A.assignTeams(idx, 2, P, { wRep: 0 }, rng, { sizes }), 'none');
      run(A.assignTeams(idx, 2, P, { wRep: 0.08 }, rng, { sizes, prevTeamOf: prev }), 'pen');
      const sh = rng.shuffle(idx.slice()); run([sh.slice(0, sizes[0]), sh.slice(sizes[0])], 'rnd');
    }
    console.log(`\n${sizes.join('v')}: share of teammate pairs that were ALREADY teammates in the previous act / true skill gap`);
    for (const [k, label] of [['none', 'optimiser, no repeat penalty'], ['pen', 'optimiser + repeat penalty 0.08'], ['rnd', 'pure random reshuffle']]) {
      console.log(label.padEnd(36) + pct(acc[k][0] / R).padStart(7) + '%   gap ' + fmt(acc[k][1] / R));
    }
  }
}

// ---------- Exp 6: three teams ----------
function exp6() {
  console.log('\n=== EXP 6: three teams (4/4/3, N=11): share of sessions won by each team (fair = 33.3% each) ===');
  const rng = makeRng(888);
  for (const rn of ['R0_naive_sum', 'R1_mean', 'R5_even_catchup']) {
    const wins = [0, 0, 0]; const R = 3000, S = 30;
    for (let r = 0; r < R; r++) {
      const ro = E.genRoster(11, rng); E.applyMeasurement(ro.players, rng, W0);
      const P = E.arraysOf(ro.players);
      const tm = A.assignTeams([...Array(11).keys()], 3, P, {}, rng, { sizes: [4, 4, 3] }).map(t => t.map(i => ro.players[i]));
      const sizes = tm.map(t => t.length);
      for (let s = 0; s < S; s++) {
        const pts = E.playSession(tm, rn, W0, rng);
        const mx = Math.max(...pts); const w = pts.map((p, i) => (p === mx ? i : -1)).filter(i => i >= 0);
        for (const i of w) wins[i] += 1 / w.length;
      }
      if (r === 0) wins.sizes = sizes;
    }
    const tot = R * S;
    console.log(rn.padEnd(18) + 'team sizes 4/4/3 -> win share: ' + wins.slice(0, 3).map((w, i) => `${[4, 4, 3][i]}-player ${pct(w / tot)}%`).join('   '));
  }
}


// ---------- Exp 7: what actually reduces lopsided rooms? ----------
function exp7() {
  console.log('\n=== EXP 7: what reduces LOPSIDED rooms (as opposed to head-count bias)? realistic assignment, 4v3 and 5v4 and 4v4 control ===');
  console.log('per-roster win prob of the bigger team: mean +/-CI | noise-corrected SD (points) | blowout share (<35% or >65%)');
  const R = 2000, S = 40;
  const variants = [
    ['V0 R5 baseline: prior + 1 warm-up', {}],
    ['V1 + re-draft after round 1', { redraft: true }],
    ['V2 + 3 warm-up measurements (not 1)', { warm: 3 }],
    ['V3 + catch-up cap 0.20 (k 0.5)', { cu: [0.5, 0.20] }],
    ['V4 + catch-up cap 0.30 (k 0.75)', { cu: [0.75, 0.30] }],
    ['V5 = V1 + V2 + V3', { redraft: true, warm: 3, cu: [0.5, 0.20] }],
  ];
  for (const sp of [[4, 4], [4, 3], [5, 4]]) {
    console.log(`\n${sp.join('v')}`);
    for (const [label, o] of variants) {
      const rng = makeRng(9000 + sp[0] * 11 + sp[1]);
      const Ps = [];
      for (let r = 0; r < R; r++) {
        const N = sp[0] + sp[1];
        const ro = E.genRoster(N, rng); const pl = ro.players;
        const kappa = 2, nW = o.warm || 1;
        const meas = pl.map(p => Array.from({ length: nW }, () => p.theta * rng.logn1(W0.sigEps)));
        pl.forEach((p, i) => { p.est = (kappa * p.est0 + meas[i].reduce((a, b) => a + b, 0)) / (kappa + nW); });
        const idx = [...Array(N).keys()];
        let P = E.arraysOf(pl);
        let tIdx = A.assignTeams(idx, 2, P, {}, rng, { sizes: sp });
        const rule = o.cu ? { ...E.RULES.R5_even_catchup, cuK: o.cu[0], cuCap: o.cu[1] } : E.RULES.R5_even_catchup;
        let w = 0;
        for (let s = 0; s < S; s++) {
          let teams = tIdx.map(t => t.map(i => pl[i]));
          let pts;
          if (o.redraft) {
            pts = E.playSession(teams, 'R5_even_catchup', W0, rng, [E.SEQ_MIX[0]], rule);
            // observed round-1 performance -> better estimate (each session draws its own observation)
            const est2 = pl.map((p, i) => (kappa * p.est0 + meas[i].reduce((a, b) => a + b, 0) + p.theta * rng.logn1(W0.sigEps)) / (kappa + nW + 1));
            const P2 = { est: est2, band: pl.map(p => p.declared) };
            const rd = A.redraft(tIdx.map(t => t.slice()), P2, {}, rng);
            teams = rd.teams.map(t => t.map(i => pl[i]));
            pts = E.playSession(teams, 'R5_even_catchup', W0, rng, E.SEQ_MIX.slice(1), rule, pts);
          } else {
            pts = E.playSession(teams, 'R5_even_catchup', W0, rng, E.SEQ_MIX, rule);
          }
          w += pts[0] > pts[1] ? 1 : pts[0] === pts[1] ? 0.5 : 0;
        }
        Ps.push(w / S);
      }
      const q = summarize(Ps, S);
      console.log(label.padEnd(40) + `${pct(q.mean)}±${(100 * q.ci).toFixed(1)}`.padStart(12) + ` | SD ${(100 * q.sd).toFixed(1)} | blowout ${pct(q.blow)}%`);
    }
  }
}

const which = process.argv[2] || 'all';
const t0 = Date.now();
const all = { exp1, exp2, exp2b, exp3, exp4, exp5, exp6, exp7 };
if (which === 'all') Object.values(all).forEach(f => f()); else all[which]();
console.log(`\n[done in ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
