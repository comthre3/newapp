// Calibration: flash the projector black, then white, and record what the camera sees.
import { averageFrames, analyzeCalibration, CALIBRATION_ERRORS } from '../core/vision-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param stage    Stage (flatColor is set to flood the whole projection)
 * @param camera   CameraSource | SimCamera
 * @param opts.speed  1 = normal, <1 = faster (tests / simulator)
 * @param opts.onStep (label) => void
 * @returns { ok, result, black, white, snapshot (RGBA of the white frame), cw, ch }
 */
export async function runCalibration(stage, camera, { speed = 1, onStep = () => {} } = {}) {
  const cw = camera.width, ch = camera.height;
  const grab = async (color, settleMs, frames) => {
    stage.flatColor = color;
    await sleep(settleMs * speed);
    const out = [];
    for (let i = 0; i < frames; i++) {
      out.push(new Uint8ClampedArray(camera.getFrame()));
      await sleep(70 * Math.max(0.25, speed));
    }
    return out;
  };
  try {
    onStep('Measuring the room (projector dark)…');
    const blackFrames = await grab('#000000', 1400, 7);
    onStep('Measuring the beam (projector bright)…');
    const whiteFrames = await grab('#ffffff', 1600, 7);
    await camera.lockExposure();
    const black = averageFrames(blackFrames, cw, ch);
    const white = averageFrames(whiteFrames, cw, ch);
    const result = analyzeCalibration(black, white, cw, ch);
    return { ok: result.ok, result, message: result.ok ? '' : CALIBRATION_ERRORS[result.error] || 'Calibration failed.', black, white, snapshot: whiteFrames[whiteFrames.length - 1], cw, ch };
  } finally {
    stage.flatColor = null;
  }
}
