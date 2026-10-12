// Connectivity probe, phone side: ping the host through the relay five times a second and report
// the round-trip time (median and worst) once a second. The host decides what counts as a stall.
// The host starts and ends the probe ({probe:'start'|'done'}), so the page does not ping forever.
import { Link, persistentToken, keepAwake } from '../net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const name = `P0-${(Math.random() * 90 + 10) | 0}`;
const token = persistentToken('umbra.p0.phone');

const pending = new Map();      // seq -> send time (ms); only pings that were really sent
const samples = [];             // { at, rtt } completed round trips
let seq = 0, stallSeconds = 0, seconds = 0, worstEver = 0, failed = false, active = false;   // pings only while the host says a probe is running
let opened = false, offlineSince = null, outageMs = 0;      // a dropped socket is reported once, as its own length
let lastReport = performance.now();

$('#room').textContent = room || '----';
$('#who').textContent = name;

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function showDone() {
  $('#rtt').textContent = '✓';
  $('#rtt').style.color = '#00e676';
  $('#detail').textContent = seconds ? `Test finished.\nslow seconds: ${stallSeconds} of ${seconds}\nworst: ${worstEver} ms\nYou can close this page.` : 'No test is running. You can close this page.';
}

const link = new Link(() => ({ role: 'player', room, token, name }), {
  onMessage: (m) => {
    if (m.t === 'welcome') $('#dot').style.background = m.color;
    else if (m.t === 'err') { failed = true; $('#conn').textContent = m.msg; $('#conn').className = 'pill bad'; link.close(); }
    else if (m.t === 'm' && m.m && typeof m.m.pong === 'number') {
      const sent = pending.get(m.m.pong);
      if (sent !== undefined) { pending.delete(m.m.pong); samples.push({ at: performance.now(), rtt: performance.now() - sent }); }
    } else if (m.t === 'm' && m.m && m.m.probe === 'done') { active = false; showDone(); }
    else if (m.t === 'm' && m.m && m.m.probe === 'start') { active = true; pending.clear(); samples.length = 0; stallSeconds = 0; seconds = 0; worstEver = 0; lastReport = performance.now(); }
  },
  onStatus: (s) => {
    if (s === 'open') {
      if (offlineSince !== null) { outageMs = Math.max(outageMs, performance.now() - offlineSince); offlineSince = null; pending.clear(); }
      opened = true;
    } else if (opened && offlineSince === null) offlineSince = performance.now();
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
  $('#detail').textContent = 'Waiting for the big screen to start the test…';
  // plain http (a LAN address) cannot hold a wake lock: say so, because a locked phone stops answering
  if (!('wakeLock' in navigator)) $('#wakewarn').hidden = false;
  link.connect();
  document.addEventListener('visibilitychange', () => link.send({ t: 'in', k: 'hid', v: document.hidden }));

  setInterval(() => {
    if (!active) return;
    seq = (seq + 1) % 10000;
    if (link.send({ t: 'in', k: 'ping', v: seq })) pending.set(seq, performance.now());   // a ping that never left cannot be "slow"
  }, 200);

  setInterval(() => {
    if (!active) return;
    const now = performance.now();
    const gap = Math.max(0, Math.round(now - lastReport - 1000));       // how late this timer fired: a sleeping page fires late
    lastReport = now;
    while (samples.length && now - samples[0].at > 1000) samples.shift();
    for (const [k, t] of pending) if (now - t > 5000) pending.delete(k);
    const rtts = samples.map((s) => s.rtt);
    // unanswered pings count as "at least this slow", so a stall shows up before any reply arrives
    for (const t of pending.values()) if (now - t > 300) rtts.push(now - t);
    const answered = samples.length > 0;
    const med = answered ? Math.round(median(samples.map((s) => s.rtt))) : 9999;
    let max = rtts.length ? Math.min(9999, Math.round(Math.max(...rtts))) : 9999;
    if (outageMs > 0) { max = Math.max(max === 9999 ? 0 : max, Math.min(9999, Math.round(outageMs))); outageMs = 0; }   // the socket was down this long
    link.send({ t: 'in', k: 'rtt', v: med });
    link.send({ t: 'in', k: 'hid', v: document.hidden });
    link.send({ t: 'in', k: 'gap', v: Math.min(gap, 60000) });
    link.send({ t: 'in', k: 'rttmax', v: max });
    seconds++;
    if (max > 500) stallSeconds++;
    worstEver = Math.max(worstEver, max === 9999 ? worstEver : max);
    $('#rtt').textContent = answered ? String(med) : '…';
    $('#rtt').style.color = max > 500 ? '#ff6b6b' : '#00e676';
    $('#detail').textContent = `worst in the last second: ${max === 9999 ? 'no reply' : `${max} ms`}\nslow seconds so far: ${stallSeconds} of ${seconds}\nworst overall: ${worstEver} ms`;
  }, 1000);
}
