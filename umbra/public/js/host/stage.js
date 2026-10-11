// The projector surface. The canvas always fills the whole window (= everything the projector/
// mirror shows), and the 960x540 world is letter-boxed inside it. `view()` tells the vision code
// which part of the projection the world occupies.
import { W, H } from '../game/world.js';

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.flatColor = null;
    this.onResize = () => {};
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.onResize(); });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = Math.max(320, Math.round(window.innerWidth * dpr));
    let h = Math.max(180, Math.round(window.innerHeight * dpr));
    const cap = 1600;
    if (w > cap) { h = Math.round((h * cap) / w); w = cap; }
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = Math.min(w / W, h / H);
    this.ox = (w - W * this.scale) / 2;
    this.oy = (h - H * this.scale) / 2;
  }

  /** The world's rectangle in unit coordinates of the whole projection. */
  view() {
    const w = this.canvas.width, h = this.canvas.height;
    return { x: this.ox / w, y: this.oy / h, w: (W * this.scale) / w, h: (H * this.scale) / h };
  }

  clear(color = '#ffffff') {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  world() { this.ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy); return this.ctx; }
  screen() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); return this.ctx; }

  /** client (CSS px) → world coordinates */
  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * this.canvas.width;
    const py = ((clientY - r.top) / r.height) * this.canvas.height;
    return [(px - this.ox) / this.scale, (py - this.oy) / this.scale];
  }

  /** world → client (CSS px) */
  toClient(wx, wy) {
    const r = this.canvas.getBoundingClientRect();
    return [r.left + ((this.ox + wx * this.scale) / this.canvas.width) * r.width, r.top + ((this.oy + wy * this.scale) / this.canvas.height) * r.height];
  }
}
