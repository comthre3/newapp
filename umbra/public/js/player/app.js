// Umbra controller: runs on every other phone.
import { Link, persistentToken, keepAwake } from '../net.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

let room = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
let name = '';
try { name = localStorage.getItem('umbra.name') || ''; } catch { /* private mode */ }
const token = persistentToken('umbra.playerToken');
let link = null;
let state = null;
let meColor = '#ff2f92';

const ANIMALS = ['Fox', 'Owl', 'Lynx', 'Newt', 'Moth', 'Crow', 'Wolf', 'Hare', 'Swan', 'Orca', 'Kiwi', 'Yak'];
const randomName = () => `${ANIMALS[(Math.random() * ANIMALS.length) | 0]} ${(Math.random() * 90 + 10) | 0}`;

function show(id, on = true) { $(id).hidden = !on; }

// ------------------------------------------------------------------ join form
function showJoin(err = '') {
  show('#join'); show('#bar', false); show('#banner', false); show('#pad', false); show('#foot', false);
  $('#in-room').value = room;
  $('#in-name').value = name || randomName();
  $('#join-err').textContent = err;
}

function submitJoin() {
  const r = $('#in-room').value.toUpperCase().replace(/[^A-Z]/g, '');
  if (r.length !== 4) { $('#join-err').textContent = 'Enter the 4-letter code from the projector.'; return; }
  room = r;
  name = $('#in-name').value.trim().slice(0, 16) || randomName();
  try { localStorage.setItem('umbra.name', name); } catch { /* ignore */ }
  history.replaceState(null, '', `?room=${room}`);
  connect();
}

// ------------------------------------------------------------------ connection
function connect() {
  show('#join', false); show('#bar'); show('#banner'); show('#pad'); show('#foot');
  $('#who').textContent = name;
  $('#room').textContent = room;
  if (link) link.close();
  link = new Link(() => ({ role: 'player', room, token, name }), {
    onMessage,
    onStatus: (s) => {
      const c = $('#conn');
      c.textContent = s === 'open' ? 'online' : s === 'connecting' ? 'connecting' : 'offline';
      c.className = 'pill ' + (s === 'open' ? 'ok' : s === 'closed' ? 'bad' : '');
      if (s === 'open') resendHeld();
    },
  });
  link.connect();
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      meColor = m.color;
      document.body.style.setProperty('--me', meColor);
      $('#dot').style.background = meColor;
      if (!m.host) $('#role').textContent = 'Waiting for the host to come back…';
      break;
    case 'host':
      if (!m.up) { $('#role').textContent = 'Host disconnected — waiting…'; $('#roledesc').textContent = ''; }
      break;
    case 'err':
      link.close();
      link = null;
      showJoin(m.msg === 'opened elsewhere' ? 'This controller was opened on another tab.' : m.msg);
      break;
    case 'm':
      if (m.m.vib && navigator.vibrate) { try { navigator.vibrate(m.m.vib); } catch { /* unsupported */ } }
      if (m.m.phase) applyState(m.m);
      break;
    default:
  }
}

// ------------------------------------------------------------------ rendering state
function applyState(s) {
  state = s;
  const lobby = s.phase === 'lobby';
  const gmNeeded = s.canGravity && s.phase !== 'lobby';
  const banner = $('#banner');
  banner.classList.toggle('gm', s.gm && gmNeeded);

  if (lobby) {
    $('#role').textContent = 'You are in!';
    $('#roledesc').textContent = 'Waiting for the host to start the game.';
  } else if (s.phase === 'clear') {
    $('#role').textContent = 'Level clear! 🎉';
    $('#roledesc').textContent = `★ ${s.stars}/${s.totalStars}`;
  } else if (s.phase === 'pause') {
    $('#role').textContent = 'Paused';
    $('#roledesc').textContent = '';
  } else if (gmNeeded && s.gm) {
    $('#role').textContent = `${s.level.name} — Gravity Master`;
    $('#roledesc').textContent = 'You flip gravity with the D-pad. Call it out loud!';
  } else if (gmNeeded) {
    $('#role').textContent = `${s.level.name}`;
    $('#roledesc').textContent = `${s.gmName || 'Someone'} controls gravity. You push the orb.`;
  } else {
    $('#role').textContent = s.level.name;
    $('#roledesc').textContent = s.level.hint;
  }

  show('#gravity', gmNeeded && s.gm && s.phase === 'play');
  document.querySelectorAll('#gravity [data-g]').forEach((b) => {
    const g = s.gravity || [0, 1];
    const on = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] })[b.dataset.g];
    b.classList.toggle('on', on[0] === g[0] && on[1] === g[1]);
  });

  const sw = $('#switches');
  sw.textContent = '';
  for (const x of s.switches || []) {
    const b = document.createElement('button');
    b.textContent = `${x.label}: ${x.on ? 'ON' : 'off'}`;
    b.className = x.on ? 'on' : '';
    b.onclick = () => { send('sw', x.key); buzzLocal(12); };
    sw.append(b);
  }
  show('#switches', (s.switches || []).length > 0 && s.phase === 'play');

  const vertical = s.axis === 'v';
  $('#n-neg').textContent = vertical ? '▲' : '◀';
  $('#n-pos').textContent = vertical ? '▼' : '▶';
  show('#nudge', s.phase === 'play');

  show('#f-reset', s.phase === 'play');
  show('#f-spawn', s.phase === 'play' && s.canSpawn);
  show('#f-next', s.phase === 'clear' || (s.phase === 'play' && s.level.sandbox));
  $('#f-next').textContent = s.level.sandbox ? 'Start puzzles ▶' : 'Next level ▶';
}

// ------------------------------------------------------------------ input
function send(k, v) { if (link) link.send({ t: 'in', k, v }); }
const buzzLocal = (ms) => { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* unsupported */ } } };

const held = { neg: false, pos: false };
let heldTimer = 0;
const nudgeValue = () => (held.pos ? 1 : 0) - (held.neg ? 1 : 0);
function resendHeld() { send('nudge', nudgeValue()); }

function bindHold(id, key) {
  const el = $(id);
  const down = (e) => {
    e.preventDefault();
    held[key] = true;
    el.classList.add('down');
    buzzLocal(8);
    resendHeld();
    clearInterval(heldTimer);
    heldTimer = setInterval(resendHeld, 250);       // keep-alive so the host can time out lost releases
  };
  const up = (e) => {
    e.preventDefault();
    held[key] = false;
    el.classList.remove('down');
    resendHeld();
    if (!held.neg && !held.pos) clearInterval(heldTimer);
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); down(e); });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', (e) => { if (held[key]) up(e); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function init() {
  keepAwake();
  bindHold('#n-neg', 'neg');
  bindHold('#n-pos', 'pos');
  document.querySelectorAll('#gravity [data-g]').forEach((b) => { b.onclick = () => { send('grav', b.dataset.g); buzzLocal(15); }; });
  $('#f-reset').onclick = () => send('reset', 1);
  $('#f-spawn').onclick = () => send('spawn', 1);
  $('#f-next').onclick = () => send('next', 1);
  $('#btn-join').onclick = submitJoin;
  $('#in-room').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });
  $('#in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { held.neg = held.pos = false; resendHeld(); } });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  if (room.length === 4 && name) connect();
  else if (room.length === 4) { name = randomName(); showJoin(); $('#in-name').focus(); }
  else showJoin();
}

init();
window.__umbraPlayer = { get state() { return state; } };
