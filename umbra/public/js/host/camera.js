// The real phone camera. Same interface as SimCamera: start(), getFrame(), lockExposure(), stop(),
// plus width/height of the frames it produces.
export class CameraSource {
  constructor({ longEdge = 640 } = {}) {
    this.longEdge = longEdge;
    this.width = 0;
    this.height = 0;
    this.kind = 'camera';
    this.stream = null;
    this.video = null;
    this.locked = false;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(window.isSecureContext
        ? 'This browser has no camera support.'
        : 'Camera access needs https:// (or localhost). Open this page through an https link.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.srcObject = this.stream;
    await v.play();
    for (let i = 0; i < 100 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    if (!v.videoWidth) throw new Error('The camera did not produce any picture.');
    this.video = v;
    const landscape = v.videoWidth >= v.videoHeight;
    const k = this.longEdge / Math.max(v.videoWidth, v.videoHeight);
    this.width = Math.round(v.videoWidth * k);
    this.height = Math.round(v.videoHeight * k);
    if (!landscape) { /* portrait camera: frame is tall, the maths does not care */ }
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
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

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
