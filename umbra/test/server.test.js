import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createUmbraServer, MAX_PLAYERS } from '../server.js';

let app, port;
before(async () => { app = createUmbraServer(); port = await app.listen(0, '127.0.0.1'); });
after(async () => { await app.close(); });

const tok = () => 'tok_' + Math.random().toString(36).slice(2, 12);

/** WebSocket client with an inbox you can await on. */
function client(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams(query)}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else inbox.push(m);
  });
  const closed = new Promise((r) => ws.on('close', r));
  return {
    ws, closed,
    open: new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next(pred = () => true, ms = 1500) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout waiting for message')); } }, ms);
      });
    },
    inbox,
  };
}

async function newRoom() {
  const host = client({ role: 'host', token: tok() });
  const { code } = await host.next((m) => m.t === 'room');
  return { host, code };
}

test('host gets a 4-letter room code', async () => {
  const { host, code } = await newRoom();
  assert.match(code, /^[A-HJ-NP-Z]{4}$/);
  host.ws.close();
});

test('players join, host is told, inputs and host messages are relayed', async () => {
  const { host, code } = await newRoom();
  const a = client({ role: 'player', room: code, token: tok(), name: 'Ann' });
  const welcome = await a.next((m) => m.t === 'welcome');
  assert.equal(welcome.id, 1);
  assert.equal(welcome.host, true);
  const join = await host.next((m) => m.t === 'join');
  assert.deepEqual([join.id, join.name], [1, 'Ann']);

  const b = client({ role: 'player', room: code.toLowerCase(), token: tok(), name: 'Bo' });
  assert.equal((await b.next((m) => m.t === 'welcome')).id, 2);
  assert.equal((await host.next((m) => m.t === 'join')).id, 2);

  a.send({ t: 'in', k: 'nudge', v: -1 });
  assert.deepEqual(await host.next((m) => m.t === 'in'), { t: 'in', id: 1, k: 'nudge', v: -1 });

  host.send({ t: 'to', id: 2, m: { hello: 'bo' } });
  assert.deepEqual((await b.next((m) => m.t === 'm')).m, { hello: 'bo' });
  host.send({ t: 'all', m: { level: 3 } });
  assert.deepEqual((await a.next((m) => m.t === 'm')).m, { level: 3 });
  assert.deepEqual((await b.next((m) => m.t === 'm')).m, { level: 3 });
  assert.equal(a.inbox.filter((m) => m.t === 'm').length, 0, 'targeted message must not leak to player 1');
  [host, a, b].forEach((c) => c.ws.close());
});

test('unknown room is refused', async () => {
  const c = client({ role: 'player', room: 'ZZZZ', token: tok(), name: 'X' });
  assert.equal((await c.next((m) => m.t === 'err')).msg, 'Room not found');
  await c.closed;
});

test('a returning player keeps the same id, host is told it is a reconnect', async () => {
  const { host, code } = await newRoom();
  const token = tok();
  const first = client({ role: 'player', room: code, token, name: 'Cy' });
  const id = (await first.next((m) => m.t === 'welcome')).id;
  await host.next((m) => m.t === 'join');
  first.ws.close();
  assert.equal((await host.next((m) => m.t === 'leave')).id, id);
  const again = client({ role: 'player', room: code, token, name: 'Cy' });
  assert.equal((await again.next((m) => m.t === 'welcome')).id, id);
  const j = await host.next((m) => m.t === 'join');
  assert.equal(j.reconnect, true);
  host.ws.close(); again.ws.close();
});

test('host reload with the same token keeps the room and re-announces players', async () => {
  const token = tok();
  const h1 = client({ role: 'host', token });
  const { code } = await h1.next((m) => m.t === 'room');
  const p = client({ role: 'player', room: code, token: tok(), name: 'Di' });
  await p.next((m) => m.t === 'welcome');
  h1.ws.close();
  assert.equal((await p.next((m) => m.t === 'host')).up, false);
  const h2 = client({ role: 'host', token, room: code });
  assert.equal((await h2.next((m) => m.t === 'room')).code, code);
  assert.equal((await h2.next((m) => m.t === 'join')).name, 'Di');
  assert.equal((await p.next((m) => m.t === 'host')).up, true);
  h2.ws.close(); p.ws.close();
});

test('someone else cannot hijack a room by guessing its code', async () => {
  const { host, code } = await newRoom();
  const thief = client({ role: 'host', token: tok(), room: code });
  const r = await thief.next((m) => m.t === 'room');
  assert.notEqual(r.code, code);
  host.ws.close(); thief.ws.close();
});

test('room caps at MAX_PLAYERS and names are sanitised', async () => {
  const { host, code } = await newRoom();
  const ps = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = client({ role: 'player', room: code, token: tok(), name: i === 0 ? '<img onerror=x>\u0007Evil name that is far too long' : 'P' + i });
    await p.next((m) => m.t === 'welcome');
    ps.push(p);
  }
  const first = await host.next((m) => m.t === 'join');
  assert.ok(!/[<>]/.test(first.name) && first.name.length <= 16, first.name);
  const extra = client({ role: 'player', room: code, token: tok(), name: 'late' });
  assert.equal((await extra.next((m) => m.t === 'err')).msg, 'Room is full');
  [host, ...ps].forEach((c) => c.ws.close());
});

test('junk input is dropped and never reaches the host', async () => {
  const { host, code } = await newRoom();
  const p = client({ role: 'player', room: code, token: tok(), name: 'Ed' });
  await p.next((m) => m.t === 'welcome');
  await host.next((m) => m.t === 'join');
  p.ws.send('not json');
  p.send({ t: 'in', k: 'x'.repeat(40), v: 1 });
  p.send({ t: 'in', k: 'nudge', v: { evil: true } });
  p.send({ t: 'to', id: 1, m: {} });
  p.send({ t: 'in', k: 'ok', v: 1 });
  const got = await host.next((m) => m.t === 'in');
  assert.equal(got.k, 'ok');
  assert.equal(host.inbox.filter((m) => m.t === 'in').length, 0);
  host.ws.close(); p.ws.close();
});

test('a flooding client is rate limited', async () => {
  const { host, code } = await newRoom();
  const p = client({ role: 'player', room: code, token: tok(), name: 'Flo' });
  await p.next((m) => m.t === 'welcome');
  await host.next((m) => m.t === 'join');
  for (let i = 0; i < 1000; i++) p.send({ t: 'in', k: 'nudge', v: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const n = host.inbox.filter((m) => m.t === 'in').length;
  assert.ok(n < 400, `delivered ${n} of 1000`);
  host.ws.close(); p.ws.close();
});

test('static files: pages are served, path traversal is blocked', async () => {
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/..%2f..%2fserver.js`)).status, 403);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 403);
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
});

test('/api/info lists LAN addresses (used for the QR code when the host page is on localhost)', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/info`);
  assert.equal(res.status, 200);
  const { lan } = await res.json();
  assert.ok(Array.isArray(lan));
  for (const u of lan) assert.match(u, new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${port}$`));
});
