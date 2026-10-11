// The puzzle world: orb physics against a bit-grid of "solid" cells. Solid = static level geometry
// OR a shadow reported by the camera. Pure logic (no DOM) so it can be tested headless.

export const W = 456, H = 540, CELL = 6, GW = W / CELL, GH = H / CELL;
export const ORB_R = 12;

const GRAVITY = 1100;
const NUDGE = 520;
const VMAX = 900;
const SUBSTEP = 1 / 120;
const N_SAMPLES = 16;
const COS = Array.from({ length: N_SAMPLES }, (_, i) => Math.cos((i / N_SAMPLES) * Math.PI * 2));
const SIN = Array.from({ length: N_SAMPLES }, (_, i) => Math.sin((i / N_SAMPLES) * Math.PI * 2));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- grid helpers (also used by tests / simulator to paint fake shadows) -----------------------
export function fillRect(grid, x, y, w, h, value = 1) {
  const i0 = Math.max(0, Math.ceil((x - CELL / 2) / CELL)), i1 = Math.min(GW - 1, Math.floor((x + w - CELL / 2) / CELL));
  const j0 = Math.max(0, Math.ceil((y - CELL / 2) / CELL)), j1 = Math.min(GH - 1, Math.floor((y + h - CELL / 2) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * GW + i] = value;
}

const distToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

export function fillLine(grid, x1, y1, x2, y2, thickness = 12, value = 1) {
  const pad = thickness / 2 + CELL;
  const i0 = Math.max(0, Math.floor((Math.min(x1, x2) - pad) / CELL)), i1 = Math.min(GW - 1, Math.ceil((Math.max(x1, x2) + pad) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(y1, y2) - pad) / CELL)), j1 = Math.min(GH - 1, Math.ceil((Math.max(y1, y2) + pad) / CELL));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (distToSegment((i + 0.5) * CELL, (j + 0.5) * CELL, x1, y1, x2, y2) <= thickness / 2) grid[j * GW + i] = value;
    }
  }
}

export function fillDisc(grid, x, y, r, value = 1) {
  for (let j = Math.max(0, Math.floor((y - r) / CELL)); j <= Math.min(GH - 1, Math.ceil((y + r) / CELL)); j++) {
    for (let i = Math.max(0, Math.floor((x - r) / CELL)); i <= Math.min(GW - 1, Math.ceil((x + r) / CELL)); i++) {
      if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) <= r) grid[j * GW + i] = value;
    }
  }
}

function cellsInCircle(x, y, r) {
  const out = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) <= r) out.push(j * GW + i);
  }
  return Int32Array.from(out);
}

function cellsAlong(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / 3));
  const seen = new Set();
  for (let s = 0; s <= n; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / n, y = a[1] + ((b[1] - a[1]) * s) / n;
    const i = clamp(Math.floor(x / CELL), 0, GW - 1), j = clamp(Math.floor(y / CELL), 0, GH - 1);
    seen.add(j * GW + i);
  }
  return Int32Array.from(seen);
}

// -------------------------------------------------------------------------------------------------
export class World {
  constructor(level) {
    this.shadow = new Uint8Array(GW * GH);
    this.events = [];
    this.load(level);
  }

  load(level) {
    this.level = level;
    this.solid = new Uint8Array(GW * GH);
    this.time = 0;
    this.deaths = 0;
    this.completed = false;
    this.clearTime = 0;
    this.goalTimer = 0;
    this.gravity = [0, 1];
    this.input = { nudge: 0 };
    this.switches = {};
    for (const s of level.switches || []) this.switches[s.key] = false;
    this.plates = (level.plates || []).map((p) => ({ ...p, cells: cellsInCircle(p.x, p.y, p.r), cover: 0, hold: 0, active: false }));
    this.gates = (level.gates || []).map((g) => ({ ...g, open: false }));
    this.beams = (level.beams || []).map((b) => ({ ...b, cells: cellsAlong(b.a, b.b), off: 0, active: true }));
    this.stars = (level.stars || []).map(([x, y]) => ({ x, y, taken: false }));
    this.orbs = [];
    this.rebuildSolid();
    this.spawnOrb();
  }

  get starsTaken() { return this.stars.reduce((n, s) => n + (s.taken ? 1 : 0), 0); }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  setShadow(mask) { this.shadow.set(mask); }
  setSwitch(key, on) {
    if (!(key in this.switches)) return;
    this.switches[key] = on === undefined ? !this.switches[key] : !!on;
    this.emit('switch', { key, on: this.switches[key] });
  }
  setGravity(g) {
    if (g[0] === this.gravity[0] && g[1] === this.gravity[1]) return;
    this.gravity = [g[0], g[1]];
    this.emit('gravity', { g: this.gravity });
  }

