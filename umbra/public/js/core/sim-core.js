// A software "camera + wall" so the whole vision pipeline can be exercised without hardware.
// It takes the image the projector is showing, warps it into a keystoned camera view, applies
// shadows from virtual objects, ambient light, vignetting, sensor noise and sRGB encoding.
// Used by the in-browser simulator (laptop play / demos) and by the unit tests.

import { SRGB_TO_LIN, encodeLinear, solveHomography, invertH, applyH, UNIT_SQUARE } from './vision-core.js';

export const DEFAULT_QUAD = { tl: [0.15, 0.12], tr: [0.88, 0.17], br: [0.91, 0.86], bl: [0.1, 0.82] };

export function createSimCamera({
  cw = 640, ch = 360, quad = DEFAULT_QUAD, ambient = 0.05, noise = 0.004, vignette = 0.2,
  albedo = [0.92, 0.95, 0.9], leak = 0.03, seed = 1,
} = {}) {
  const px = (p) => [p[0] * cw, p[1] * ch];
  const camCorners = { tl: px(quad.tl), tr: px(quad.tr), br: px(quad.br), bl: px(quad.bl) };
  const toCam = solveHomography(UNIT_SQUARE, [camCorners.tl, camCorners.tr, camCorners.br, camCorners.bl]);
  const fromCam = invertH(toCam);
  const uv = new Float32Array(cw * ch * 2);
  const vig = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const [u, v] = applyH(fromCam, x + 0.5, y + 0.5);
      const i = y * cw + x;
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      const dx = x / cw - 0.5, dy = y / ch - 0.5;
      vig[i] = 1 - vignette * (dx * dx + dy * dy) * 4;
    }
  }
  let rng = seed >>> 0 || 1;
  const rand = () => { rng ^= rng << 13; rng >>>= 0; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0; return rng / 4294967296; };

  return {
    cw, ch, cornersPx: camCorners,
    /**
     * @param proj     RGBA of what the projector shows (pw x ph)
     * @param objAlpha optional Uint8 pw*ph, 255 where a physical object blocks the beam
     * @param out      RGBA Uint8ClampedArray cw*ch*4
     * @param gain     global exposure multiplier (auto-exposure drift)
     */
    render(proj, pw, ph, objAlpha, out, gain = 1) {
      const amb = ambient;
      for (let i = 0; i < cw * ch; i++) {
        const u = uv[i * 2], v = uv[i * 2 + 1];
        const o = i * 4;
        const vg = vig[i] * gain;
        if (u < 0 || v < 0 || u >= 1 || v >= 1) {
          for (let c = 0; c < 3; c++) out[o + c] = encodeLinear((amb * 0.8 * albedo[c] + (rand() - 0.5) * 2 * noise) * vg);
          out[o + 3] = 255;
          continue;
        }
        const pxi = ((v * ph) | 0) * pw + ((u * pw) | 0);
        const shade = objAlpha ? 1 - (objAlpha[pxi] / 255) * (1 - leak) : 1;
        for (let c = 0; c < 3; c++) {
          const light = SRGB_TO_LIN[proj[pxi * 4 + c]] * shade;
          out[o + c] = encodeLinear(((light + amb) * albedo[c] + (rand() - 0.5) * 2 * noise) * vg);
        }
        out[o + 3] = 255;
      }
      return out;
    },
  };
}
