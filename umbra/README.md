# UMBRA — a co-op shadow puzzle for a phone camera + projector

One phone is wired to a projector and watches the projected picture with its camera. Anything
you hold in the beam — a hand, a book, a cardboard cut-out — casts a **shadow, and shadows are
solid**. Everyone else joins from their own phone and steers: nudge the orb, flip gravity,
throw switches. Guide the glowing orb to the goal, **together**.

```
 host phone (browser)  ──cable / cast──▶  projector ──light──▶ wall
   camera ◀── sees the wall; shadows become solid game objects
        ▲
        │ WebSocket relay (Wi-Fi / internet)
 controller phones  (nudge · gravity · switches)
```

* Game ideas that were considered: [`docs/IDEAS.md`](docs/IDEAS.md)
* What exists: 6 levels, shadow plates & gates, laser beams, gravity flips, phone switches,
  up to 8 players, a built-in **simulator** (no projector needed), full calibration flow.

## Quick start (2 minutes, no hardware)

```bash
cd umbra
npm install
npm start                 # → http://localhost:3000
```

Open <http://localhost:3000>, press **Try the simulator**. A pretend camera + wall feeds the
*real* calibration and shadow-detection code, and you drag virtual hands/bars/blocks around
with the mouse. Scan the QR code with a phone on the same Wi-Fi (or open the printed
address) to try the controller.

Keys on the host page: `←/→` nudge · `W A S D` gravity · `R` reset orb · `N` next level ·
`M` show detected shadows · `B` debug panel · `Esc` menu.

## Playing for real

### What you need
* **Host device** — a phone *or laptop* with a camera, wired/cast to the projector. A laptop
  with a webcam + HDMI projector is the easiest first try (see below).
* A projector, a light-coloured wall or table, and a room that is dim-ish (the dimmer, the
  crisper the shadows).
* 1–8 other phones as controllers (any modern browser, nothing to install).

### Connecting phones
| Setup | How |
|---|---|
| **Laptop is the host** (webcam + projector) | `npm start`, open `http://localhost:3000/host.html` on the laptop. `localhost` is allowed to use the camera over plain http. The QR code automatically points at the laptop's Wi-Fi address; phones must be on the same Wi-Fi. |
| **A phone is the host** | Browsers only give camera access on **https**. Run the server somewhere with HTTPS: a Docker host (`Dockerfile` included), any PaaS that gives you a certificate, or an https tunnel to your laptop (`ngrok`, `cloudflared`, `localtunnel` …). Open that https URL on the host phone and on the controllers. Self-signed certificates may or may not give you camera access depending on the browser — use a real certificate. |

Own certificate? `TLS_KEY=key.pem TLS_CERT=cert.pem npm start` serves https/wss directly.

### Setting up the picture
1. Put the host phone/laptop so its camera sees the **whole** bright picture (landscape, steady —
   prop it on something). Wide angle is fine; it doesn't need to be centred.
2. Host page → **Set up camera** → aim → **Calibrate**. The projector flashes black then white
   (keep hands out of the beam, ~4 s). Check that the green outline hugs the bright area; drag
   the corners if not.
3. Pick a level and **Start**. Start with **Shadow Lab** to see your shadows become solid.

### Shadow tips
* A shadow is as sharp as the object is close to the wall; it is as *big* as the object is close
  to the projector. Use that.
* Anything opaque works: hands, rulers, books, cardboard cut-outs, a phone.
* Everything the game draws is bright (white / saturated colour) **on purpose**: dark ink would
  look like a shadow to the camera. If you add art, keep one colour channel near full.

## Roles & rules

| | |
|---|---|
| **Everyone** | ◀ ▶ nudge the orb · Reset orb |
| **Gravity Master** | rotates every level; D-pad flips gravity (levels with 🔁) |
| **Anyone** | phone **switches** (levels that have them) |
| **Shadows** | solid for the orb. A shadow that lands on the orb pushes it out. |
| **Plate** | a coloured circle; keep ≥ ~⅓ of it in shadow and its gate opens (stays open ~1 s after you let go) |
| **Laser** | kills the orb unless a shadow crosses the beam anywhere along it |
| **Void** | the bottom edge; falling in respawns the orb |

Levels: Shadow Lab (sandbox) → First Bridge → Shadow Key → Laser Hall → Upside Down → Switchboard.

## About Bluetooth (please read)

The original idea was controllers connecting to the host over Bluetooth. **That isn't possible
from a web page**, so controllers connect through a small relay server instead:

* Web Bluetooth only lets a page act as a BLE *client* (central). A phone page cannot
  *advertise* as the peripheral that other phones connect to, and iOS Safari has no Web
  Bluetooth at all.
* A native app (Swift / Kotlin / Capacitor with a BLE-peripheral plugin) could do it. The code is
  structured for that: [`public/js/net.js`](public/js/net.js) is a thin transport
  (`connect / send / onMessage / onStatus`) and the host only speaks the small message protocol
  below, so a BLE transport could replace the WebSocket one without touching game logic.
