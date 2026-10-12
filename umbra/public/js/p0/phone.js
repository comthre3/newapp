// Connectivity probe, phone side: ping the host through the relay five times a second and report
// the round-trip time (median and worst) once a second. The host decides what counts as a stall.
import { Link, persistentToken, keepAwake } from '../net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const name = `P0-${(Math.random() * 90 + 10) | 0}`;
const token = persistentToken('umbra.p0.phone');

const pending = new Map();      // seq -> send time (ms)
const samples = [];             // { at, rtt } completed round trips
let seq = 0, stallSeconds = 0, seconds = 0, worstEver = 0, failed = false;

$('#room').textContent = room || '----';
$('#who').textContent = name;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

const link = new Link(() => ({ role: 'player', room, token, name }), {
  onMessage: (m) => {
    if (m.t === 'welcome') $('#dot').style.background = m.color;
    else if (m.t === 'err') { failed = true; $('#conn').textContent = m.msg; $('#conn').className = 'pill bad'; link.close(); }
    else if (m.t === 'm' && m.m && typeof m.m.pong === 'number') {
      const sent = pending.get(m.m.pong);
      if (sent !== undefined) { pending.delete(m.m.pong); samples.push({ at: performance.now(), rtt: performance.now() - sent }); }
    }
  },
  onStatus: (s) => {
    if (failed) return;                // keep the reason ("Room not found") on screen
    const c = $('#conn');
    c.textContent = s === 'open' ? 'online' : s === 'connecting' ? 'connecting' : 'offline';
    c.className = 'pill ' + (s === 'open' ? 'ok' : s === 'closed' ? 'bad' : '');
  },
});

if (!room) {
  $('#conn').textContent = 'no room';
  $('#detail').textContent = 'Scan the QR code on the big screen.';
} else {
  keepAwake();
  link.connect();
  setInterval(() => {
    seq = (seq + 1) % 10000;
    pending.set(seq, performance.now());
    link.send({ t: 'in', k: 'ping', v: seq });
  }, 200);

  setInterval(() => {
    const now = performance.now();
    while (samples.length && now - samples[0].at > 1000) samples.shift();
    for (const [k, t] of pending) if (now - t > 5000) pending.delete(k);
    const rtts = samples.map((s) => s.rtt);
    // unanswered pings count as "at least this slow", so a stall shows up before any reply arrives
    for (const t of pending.values()) if (now - t > 300) rtts.push(now - t);
    const answered = samples.length > 0;
    const med = answered ? Math.round(median(samples.map((s) => s.rtt))) : 9999;
    const max = rtts.length ? Math.min(9999, Math.round(Math.max(...rtts))) : 9999;
    link.send({ t: 'in', k: 'rtt', v: med });
    link.send({ t: 'in', k: 'rttmax', v: max });
    seconds++;
    if (max > 500) stallSeconds++;
    worstEver = Math.max(worstEver, max === 9999 ? worstEver : max);
    $('#rtt').textContent = answered ? String(med) : '…';
    $('#rtt').style.color = max > 500 ? '#ff6b6b' : '#00e676';
    $('#detail').textContent = `worst in the last second: ${max === 9999 ? 'no reply' : `${max} ms`}\nslow seconds so far: ${stallSeconds} of ${seconds}\nworst overall: ${worstEver} ms`;
  }, 1000);
}