  rebuildSolid() {
    const s = this.solid;
    s.fill(0);
    const lv = this.level;
    for (const [x, y, w, h] of lv.walls || []) fillRect(s, x, y, w, h);
    for (const [x1, y1, x2, y2, t] of lv.lines || []) fillLine(s, x1, y1, x2, y2, t || 14);
    for (const g of this.gates) if (!g.open) fillRect(s, ...g.rect);
  }

  // ---- orbs -----------------------------------------------------------------------------------
  spawnOrb() {
    if (this.orbs.length >= (this.level.orbs || 1)) return false;
    const [sx, sy] = this.level.spawn;
    const o = { id: Math.random().toString(36).slice(2, 7), x: sx + (this.orbs.length ? (Math.random() - 0.5) * 30 : 0), y: sy, vx: 0, vy: 0, spin: 0, dead: false, respawn: 0, contact: false };
    this.orbs.push(o);
    this.emit('spawn', { x: o.x, y: o.y });
    return true;
  }

  resetOrbs() {
    this.orbs = [];
    this.spawnOrb();
  }

  solidAt(px, py) {
    const i = Math.floor(px / CELL), j = Math.floor(py / CELL);
    if (i < 0 || i >= GW || j < 0) return true;     // left, right and top edges are walls
    if (j >= GH) return false;                      // the bottom is the void
    const k = j * GW + i;
    return this.solid[k] === 1 || this.shadow[k] === 1;
  }

  circleFree(x, y, r) {
    if (this.solidAt(x, y)) return false;
    for (let s = 0; s < N_SAMPLES; s++) if (this.solidAt(x + COS[s] * r, y + SIN[s] * r)) return false;
    return true;
  }