* The upside of the relay: zero install, works on every phone, works across rooms/the internet.
  The downside: needs Wi-Fi/mobile data and a reachable server.

## How it works

```
public/js/
  core/vision-core.js   calibration + ShadowDetector (pure maths, DOM-free)
  core/sim-core.js      physically-modelled fake camera/wall (used by simulator + tests)
  host/app.js           host state machine, networking, roles, UI
  host/stage.js         projector canvas, letter-boxed world, view rectangle
  host/camera.js        getUserMedia wrapper (+ exposure lock where supported)
  host/calibrate.js     flash black/white, collect references
  host/sim.js           simulator camera + draggable objects
  game/world.js         orb physics, plates, gates, beams, goals (DOM-free)
  game/levels.js        level data      game/render.js  drawing   game/palette.js  safe colours
  player/app.js         controller UI
  net.js                WebSocket transport + auto-reconnect
server.js               static files + room relay
```

**Seeing shadows.** During calibration the projector shows full black then full white. For every
camera pixel we learn the room's ambient light (black) and what a fully lit wall looks like
(white). The four corners of the bright blob give a homography from the camera image to the
projected picture. In play, a grid cell (160×90) is **lit** when
`max over R,G,B of (observed − ambient) / (white − ambient)` is high — in *linear* light, since
phone video is gamma-encoded. Shadows then pass through hysteresis, a 2-frame debounce, a
despeckle filter and an auto-exposure compensation (the 85th-percentile cell is re-normalised
to 1.0). The result is a bit-grid the physics treats like any other wall.

**Protocol** (JSON over WebSocket `/ws`):

| from → to | message |
|---|---|
| host → server | connect `?role=host&token=…[&room=CODE]` → `{t:'room',code}` |
| player → server | connect `?role=player&room=CODE&token=…&name=…` → `{t:'welcome',id,color,code,host}` |
| server → host | `{t:'join',id,name,color,reconnect}` · `{t:'leave',id}` · `{t:'in',id,k,v}` |
| player → server | `{t:'in',k,v}` — `k`: `nudge` (−1/0/1) · `grav` (up/down/left/right) · `sw` (key) · `reset` · `spawn` · `next` |
| host → server | `{t:'to',id,m}` · `{t:'all',m}` — `m` is the phone's state (`phase`, `level`, `axis`, `gm`, `switches`, …) or `{vib}` |

Rooms are 4 letters, a dropped player's seat is held for 5 minutes, a host reload keeps the room,
inputs are validated and rate-limited, names are sanitised, ≤ 8 players / 200 rooms.

## Tests

```bash
npm test        # 39 unit/integration tests: vision, physics & level solvability, relay server
npm run e2e     # headless Chromium: host + 2 phones, full level clear, camera error paths; screenshots → test/out/
```

* **Vision** is tested against the simulator: corner recovery (< 3 px), shadow IoU ≥ 0.8 for hands,
  ramps and multi-object scenes, bright rooms, auto-exposure drift, error messages.
* **Every level** has a scripted solution that clears it, and a check that it can *not* be cleared
  without its key mechanic (shadow / switch / gravity).
* **Not tested: a real projector, lens and wall.** The simulator models ambient light, vignetting,
  keystone, gamma and noise, but real rooms will differ. If shadows flicker or are missed, open the
  debug panel (`B`, or triple-tap the top-left corner), and tune: `host.html?on=0.25&off=0.38`
  (lower = needs a darker shadow). Dimming the room helps more than any setting.

## Adding a level

Levels are data — see the header of [`public/js/game/levels.js`](public/js/game/levels.js) for the
format, add an entry, and add a scripted solution to `test/world.test.js` to prove it can be done.

## URL parameters (host page)

`sim=1` start in the simulator · `fast=1` quick calibration (tests) · `review=1` show the
calibration result even in the simulator · `auto=N` start level N when ready · `on=` / `off=`
shadow thresholds · `base=https://…` override the address in the QR code.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Camera access needs https://" | Use localhost on a laptop, or an https URL (see *Connecting phones*). |
| "cannot see the whole projection" | Move the camera back / zoom out so all four edges are in view. |
| "can barely tell the projector from the room" | Dim the room, raise projector brightness, avoid glare on the wall. |
| Shadows appear where nothing is | Camera moved after calibrating (re-calibrate), or room light changed. Raise thresholds. |
| Shadows missing / flicker | Lower `on`/`off`, darken the room, use a more opaque object. |
| Phone says "Room not found" | Code is 4 letters from the projector; the host must be open first. |
| Phone can't reach the host page | Same Wi-Fi? Client isolation on guest Wi-Fi blocks phone-to-laptop traffic. |

## Ideas to extend

Presentation API / second window so the host phone's screen is not what the projector shows ·
more levels & moving platforms · Shadow Charades (match a target silhouette) ·
a native BLE transport · score sharing · per-player cursors.
