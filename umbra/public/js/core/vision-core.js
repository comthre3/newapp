// Camera → shadow-mask pipeline. Pure maths, no DOM, so it runs in the browser and in `node --test`.
//
// Idea: during calibration the projector shows full black, then full white. From those two
// camera frames we learn, per pixel, how bright "unshadowed" light looks (white) and how
// bright the room is with no light at all (black). During play a cell counts as *lit* if
//     max over R,G,B of (observed - black) / (white - black)
// is high. Using the max channel means any game colour that has one channel at full
// intensity (all of the palette) still reads as "lit"; only a real shadow drops all three.
// Everything is done in linear light, otherwise gamma makes shadows look brighter than they are.

export const SRGB_TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const ENC_SIZE = 4096;
export const LIN_TO_SRGB8 = (() => {
  const t = new Uint8ClampedArray(ENC_SIZE + 1);
  for (let i = 0; i <= ENC_SIZE; i++) {
    const x = i / ENC_SIZE;
    const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    t[i] = Math.round(c * 255);
  }
  return t;
})();
export const encodeLinear = (x) => LIN_TO_SRGB8[x <= 0 ? 0 : x >= 1 ? ENC_SIZE : (x * ENC_SIZE) | 0];

// ---------------------------------------------------------------- homography

/** Homography (3x3, row-major, h33 = 1) mapping four src points onto four dst points. */
export function solveHomography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = A[i][8] / A[i][i];
  h[8] = 1;
  return h;
}

export function invertH(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return new Float64Array([
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ]);
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

export const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
export const cornersToList = (c) => [c.tl, c.tr, c.br, c.bl];

// ---------------------------------------------------------------- calibration

/** Average RGBA frames into linear-light RGB floats (3 per pixel). */
export function averageFrames(frames, w, h) {
  const n = w * h;
  const out = new Float32Array(n * 3);
  for (const f of frames) {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[i * 3] += SRGB_TO_LIN[f[j]];
      out[i * 3 + 1] += SRGB_TO_LIN[f[j + 1]];
      out[i * 3 + 2] += SRGB_TO_LIN[f[j + 2]];
    }
  }
  const k = 1 / frames.length;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

function largestComponent(bin, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let id = 0, bestId = 0, bestSize = 0;
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || label[s]) continue;
    id++;
    let sp = 0, size = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && bin[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - w] && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && bin[p + w] && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }
  return { label, id: bestId, size: bestSize };
}

const quadArea = (c) => {
  const p = cornersToList(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

/**
 * Find the projected rectangle in the camera image from the black and white references.
 * Returns { ok, error?, corners?, contrast, areaFrac, fill, cutOff }.
 */
export function analyzeCalibration(black, white, w, h, { minContrast = 0.08 } = {}) {
  const n = w * h;
  const d = new Float32Array(n);
  const hist = new Uint32Array(512);
  for (let i = 0; i < n; i++) {
    const v = (white[i * 3] - black[i * 3] + white[i * 3 + 1] - black[i * 3 + 1] + white[i * 3 + 2] - black[i * 3 + 2]) / 3;
    d[i] = v;
    hist[Math.max(0, Math.min(511, (v * 511) | 0))]++;
  }
  // robust "full light" level = 99th percentile
  let acc = 0, p99 = 0;
  for (let b = 0; b < 512; b++) {
    acc += hist[b];
    if (acc >= n * 0.99) { p99 = b / 511; break; }
  }
  if (p99 < minContrast) return { ok: false, error: 'low-contrast', contrast: p99 };

  const thr = p99 * 0.5;
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = d[i] > thr ? 1 : 0;
  const comp = largestComponent(bin, w, h);
  const areaFrac = comp.size / n;
  if (areaFrac < 0.06) return { ok: false, error: 'too-small', contrast: p99, areaFrac };

  let tl = null, tr = null, br = null, bl = null;
  let mnS = Infinity, mxS = -Infinity, mnD = Infinity, mxD = -Infinity;
  let borderPx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (comp.label[y * w + x] !== comp.id) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) borderPx++;
      const s = x + y, df = x - y;
      if (s < mnS) { mnS = s; tl = [x, y]; }
      if (s > mxS) { mxS = s; br = [x, y]; }
      if (df > mxD) { mxD = df; tr = [x, y]; }
      if (df < mnD) { mnD = df; bl = [x, y]; }
    }
  }
  const corners = { tl, tr, br, bl };
  const fill = comp.size / Math.max(1, quadArea(corners));
  const cutOff = borderPx > 6;
  if (cutOff) return { ok: false, error: 'cut-off', corners, contrast: p99, areaFrac, fill, cutOff };
  if (fill < 0.75) return { ok: false, error: 'irregular', corners, contrast: p99, areaFrac, fill, cutOff };
  return { ok: true, corners, contrast: p99, areaFrac, fill, cutOff };
}

