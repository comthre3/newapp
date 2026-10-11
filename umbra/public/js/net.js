// Client-side link to the relay server.
//
// A "transport" here is anything that can: connect(), send(obj), and call back onMessage(obj) /
// onStatus('connecting' | 'open' | 'closed'). This file provides the WebSocket one. A Bluetooth LE
// transport could implement the same three things from a native wrapper (browsers can only act as
// BLE *clients*, never as the peripheral a phone would need to connect to — see README).

export function makeToken() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'u' + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('');
}

export function persistentToken(key) {
  try {
    let t = localStorage.getItem(key);
    if (!t) { t = makeToken(); localStorage.setItem(key, t); }
    return t;
  } catch {
    return makeToken();
  }
}

export class Link {
  /** @param params object | () => object   query params for /ws */
  constructor(params, { onMessage, onStatus } = {}) {
    this.params = params;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.retry = 0;
    this.stopped = false;
    this.timer = null;
  }

  url() {
    const p = typeof this.params === 'function' ? this.params() : this.params;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?${new URLSearchParams(p)}`;
  }

  connect() {
    if (this.stopped) return;
    this.onStatus('connecting');
    let ws;
    try { ws = new WebSocket(this.url()); } catch { this.schedule(); return; }
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.onStatus('open'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.onStatus('closed');
      this.schedule();
    };
    ws.onerror = () => {};
  }

  schedule() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), Math.min(5000, 400 * 2 ** this.retry++));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.ws) this.ws.close();
  }
}

/** Keep the screen awake (host and controllers). Best effort. */
export async function keepAwake() {
  try {
    if (!('wakeLock' in navigator)) return;
    let lock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) {
        try { lock = await navigator.wakeLock.request('screen'); } catch { /* denied */ }
      }
    });
  } catch { /* not supported / denied */ }
}
