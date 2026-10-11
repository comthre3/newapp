// Tiny WebAudio synth so the game needs no sound files.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.lastBounce = 0; }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* no audio */ }
  }

  tone(freq, dur, { type = 'sine', gain = 0.12, slide = 0, delay = 0 } = {}) {
    const c = this.ctx;
    if (!c || this.muted || c.state !== 'running') return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  play(name, a = {}) {
    switch (name) {
      case 'bounce': {
        const now = performance.now();
        if (now - this.lastBounce < 70) return;
        this.lastBounce = now;
        this.tone(180 + 260 * (a.power || 0.3), 0.09, { type: 'triangle', gain: 0.05 + 0.1 * (a.power || 0.3), slide: -60 });
        break;
      }
      case 'star': [660, 880, 1320].forEach((f, i) => this.tone(f + (a.count || 0) * 60, 0.14, { delay: i * 0.06, gain: 0.09 })); break;
      case 'goal': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { delay: i * 0.09, type: 'triangle', gain: 0.12 })); break;
      case 'death': this.tone(420, 0.35, { type: 'sawtooth', gain: 0.07, slide: -330 }); break;
      case 'spawn': this.tone(520, 0.12, { gain: 0.06, slide: 300 }); break;
      case 'gate': this.tone(a.open ? 300 : 440, 0.18, { type: 'square', gain: 0.05, slide: a.open ? 260 : -180 }); break;
      case 'plate': this.tone(a.active ? 700 : 500, 0.1, { type: 'triangle', gain: 0.07 }); break;
      case 'switch': this.tone(a.on ? 800 : 560, 0.08, { type: 'square', gain: 0.05 }); break;
      case 'gravity': this.tone(300, 0.22, { type: 'sine', gain: 0.08, slide: 200 }); break;
      case 'join': this.tone(740, 0.1, { gain: 0.08 }); this.tone(988, 0.14, { gain: 0.08, delay: 0.08 }); break;
      case 'beam': this.tone(a.active ? 220 : 880, 0.1, { type: 'square', gain: 0.03 }); break;
      default:
    }
  }
}
