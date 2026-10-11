// Drawing for the projector. Remember: dark pixels read as shadows, so every colour comes from
// palette.js (bright) and the background is white. No black ink, no dark outlines, no drop shadows.
import { PAL } from './palette.js';
import { W, H, ORB_R } from './world.js';

const TAU = Math.PI * 2;

export class Effects {
  constructor() { this.parts = []; this.rings = []; }

  burst(x, y, n = 16, colors = PAL.fx, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.7 + Math.random() * 0.5, max: 1.2, size: 3 + Math.random() * 4, color: colors[(Math.random() * colors.length) | 0], g: 600 });
    }
  }

  confetti(x, y) {
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 250 + Math.random() * 450;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.6 + Math.random(), max: 2.6, size: 4 + Math.random() * 5, color: PAL.fx[(Math.random() * PAL.fx.length) | 0], g: 700, rect: true, rot: Math.random() * TAU });
    }
  }

  ring(x, y, color, r = 60) { this.rings.push({ x, y, color, r, t: 0 }); }

  update(dt) {
    for (const p of this.parts) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; if (p.rot !== undefined) p.rot += dt * 8; }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.6);
  }

  draw(ctx) {
    for (const r of this.rings) {
      ctx.globalAlpha = 1 - r.t / 0.6;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + (r.r * r.t) / 0.6, 0, TAU);
      ctx.stroke();
    }
    for (const p of this.parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.5));
      ctx.fillStyle = p.color;
      if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
}

function star(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

const keyColor = (k) => PAL.keys[k] || PAL.keys.A;

function drawStatic(ctx, world) {
  const lv = world.level;
  ctx.fillStyle = PAL.wall;
  for (const [x, y, w, h] of lv.walls || []) {
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = PAL.wallHi;
    ctx.fillRect(x, y, w, Math.min(5, h));
    ctx.fillStyle = PAL.wall;
  }
  ctx.strokeStyle = PAL.wall;
  ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2, t] of lv.lines || []) {
    ctx.lineWidth = t || 14;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (const [x, y, w, h] of lv.spikes || []) {
    ctx.fillStyle = PAL.spike;
    const n = Math.max(1, Math.round(w / 18));
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i * w) / n, y + h); ctx.lineTo(x + ((i + 0.5) * w) / n, y); ctx.lineTo(x + ((i + 1) * w) / n, y + h);
      ctx.fill();
    }
  }
}

function drawGates(ctx, world, t) {
  for (const g of world.gates) {
    const [x, y, w, h] = g.rect;
    const c = keyColor(g.key);
    if (g.open) {
      ctx.globalAlpha = 0.18; ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      for (let yy = y + 6; yy < y + h - 4; yy += 22) ctx.fillRect(x + w / 2 - 2, yy, 4, 10);
    }
  }
}

function drawPlates(ctx, world, t) {
  for (const p of world.plates) {
    const c = keyColor(p.key);
    ctx.globalAlpha = p.active ? 0.38 : 0.1 + 0.25 * Math.min(1, p.cover / 0.35);
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c; ctx.lineWidth = p.active ? 7 : 5;
    ctx.setLineDash(p.active ? [] : [14, 10]);
    ctx.lineDashOffset = -t * 20;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.fill();
  }
}

function drawBeams(ctx, world, t) {
  for (const b of world.beams) {
    ctx.lineCap = 'round';
    if (b.active) {
      ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 30);
      ctx.strokeStyle = PAL.beam; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(...b.a); ctx.lineTo(...b.b); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(...b.a); ctx.lineTo(...b.b); ctx.stroke();
    } else {
      ctx.strokeStyle = PAL.beamOff; ctx.lineWidth = 3; ctx.setLineDash([4, 12]);
      ctx.beginPath(); ctx.moveTo(...b.a); ctx.lineTo(...b.b); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = b.active ? PAL.beam : PAL.beamOff;
    for (const e of [b.a, b.b]) { ctx.beginPath(); ctx.arc(e[0], e[1], 9, 0, TAU); ctx.fill(); }
  }
}

