// The real phone camera. Same interface as SimCamera: start(), getFrame(), lockExposure(), stop(),
// plus width/height of the frames it produces.
export class CameraSource {
  /** @param deviceId  optional: a specific camera (a USB webcam, say) instead of the rear camera */
  constructor({ longEdge = 640, deviceId = null } = {}) {
    this.longEdge = longEdge;
    this.deviceId = deviceId;
    this.width = 0;
    this.height = 0;
    this.kind = 'camera';
    this.stream = null;
    this.video = null;
    this.locked = false;
    this.fs = null;
  }

  /** Cameras the browser can see (labels are only filled in after permission has been granted). */
  static async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(window.isSecureContext
        ? 'This browser has no camera support.'
        : 'Camera access needs https:// (or localhost). Open this page through an https link.');
    }
    const size = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: this.deviceId ? { deviceId: { exact: this.deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
    });
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.srcObject = this.stream;
    await v.play();
    for (let i = 0; i < 100 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    if (!v.videoWidth) throw new Error('The camera did not produce any picture.');
    this.video = v;
    const k = this.longEdge / Math.max(v.videoWidth, v.videoHeight);
    this.width = Math.round(v.videoWidth * k);
    this.height = Math.round(v.videoHeight * k);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    const track = this.stream.getVideoTracks()[0];
    this.ended = false;
    if (track) track.addEventListener('ended', () => { this.ended = true; });
    this.startFrameStats();
    return this;
  }

  getFrame() {
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    return this.ctx.getImageData(0, 0, this.width, this.height).data;
  }

  /** Freeze exposure / white balance where the browser allows it (Chrome on Android mostly). */
  async lockExposure() {
    try {
      const track = this.stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const s = track.getSettings ? track.getSettings() : {};
      const adv = {};
      if (caps.exposureMode && caps.exposureMode.includes('manual')) {
        adv.exposureMode = 'manual';
        if (s.exposureTime) adv.exposureTime = s.exposureTime;
        if (s.iso) adv.iso = s.iso;
      }
      if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual')) {
        adv.whiteBalanceMode = 'manual';
        if (s.colorTemperature) adv.colorTemperature = s.colorTemperature;
      }
      if (!Object.keys(adv).length) return false;
      await track.applyConstraints({ advanced: [adv] });
      this.locked = true;
      return true;
    } catch {
      return false;
    }
  }

  /** What the browser reports about the camera: for diagnostics only. */
  describe() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track) return null;
    const s = track.getSettings ? track.getSettings() : {};
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    return {
      label: track.label,
      width: s.width, height: s.height, frameRate: s.frameRate, facingMode: s.facingMode,
      exposureMode: s.exposureMode, whiteBalanceMode: s.whiteBalanceMode,
      canLockExposure: !!(caps.exposureMode && caps.exposureMode.includes('manual')),
      canLockWhiteBalance: !!(caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual')),
      exposureLocked: this.locked,
    };
  }

  /** Measure the camera's real frame rate and (where the browser exposes it) capture-to-app delay. */
  startFrameStats() {
    const v = this.video;
    this.fs = { times: [], lat: [], hasCaptureTime: false, supported: !!(v && v.requestVideoFrameCallback) };
    if (!this.fs.supported) return;
    const fs = this.fs;
    const cb = (now, meta) => {
      fs.times.push(now);
      if (fs.times.length > 300) fs.times.shift();
      if (meta && typeof meta.captureTime === 'number') {
        fs.hasCaptureTime = true;
        fs.lat.push(now - meta.captureTime);
        if (fs.lat.length > 300) fs.lat.shift();
      }
      fs.lastAt = performance.now();
      if (this.fs === fs && this.video) this.video.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }

  /** { ok, reason }: false when the camera stopped, was unplugged, or stopped delivering frames. */
  health() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || this.ended || track.readyState === 'ended') return { ok: false, reason: 'the camera stopped or was unplugged' };
    const fs = this.fs;
    if (fs && fs.supported && fs.lastAt && performance.now() - fs.lastAt > 1500 && !(this.video && this.video.paused)) return { ok: false, reason: 'the camera stopped delivering pictures' };
    return { ok: true, reason: '' };
  }

  frameStats() {
    const fs = this.fs;
    if (!fs || !fs.supported) return { supported: false };
    const n = fs.times.length;
    const fps = n > 2 ? ((n - 1) / (fs.times[n - 1] - fs.times[0])) * 1000 : null;
    const lat = [...fs.lat].sort((a, b) => a - b);
    const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : null);
    return { supported: true, fps, frames: n, hasCaptureTime: fs.hasCaptureTime, captureLatencyMedianMs: q(50), captureLatencyP95Ms: q(95) };
  }

  stop() {
    this.fs = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
