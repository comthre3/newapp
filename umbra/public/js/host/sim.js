// Simulator: a pretend camera + pretend wall, plus draggable "physical objects" you can place with the
// mouse. It feeds the *real* calibration and shadow-detection pipeline, so laptop play exercises
// everything except the lens.
import { createSimCamera } from '../core/sim-core.js';

const TAU = Math.PI * 2;

export function drawObject(ctx, o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.a || 0);
  if (o.kind === 'disc') {
    ctx.beginPath(); ctx.arc(0, 0, o.r, 0, TAU);
  } else {
    ctx.beginPath(); ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h);
  }
  ctx.fill();
  ctx.restore();
}

export const TOOLS = {
  hand: () => ({ kind: 'disc', r: 34, a: 0 }),
  bar: () => ({ kind: 'rect', w: 200, h: 16, a: 0 }),
  block: () => ({ kind: 'rect', w: 90, h: 90, a: 0 }),
};

export function hitTest(o, wx, wy) {
  const dx = wx - o.x, dy = wy - o.y;
  if (o.kind === 'disc') return Math.hypot(dx, dy) <= o.r + 6;
  const c = Math.cos(-(o.a || 0)), s = Math.sin(-(o.a || 0));
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= o.w / 2 + 6 && Math.abs(ly) <= o.h / 2 + 6;
}

export class SimCamera {
  constructor(stage, { cw = 480, ch = 270, ambient = 0.06, noise = 0.004, drift = true } = {}) {
    this.stage = stage;
    this.kind = 'sim';
    this.width = cw;
    this.height = ch;
    this.cam = createSimCamera({ cw, ch, ambient, noise });
    this.objects = [];
    this.drift = drift;
    this.out = new Uint8ClampedArray(cw * ch * 4);
    this.proj = document.createElement('canvas');
    this.projCtx = this.proj.getContext('2d', { willReadFrequently: true });
    this.objCanvas = document.createElement('canvas');
    this.objCtx = this.objCanvas.getContext('2d', { willReadFrequently: true });
    this.alpha = null;
    this.t0 = performance.now();
  }

  async start() { return this; }
  stop() {}
  async lockExposure() { return true; }

  getFrame() {
    const { stage } = this;
    const pw = 240, ph = Math.max(2, Math.round((240 * stage.canvas.height) / stage.canvas.width));
    if (this.proj.width !== pw || this.proj.height !== ph) {
      this.proj.width = this.objCanvas.width = pw;
      this.proj.height = this.objCanvas.height = ph;
      this.alpha = new Uint8Array(pw * ph);
    }
    this.projCtx.drawImage(stage.canvas, 0, 0, pw, ph);
    const proj = this.projCtx.getImageData(0, 0, pw, ph).data;

    const oc = this.objCtx;
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, pw, ph);
    const kx = pw / stage.canvas.width, ky = ph / stage.canvas.height;
    oc.setTransform(stage.scale * kx, 0, 0, stage.scale * ky, stage.ox * kx, stage.oy * ky);
    oc.fillStyle = '#000';
    try { oc.filter = 'blur(0.8px)'; } catch { /* older browsers */ }
    for (const o of this.objects) drawObject(oc, o);
    oc.filter = 'none';
    const od = oc.getImageData(0, 0, pw, ph).data;
    for (let i = 0; i < pw * ph; i++) this.alpha[i] = od[i * 4 + 3];

    const gain = this.drift ? 1 + 0.05 * Math.sin((performance.now() - this.t0) / 2500) : 1;
    return this.cam.render(proj, pw, ph, this.alpha, this.out, gain);
  }
}

/** Pointer interaction for placing / dragging virtual objects over the stage. */
export class SimEditor {
  constructor(stage, camera, overlay) {
    this.stage = stage;
    this.camera = camera;
    this.overlay = overlay;
    this.tool = 'hand';
    this.drag = null;
    this.selected = null;
    this.enabled = true;
    overlay.addEventListener('pointerdown', (e) => this.down(e));
    overlay.addEventListener('pointermove', (e) => this.move(e));
    overlay.addEventListener('pointerup', (e) => this.up(e));
    overlay.addEventListener('pointercancel', (e) => this.up(e));
    overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(e); });
    overlay.addEventListener('dblclick', (e) => this.remove(e));
    overlay.addEventListener('wheel', (e) => {
      const [wx, wy] = stage.toWorld(e.clientX, e.clientY);
      const o = [...camera.objects].reverse().find((q) => hitTest(q, wx, wy)) || this.selected;
      if (!o) return;
      e.preventDefault();
      if (e.shiftKey) this.scale(o, e.deltaY < 0 ? 1.08 : 1 / 1.08); else o.a = (o.a || 0) + (e.deltaY > 0 ? 0.12 : -0.12);
    }, { passive: false });
  }

  scale(o, k) {
    if (o.kind === 'disc') o.r = Math.max(10, Math.min(120, o.r * k));
    else { o.w = Math.max(10, Math.min(500, o.w * k)); o.h = Math.max(8, Math.min(300, o.h * (o.h > 30 ? k : 1))); }
  }

  rotateSelected(d) { if (this.selected) this.selected.a = (this.selected.a || 0) + d; }
  scaleSelected(k) { if (this.selected) this.scale(this.selected, k); }
  clear() { this.camera.objects.length = 0; this.selected = null; }

  down(e) {
    if (!this.enabled || e.button === 2) return;
    const [wx, wy] = this.stage.toWorld(e.clientX, e.clientY);
    let o = [...this.camera.objects].reverse().find((q) => hitTest(q, wx, wy));
    if (!o) { o = { ...TOOLS[this.tool](), x: wx, y: wy }; this.camera.objects.push(o); }
    this.selected = o;
    this.drag = { o, dx: o.x - wx, dy: o.y - wy, id: e.pointerId };
    this.overlay.setPointerCapture(e.pointerId);
  }

  move(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const [wx, wy] = this.stage.toWorld(e.clientX, e.clientY);
    this.drag.o.x = wx + this.drag.dx;
    this.drag.o.y = wy + this.drag.dy;
  }

  up(e) { if (this.drag && this.drag.id === e.pointerId) this.drag = null; }

  remove(e) {
    const [wx, wy] = this.stage.toWorld(e.clientX, e.clientY);
    const i = this.camera.objects.findLastIndex((q) => hitTest(q, wx, wy));
    if (i >= 0) { const [o] = this.camera.objects.splice(i, 1); if (this.selected === o) this.selected = null; }
  }

  /** Overlay drawing: the "physical" objects, semi-dark, with the selected one outlined. */
  draw(ctx) {
    ctx.fillStyle = 'rgba(40, 50, 80, 0.55)';
    for (const o of this.camera.objects) drawObject(ctx, o);
    if (this.selected) {
      ctx.strokeStyle = 'rgba(0, 120, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.save(); ctx.translate(this.selected.x, this.selected.y); ctx.rotate(this.selected.a || 0);
      if (this.selected.kind === 'disc') { ctx.beginPath(); ctx.arc(0, 0, this.selected.r + 4, 0, TAU); ctx.stroke(); }
      else ctx.strokeRect(-this.selected.w / 2 - 4, -this.selected.h / 2 - 4, this.selected.w + 8, this.selected.h + 8);
      ctx.restore();
    }
  }
}