function drawGoal(ctx, world, t) {
  const g = world.level.goal;
  if (!g) return;
  const [x, y, r] = g;
  ctx.fillStyle = PAL.goalSoft; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = PAL.goal; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.lineWidth = 3; ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.arc(x, y, r * (0.45 + 0.1 * Math.sin(t * 4)), 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.5 - 0.5 * Math.cos(t * 3);
  ctx.beginPath(); ctx.arc(x, y, r * (1.15 + 0.25 * ((t * 0.8) % 1)), 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawStars(ctx, world, t) {
  ctx.fillStyle = PAL.star;
  for (const s of world.stars) {
    if (s.taken) continue;
    star(ctx, s.x, s.y + Math.sin(t * 3 + s.x) * 3, 15, Math.sin(t * 2 + s.y) * 0.15);
    ctx.fill();
  }
}

function drawOrb(ctx, o, trail, t) {
  if (o.dead) return;
  // trail
  ctx.fillStyle = PAL.orb;
  for (let i = 0; i < trail.length; i++) {
    ctx.globalAlpha = (i / trail.length) * 0.28;
    ctx.beginPath(); ctx.arc(trail[i][0], trail[i][1], ORB_R * (0.35 + 0.5 * (i / trail.length)), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(o.x - 4, o.y - 4, 1, o.x, o.y, ORB_R);
  g.addColorStop(0, PAL.orbHi); g.addColorStop(0.45, PAL.orb); g.addColorStop(1, PAL.orb);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o.x, o.y, ORB_R, 0, TAU); ctx.fill();
  // spin mark
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(o.x, o.y, ORB_R * 0.6, o.spin, o.spin + 1.1); ctx.stroke();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export class SceneRenderer {
  constructor() { this.trails = new Map(); this.t = 0; }

  reset() { this.trails.clear(); this.t = 0; }

  update(dt, world) {
    this.t += dt;
    for (const o of world.orbs) {
      let tr = this.trails.get(o.id);
      if (!tr) this.trails.set(o.id, (tr = []));
      if (!o.dead) { tr.push([o.x, o.y]); if (tr.length > 14) tr.shift(); } else tr.length = 0;
    }
  }

  /** Draw the whole playfield in world coordinates (caller has set the transform). */
  draw(ctx, world, fx, { showMask = false, label = true } = {}) {
    const t = this.t;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);

    // dotted build-here hints for the first seconds
    if (world.level.ghosts && world.time < 14 && !world.completed) {
      ctx.globalAlpha = Math.min(1, (14 - world.time) / 3) * (0.6 + 0.4 * Math.sin(t * 3));
      ctx.strokeStyle = PAL.hint; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.setLineDash([1, 18]);
      for (const [x1, y1, x2, y2] of world.level.ghosts) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    drawStatic(ctx, world);
    drawPlates(ctx, world, t);
    drawGates(ctx, world, t);
    drawBeams(ctx, world, t);
    drawGoal(ctx, world, t);
    drawStars(ctx, world, t);
    for (const o of world.orbs) drawOrb(ctx, o, this.trails.get(o.id) || [], t);
    fx.draw(ctx);

    if (showMask) {
      ctx.fillStyle = 'rgba(0, 200, 255, 0.35)';
      const s = world.shadow;
      for (let j = 0; j < 90; j++) for (let i = 0; i < 160; i++) if (s[j * 160 + i]) ctx.fillRect(i * 6, j * 6, 6, 6);
    }

    if (label) this.hud(ctx, world);
  }

  hud(ctx, world) {
    const lv = world.level;
    ctx.fillStyle = PAL.text;
    ctx.textBaseline = 'top';
    ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(lv.name.toUpperCase(), 24, 18);
    ctx.textAlign = 'right';
    const total = world.stars.length;
    const secs = world.time.toFixed(1);
    ctx.fillText(`${total ? `★ ${world.starsTaken}/${total}   ` : ''}${lv.sandbox ? '' : `${secs}s`}`, W - 70, 18);

    if (lv.hint && world.time < 12 && !world.completed) {
      ctx.globalAlpha = Math.min(1, (12 - world.time) / 2);
      ctx.fillStyle = PAL.textSoft;
      ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const lines = wrapText(ctx, lv.hint, 760);
      const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(W / 2 - boxW / 2, 52, boxW, lines.length * 28 + 14, 14);
      else ctx.rect(W / 2 - boxW / 2, 52, boxW, lines.length * 28 + 14);
      ctx.fill();
      ctx.fillStyle = PAL.textSoft;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, 78 + i * 28));
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawClear(ctx, info, t) {
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL.goal;
    ctx.font = '900 88px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.save();
    ctx.translate(W / 2, 200);
    ctx.scale(1 + 0.04 * Math.sin(t * 5), 1 + 0.04 * Math.sin(t * 5));
    ctx.fillText('LEVEL CLEAR!', 0, 0);
    ctx.restore();
    for (let i = 0; i < Math.max(1, info.total); i++) {
      ctx.fillStyle = i < info.stars || info.total === 0 ? PAL.star : PAL.hint;
      if (info.total === 0 && i > 0) break;
      star(ctx, W / 2 + (i - (Math.max(1, info.total) - 1) / 2) * 90, 285, 34, Math.sin(t * 3 + i) * 0.12);
      ctx.fill();
    }
    ctx.fillStyle = PAL.text;
    ctx.font = '700 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`${info.time.toFixed(1)} s   ·   ${info.deaths} ${info.deaths === 1 ? 'fall' : 'falls'}`, W / 2, 360);
    ctx.textAlign = 'left';
  }
}
