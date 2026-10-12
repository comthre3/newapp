# Real-projector test (P0)

A guided 10-minute check, at `/p0.html`, that answers the one question every plan in
[GAME_DESIGN.md](GAME_DESIGN.md) depends on: **do real shadows work well enough on your projector,
surface, camera and network?** It measures; it does not play a game. It ends with a report you can
paste into the chat.

> Everything the unit and simulator tests prove stops at the lens. This page is the first thing that
> runs against real light.

## 1. Set up

Start the server on a laptop: `cd umbra && npm install && npm start`.

Pick one arrangement:

| Setup | How | Notes |
|---|---|---|
| **A. Laptop + USB webcam + HDMI projector** (easiest) | Open `http://localhost:3000/p0.html` on the laptop, drag it onto the projector, pick the webcam in the *Camera* list. | `localhost` may use the camera without https. A built-in laptop webcam faces *you*, not the wall: use a USB webcam or a phone. |
| **B. Android phone as camera and screen** | Cable the phone to the projector (USB-C to HDMI). Run `adb reverse tcp:3000 tcp:3000` on the laptop, then open `http://localhost:3000/p0.html` in Chrome on the phone. | `localhost` counts as secure, so the camera works. The phone's back camera looks at the wall. |
| **C. Any device, over https** | Put the server behind an https address (a tunnel such as ngrok or cloudflared, or a host) and open that address. | Needed for an iPhone, which has no `adb`. Self-signed certificates may not allow camera access. |

**Physical setup** (these decide the result as much as the code does):
- Point the projector at a taut bedsheet, a pale wall or a tent wall. Dim the room.
- Put the camera **off to one side (30 degrees or more off the projector's axis) and low**, on a stand,
  so people reaching into the beam do not block its view. It must see the **whole bright picture**.
- Keep the camera steady. If it moves, the test tells you to recalibrate.
- Run it once in a plain room, then again at the real spot with the lantern or fire lit.

## 2. Run it

1. **Start camera** (or *Dry run in the simulator* to see how it works first; simulator numbers mean nothing about your hardware).
2. **Aim** until the whole picture is in view, then **Calibrate**. Keep hands out of the beam: the wall
   flashes black, then white. Check the green outline hugs the bright area; drag the corners if not.
3. Put a hand in the beam: the **live view** should show a blue tint that follows it.
4. **Run guided test.** Follow the big text on the wall. Each step announces itself, then starts; `Space` starts, `Esc` stops.

| Step | You | What it measures | Pass |
|---|---|---|---|
| **Latency** | hands out, still | The wall flashes a dark square 20 times; how long until the camera **and** detector notice (and release). It reports the raw detector and the debounced one the game uses. | median <= 300 ms, p95 <= 450 ms, no misses |
| **Quiet room** | nothing in the beam, still (60 s) | Phantom shadows that appear from nowhere, per half of the wall | <= 1 per lane per minute |
| **Shadow fit** | hand or prop in the beam | Fit your shadow to a glowing ring and hold it 1 s, 10 times | fits in >= 8 of 10 within 10 s |
| **Small ring** | the same, smaller ring | The smallest shadow the setup resolves | same |
| **People in beam** | 2-3 people, a child if possible, props | How much of each lane's area is covered | information (design cap: 25 % per lane) |
| **Quiet + lantern** | light the lantern or fire, lamps on, people still at the sides | Phantom shadows with camp lighting | <= 1 per lane per minute |
| **Recalibrate** | **bump the projector, then press the button** | How long recovery takes and how far the picture moved | <= 6 s |
| **Connectivity** | phones scan the QR code and keep the screen on | Round-trip time through the relay; any 5 s window with a reply slower than 500 ms counts as stalled | <= 25 % stalled windows |

You can also run any single test from the *Ready* panel. A test you skip shows as **INCOMPLETE**, not as a pass.

**Connectivity caveat:** phones on your Wi-Fi measure your Wi-Fi. To learn about *mobile data at camp*, serve the page over the internet
(setup C), then open the QR link from phones that are on mobile data, at the camp spot.

## 3. Read the report

The overall line is one of:

- **GO**: every gate passed. The idea is physically viable here.
- **CAUTION**: a gate passed with a warning (slower than hoped, part of the board hard to read). Read the *->* line under it.
- **NO-GO**: at least one gate failed. The report prints the design document's fallback for each failure.
- **INCOMPLETE**: a gate test was not run.

Gate rows are marked `*`. Rows without `*` (noise, bodies in the beam, recalibration, connectivity) inform decisions but do not block.

Use **Copy report** (or **Download JSON**, which keeps every trial) and paste it into the chat together with a few facts the page cannot know:
projector model and brightness, what you projected onto, camera model, how bright the room was, and where you ran it.

## 4. What the numbers do and do not mean

- **Latency** is *display to camera to mask*: the dark square is painted, the camera sees it, the detector reacts. It excludes
  your hand's own movement, which is instant, and the time the game then takes to react on screen. It is a good proxy for
  "hand moves, lantern reacts", not an exact copy.
- The thresholds are the design document's **assumptions** (section 15), not laws. The report prints each number next to its threshold so you can judge.
- Ring-fit times measure the *whole* loop: you, the shadow, the camera, the detector. A slow, nervous hand shows up as noise.
- The simulator exists to prove the page works. It has no real latency, no real projector, no real people.

## 5. URL options

`sim=1` use the simulator · `fast=1` short timings (a dry run in ~40 s) · `review=1` show the calibration review even in the simulator ·
`on=0.25&off=0.38` shadow thresholds (lower = needs a darker shadow) · `base=https://...` address phones should use in the QR code.

Shortcuts: `Space` primary button · `Esc` stop · `M` toggle the blue shadow tint · `B` debug panel (or triple-tap the top-left corner).

## 6. Troubleshooting

| Symptom | Try |
|---|---|
| "Camera access needs https" | Use `localhost` (setup A or B) or an https address (setup C). |
| Calibration says the camera can barely tell the projector from the room | Dim the room, raise projector brightness, remove glare. |
| "cannot see the whole projection" | Move the camera back or zoom out. |
| Live view is tinted where nothing is | Camera moved (recalibrate), the room changed, or an ambient light flickers. Try `on=0.25&off=0.38`, or darker room. |
| Everything is slow | Close other tabs; a phone that gets hot throttles. Use a wired display. |
| QR code does not open on phones | Phones need to reach the server's address shown under the code (same Wi-Fi, or setup C). |