export const CALIBRATION_ERRORS = {
  'low-contrast': 'The camera can barely tell the projector from the room. Dim the room lights or raise the projector brightness.',
  'too-small': 'The projection fills too little of the camera view. Move the phone closer or zoom in.',
  'cut-off': 'The camera cannot see the whole projection. Move the phone back so every edge of the picture is visible.',
  irregular: 'The bright area is not a clean rectangle. Aim straight at the picture and keep it free of glare.',
};

// ---------------------------------------------------------------- shadow detector

export class ShadowDetector {
  /**
   * @param gw,gh      mask grid size
   * @param cw,ch      camera frame size
   * @param corners    projection corners in camera px {tl,tr,br,bl}
   * @param black,white  linear RGB references from averageFrames
   * @param view       sub-rectangle of the projection (unit coords) that the mask grid covers
   */
  constructor({ gw, gh, cw, ch, corners, black, white, view = { x: 0, y: 0, w: 1, h: 1 }, onT = 0.3, offT = 0.42, minRange = 0.06 }) {
    this.gw = gw; this.gh = gh; this.cw = cw; this.ch = ch;
    this.onT = onT; this.offT = offT;
    this.corners = corners;
    this.H = solveHomography(UNIT_SQUARE, cornersToList(corners));
    const n = gw * gh;
    this.n = n;
    this.base = new Int32Array(n);
    this.amb = new Float32Array(n * 3);
    this.inv = new Float32Array(n * 3);
    this.valid = new Uint8Array(n);
    this.lit = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.pending = new Uint8Array(n);
    this.mask = new Uint8Array(n);
    this.ignore = null;
    this.gain = 1;
    this.stats = { gain: 1, coverage: 0, validFrac: 0 };

    let validCount = 0;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const u = view.x + ((i + 0.5) / gw) * view.w;
        const v = view.y + ((j + 0.5) / gh) * view.h;
        const [cx, cy] = applyH(this.H, u, v);
        if (!(cx >= 1 && cy >= 1 && cx <= cw - 2 && cy <= ch - 2)) continue;
        const x0 = Math.min(cw - 2, Math.max(0, Math.round(cx) - 1));
        const y0 = Math.min(ch - 2, Math.max(0, Math.round(cy) - 1));
        this.base[k] = y0 * cw + x0;
        const rng = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          let b = 0, w = 0;
          for (const o of [0, 1, cw, cw + 1]) {
            b += black[(this.base[k] + o) * 3 + c];
            w += white[(this.base[k] + o) * 3 + c];
          }
          b *= 0.25; w *= 0.25;
          this.amb[k * 3 + c] = b;
          rng[c] = w - b;
        }
        const mx = Math.max(rng[0], rng[1], rng[2]);
        if (mx < minRange) continue;
        this.valid[k] = 1;
        validCount++;
        for (let c = 0; c < 3; c++) this.inv[k * 3 + c] = rng[c] >= Math.max(0.02, mx * 0.15) ? 1 / rng[c] : 0;
      }
    }
    this.stats.validFrac = validCount / n;
  }

  /** Cells (grid coords) to force to "lit", e.g. under an on-screen debug panel. */
  setIgnore(rects) {
    if (!rects || !rects.length) { this.ignore = null; return; }
    this.ignore = new Uint8Array(this.n);
    for (const r of rects) {
      for (let j = Math.max(0, r.y | 0); j < Math.min(this.gh, (r.y + r.h) | 0); j++) {
        for (let i = Math.max(0, r.x | 0); i < Math.min(this.gw, (r.x + r.w) | 0); i++) this.ignore[j * this.gw + i] = 1;
      }
    }
  }

  /** Classify one RGBA camera frame. Returns the (shared) mask: 1 = shadow. */
  detect(d) {
    const { n, base, amb, inv, valid, lit, cw, gw, gh } = this;
    const L = SRGB_TO_LIN;
    const stride = cw * 4;
    const bins = new Uint16Array(64);
    let validN = 0;
    for (let k = 0; k < n; k++) {
      if (!valid[k]) { lit[k] = 1; continue; }
      const o = base[k] * 4, o2 = o + stride, k3 = k * 3;
      const r = (L[d[o]] + L[d[o + 4]] + L[d[o2]] + L[d[o2 + 4]]) * 0.25;
      const g = (L[d[o + 1]] + L[d[o + 5]] + L[d[o2 + 1]] + L[d[o2 + 5]]) * 0.25;
      const b = (L[d[o + 2]] + L[d[o + 6]] + L[d[o2 + 2]] + L[d[o2 + 6]]) * 0.25;
      let v = (r - amb[k3]) * inv[k3];
      const vg = (g - amb[k3 + 1]) * inv[k3 + 1];
      const vb = (b - amb[k3 + 2]) * inv[k3 + 2];
      if (vg > v) v = vg;
      if (vb > v) v = vb;
      lit[k] = v;
      bins[Math.max(0, Math.min(63, (v * 32) | 0))]++;
      validN++;
    }
    // Auto-exposure compensation: the brightest-but-one-in-seven cells should read ~1.0.
    if (validN > 50) {
      let acc = 0, q = 0;
      const target = validN * 0.85;
      for (let b = 0; b < 64; b++) { acc += bins[b]; if (acc >= target) { q = (b + 0.5) / 32; break; } }
      if (q > 0.5 && q < 1.8) this.gain += (q - this.gain) * 0.3;
    }
    const g = 1 / this.gain;
    const { state, pending, onT, offT } = this;
    let shadow = 0;
    for (let k = 0; k < n; k++) {
      if (!valid[k]) { state[k] = 0; continue; }
      const v = lit[k] * g;
      const raw = state[k] ? (v > offT ? 0 : 1) : (v < onT ? 1 : 0);
      if (raw === state[k]) pending[k] = 0;
      else if (++pending[k] >= 2) { state[k] = raw; pending[k] = 0; }
    }
    // despeckle / fill pinholes
    const out = this.mask;
    for (let j = 0; j < gh; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < gh - 1 ? j + 1 : j;
      for (let i = 0; i < gw; i++) {
        const im = i > 0 ? i - 1 : i, ip = i < gw - 1 ? i + 1 : i;
        const c = state[jm * gw + im] + state[jm * gw + i] + state[jm * gw + ip] +
          state[j * gw + im] + state[j * gw + ip] +
          state[jp * gw + im] + state[jp * gw + i] + state[jp * gw + ip];
        const k = j * gw + i;
        const s = state[k] ? (c >= 2 ? 1 : 0) : (c >= 7 ? 1 : 0);
        out[k] = this.ignore && this.ignore[k] ? 0 : s;
        shadow += out[k];
      }
    }
    this.stats.gain = this.gain;
    this.stats.coverage = shadow / n;
    return out;
  }
}