  findFree(x, y) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let rad = 1; rad <= 26; rad++) {
      let best = null, bestD = Infinity;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const px = (cx + dx + 0.5) * CELL, py = (cy + dy + 0.5) * CELL;
          if (py > H - ORB_R * 2) continue;
          if (this.circleFree(px, py, ORB_R)) {
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = [px, py]; }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  kill(o, reason) {
    if (o.dead || this.completed) return;
    o.dead = true;
    o.respawn = 0.9;
    if (!this.level.sandbox) this.deaths++;
    this.emit('death', { x: o.x, y: Math.min(o.y, H - 4), reason });
  }

  respawn(o) {
    const [sx, sy] = this.level.spawn;
    const free = this.circleFree(sx, sy, ORB_R) ? [sx, sy] : this.findFree(sx, sy) || [sx, sy];
    Object.assign(o, { x: free[0], y: free[1], vx: 0, vy: 0, dead: false, contact: false });
    this.emit('spawn', { x: o.x, y: o.y });
  }

  /** Push the orb out of solids. Returns the contact normal, or null when free. */
  collide(o) {
    let nx = 0, ny = 0, touched = false;
    for (let iter = 0; iter < 16; iter++) {
      let cnt = 0, sx = 0, sy = 0;
      for (let s = 0; s < N_SAMPLES; s++) {
        if (this.solidAt(o.x + COS[s] * ORB_R, o.y + SIN[s] * ORB_R)) { cnt++; sx -= COS[s]; sy -= SIN[s]; }
      }
      if (!cnt) break;
      touched = true;
      const len = Math.hypot(sx, sy);
      if (cnt >= 13 || len < 0.2 * cnt) { this.eject(o); return null; }
      nx = sx / len; ny = sy / len;
      // shallow contacts creep out in small steps (no resting jitter), deep ones leave quickly
      const push = 0.25 + 0.12 * cnt;
      o.x += nx * push;
      o.y += ny * push;
    }
    if (this.solidAt(o.x, o.y)) { this.eject(o); return null; }
    return touched ? { nx, ny } : null;
  }

  /** A shadow landed on the orb: slide it to the nearest free spot. */
  eject(o) {
    const free = this.findFree(o.x, o.y);
    if (!free) { this.kill(o, 'crushed'); return; }
    o.x = free[0]; o.y = free[1];
    o.vx *= 0.3; o.vy *= 0.3;
  }

  stepOrb(o, dt) {
    const [gx, gy] = this.gravity;
    let ax = gx * GRAVITY, ay = gy * GRAVITY;
    const n = clamp(this.input.nudge || 0, -1, 1);
    if (gy !== 0) ax += n * NUDGE; else ay += n * NUDGE;
    o.vx += ax * dt; o.vy += ay * dt;
    const drag = Math.exp(-0.15 * dt);
    o.vx *= drag; o.vy *= drag;
    // the goal is a soft well: fast orbs get caught instead of shooting past
    const goal = this.level.goal;
    if (goal) {
      const dx = goal[0] - o.x, dy = goal[1] - o.y;
      if (Math.hypot(dx, dy) < goal[2] * 1.5) {
        o.vx += dx * 150 * dt; o.vy += dy * 150 * dt;
        const c = Math.exp(-18 * dt);
        o.vx *= c; o.vy *= c;
      }
    }
    const sp = Math.hypot(o.vx, o.vy);
    if (sp > VMAX) { o.vx *= VMAX / sp; o.vy *= VMAX / sp; }
    o.x += o.vx * dt; o.y += o.vy * dt;
    const hit = this.collide(o);
    o.contact = !!hit;
    if (hit && !o.dead) {
      const vn = o.vx * hit.nx + o.vy * hit.ny;
      if (vn < 0) {
        const e = vn < -140 ? 0.35 : 0;
        o.vx -= (1 + e) * vn * hit.nx;
        o.vy -= (1 + e) * vn * hit.ny;
        if (vn < -160) this.emit('bounce', { x: o.x, y: o.y, power: Math.min(1, -vn / 700) });
      }
      const f = Math.exp(-1.6 * dt);
      const vn2 = o.vx * hit.nx + o.vy * hit.ny;
      o.vx = vn2 * hit.nx + (o.vx - vn2 * hit.nx) * f;
      o.vy = vn2 * hit.ny + (o.vy - vn2 * hit.ny) * f;
    }
    o.spin += ((o.vx * (gy >= 0 ? 1 : -1)) - o.vy * Math.sign(gx)) / ORB_R * dt;
    if (o.y - ORB_R > H + 20) this.kill(o, 'void');
  }

  // ---- mechanics ------------------------------------------------------------------------------
  updatePlates(dt) {
    for (const p of this.plates) {
      let n = 0;
      for (let c = 0; c < p.cells.length; c++) n += this.shadow[p.cells[c]];
      p.cover = n / p.cells.length;
      const was = p.active;
      if (p.cover >= 0.35) p.hold = 1.2; else p.hold = Math.max(0, p.hold - dt);
      p.active = p.hold > 0;
      if (p.active !== was) this.emit('plate', { key: p.key, active: p.active });
    }
  }

  updateGates() {
    let changed = false;
    for (const g of this.gates) {
      const open = !!this.switches[g.key] || this.plates.some((p) => p.key === g.key && p.active);
      if (open !== g.open) { g.open = open; changed = true; this.emit('gate', { key: g.key, open }); }
    }
    if (changed) this.rebuildSolid();
  }

  updateBeams(dt) {
    for (const b of this.beams) {
      let blocked = false;
      for (let c = 0; c < b.cells.length && !blocked; c++) blocked = this.shadow[b.cells[c]] === 1;
      if (blocked) b.off = 0.15; else b.off = Math.max(0, b.off - dt);
      const active = b.off <= 0;
      if (active !== b.active) { b.active = active; this.emit('beam', { active }); }
    }
  }

  checkHazards(o) {
    for (const [x, y, w, h] of this.level.spikes || []) {
      const cx = clamp(o.x, x, x + w), cy = clamp(o.y, y, y + h);
      if (Math.hypot(o.x - cx, o.y - cy) < ORB_R - 2) return this.kill(o, 'spikes');
    }
    for (const b of this.beams) {
      if (b.active && distToSegment(o.x, o.y, b.a[0], b.a[1], b.b[0], b.b[1]) < ORB_R + 2) return this.kill(o, 'laser');
    }
  }

  checkPickups(o, dt) {
    for (const s of this.stars) {
      if (!s.taken && Math.hypot(o.x - s.x, o.y - s.y) < ORB_R + 16) {
        s.taken = true;
        this.emit('star', { x: s.x, y: s.y, count: this.starsTaken, total: this.stars.length });
      }
    }
    const g = this.level.goal;
    if (g) {
      if (Math.hypot(o.x - g[0], o.y - g[1]) < g[2] - 6) this.goalTimer += dt; else this.goalTimer = Math.max(0, this.goalTimer - dt);
      if (this.goalTimer >= 0.25) {
        this.completed = true;
        this.clearTime = this.time;
        this.emit('goal', { x: g[0], y: g[1], time: this.time, stars: this.starsTaken, total: this.stars.length, deaths: this.deaths });
      }
    }
  }

  /** Advance the simulation. `input` = { nudge: -1..1 }. */
  step(dt, input) {
    if (input) this.input = input;
    if (this.completed) return;
    this.time += dt;
    this.updatePlates(dt);
    this.updateGates();
    this.updateBeams(dt);
    const n = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / n;
    for (let s = 0; s < n && !this.completed; s++) {
      for (const o of this.orbs) {
        if (o.dead) { o.respawn -= h; if (o.respawn <= 0) this.respawn(o); continue; }
        this.stepOrb(o, h);
      }
    }
    for (const o of this.orbs) {
      if (o.dead || this.completed) continue;
      this.checkHazards(o);
      if (!o.dead) this.checkPickups(o, dt);
    }
  }
}
