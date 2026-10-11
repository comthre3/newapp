// Umbra relay server: serves the static game and relays messages between the host phone
// (camera + projector) and the controller phones, Jackbox-style, using 4-letter room codes.
//
//   npm start                      → http://localhost:3000
//   PORT=8080 npm start            → custom port
//   TLS_KEY=key.pem TLS_CERT=cert.pem npm start   → https/wss (phones need https for camera access)
//
// The wire protocol is documented in README.md ("Protocol").

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

export const COLORS = ['#ff3b6b', '#ff9f0a', '#ffd60a', '#30d158', '#00c7be', '#0a84ff', '#bf5af2', '#ff6bd6'];
export const MAX_PLAYERS = COLORS.length;
const MAX_ROOMS = 200;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const RESERVE_MS = 5 * 60 * 1000;      // keep a dropped player's slot this long
const HOST_GRACE_MS = 10 * 60 * 1000;  // keep a room alive this long without a host

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';
const cleanToken = (s) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(s || '')) ? String(s) : null);
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

export function createUmbraServer({ tls = null } = {}) {
  const rooms = new Map();

  // ------------------------------------------------------------------ static files
  const handler = (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('bad request'); return; }
    if (pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return; }
    if (pathname === '/api/info') {
      // lets a host page opened on localhost build a QR code phones can actually reach
      const port = server.address() && server.address().port;
      const lan = [];
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) if (n.family === 'IPv4' && !n.internal) lan.push(`${tls ? 'https' : 'http'}://${n.address}:${port}`);
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ lan }));
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/host') pathname = '/host.html';
    if (pathname === '/play') pathname = '/play.html';
    const full = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403).end('forbidden'); return; }
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        // the host page needs the camera; nothing else
        'permissions-policy': 'camera=(self), microphone=()',
      });
      fs.createReadStream(full).pipe(res);
    });
  };

  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, url.searchParams));
  });

  // ------------------------------------------------------------------ rooms
  function newCode() {
    for (let tries = 0; tries < 200; tries++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
      if (!rooms.has(c)) return c;
    }
    return null;
  }

  function onConnect(ws, q) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    // token bucket: 100 msgs/s sustained, bursts of 200
    let bucket = 200, last = Date.now();
    const allow = () => {
      const now = Date.now();
      bucket = Math.min(200, bucket + ((now - last) / 1000) * 100);
      last = now;
      return --bucket >= 0;
    };
    const role = q.get('role');
    if (role === 'host') return connectHost(ws, q, allow);
    if (role === 'player') return connectPlayer(ws, q, allow);
    send(ws, { t: 'err', msg: 'bad role' });
    ws.close();
  }

  function connectHost(ws, q, allow) {
    const token = cleanToken(q.get('token'));
    if (!token) { send(ws, { t: 'err', msg: 'bad token' }); ws.close(); return; }
    let room = null;
    const wanted = (q.get('room') || '').toUpperCase();
    if (wanted && rooms.get(wanted) && rooms.get(wanted).hostToken === token) room = rooms.get(wanted);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'err', msg: 'server full' }); ws.close(); return; }
      const code = newCode();
      room = { code, hostToken: token, host: null, hostGoneAt: 0, players: new Map(), nextId: 1 };
      rooms.set(code, room);
    }
    if (room.host && room.host !== ws) { send(room.host, { t: 'err', msg: 'replaced' }); room.host.close(); }
    room.host = ws;
    room.hostGoneAt = 0;
    send(ws, { t: 'room', code: room.code });
    // re-announce everyone already here (host page reloaded)
    for (const p of room.players.values()) {
      if (p.ws) send(ws, { t: 'join', id: p.id, name: p.name, color: p.color, reconnect: true });
      send(p.ws, { t: 'host', up: true });
    }

    ws.on('message', (data) => {
      if (!allow()) return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'to') {
        for (const p of room.players.values()) if (p.id === m.id) send(p.ws, { t: 'm', m: m.m });
      } else if (m.t === 'all') {
        for (const p of room.players.values()) send(p.ws, { t: 'm', m: m.m });
      } else if (m.t === 'kick') {
        for (const [tok, p] of room.players) if (p.id === m.id) { send(p.ws, { t: 'err', msg: 'removed by host' }); p.ws && p.ws.close(); room.players.delete(tok); }
      }
    });
    ws.on('close', () => {
      if (room.host !== ws) return;
      room.host = null;
      room.hostGoneAt = Date.now();
      for (const p of room.players.values()) send(p.ws, { t: 'host', up: false });
    });
  }

  function connectPlayer(ws, q, allow) {
    const room = rooms.get((q.get('room') || '').toUpperCase());
    const token = cleanToken(q.get('token'));
    if (!room || !token) { send(ws, { t: 'err', msg: 'Room not found' }); ws.close(); return; }
    let p = room.players.get(token);
    if (!p) {
      const live = [...room.players.values()].filter((x) => x.ws || Date.now() - x.leftAt < RESERVE_MS).length;
      if (live >= MAX_PLAYERS) { send(ws, { t: 'err', msg: 'Room is full' }); ws.close(); return; }
      const id = room.nextId++;
      p = { id, name: cleanName(q.get('name')), color: COLORS[(id - 1) % COLORS.length], ws: null, leftAt: 0 };
      room.players.set(token, p);
    } else {
      p.name = cleanName(q.get('name') || p.name);
      if (p.ws && p.ws !== ws) { send(p.ws, { t: 'err', msg: 'opened elsewhere' }); p.ws.close(); }
    }
    const reconnect = p.leftAt > 0;
    p.ws = ws;
    p.leftAt = 0;
    send(ws, { t: 'welcome', id: p.id, color: p.color, code: room.code, host: !!room.host });
    send(room.host, { t: 'join', id: p.id, name: p.name, color: p.color, reconnect });

    ws.on('message', (data) => {
      if (!allow()) return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (!m || m.t !== 'in' || typeof m.k !== 'string' || m.k.length > 12) return;
      const v = m.v;
      if (!(typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 12) || v === undefined)) return;
      send(room.host, { t: 'in', id: p.id, k: m.k, v });
    });
    ws.on('close', () => {
      if (p.ws !== ws) return;
      p.ws = null;
      p.leftAt = Date.now();
      send(room.host, { t: 'leave', id: p.id });
    });
  }

  // ------------------------------------------------------------------ housekeeping
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already gone */ }
    }
    const now = Date.now();
    for (const [code, room] of rooms) {
      for (const [tok, p] of room.players) if (!p.ws && p.leftAt && now - p.leftAt > RESERVE_MS) room.players.delete(tok);
      if (!room.host && room.hostGoneAt && now - room.hostGoneAt > HOST_GRACE_MS) rooms.delete(code);
    }
  }, 20000);
  sweep.unref();

  return {
    server, wss, rooms,
    listen(port = 3000, host = '0.0.0.0') {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------- CLI entry
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  const tls = process.env.TLS_KEY && process.env.TLS_CERT
    ? { key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) } : null;
  const app = createUmbraServer({ tls });
  app.listen(port).then((p) => {
    const scheme = tls ? 'https' : 'http';
    console.log(`\n  UMBRA is up\n  ─────────────────────────────────────────`);
    console.log(`  this machine : ${scheme}://localhost:${p}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  on your Wi-Fi: ${scheme}://${n.address}:${p}`);
    }
    if (!tls) console.log('\n  Phones only allow camera access on https:// (or localhost).\n  See README → "Getting HTTPS on a phone".\n');
  });
}
