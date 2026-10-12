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
| **C. Any device, over https** | Put the server behind an https address (a tunnel such as ngrok or cloudflared, or a host) and open that address. | Needed for an iPhone, which has no `adb`. Self-signed certificates may not allow camera access. Also the only setup that can test the internet path (section 4). |

**Physical setup** (these decide the result as much as the code does):
- Point the projector at a taut bedsheet, a pale wall or a tent wall. Dim the room.
- Put the camera **off to one side (30 degrees or more off the projector's axis) and low**, on a stand,
  so people reaching into the beam do not block its view. It must see the **whole bright picture**.
- Keep the camera steady. If it moves, the test tells you to recalibrate.
- Use a **landscape** display. The page asks the browser for fullscreen when you start the camera, so the
  projected picture is exactly the page (no browser bars). Do not resize or rotate the window afterwards.
- Run it once in a plain room, then again at the real spot with the lantern or fire lit.
- On the setup screen say how the projector is connected (cable or wireless cast) and add a note; both go in the report.

## 2. Run it

1. **Start camera** (or *Dry run in the simulator* to see how it works first; simulator numbers mean nothing about your hardware).
2. **Aim** until the whole picture is in view, then **Calibrate**. Keep hands out of the beam: the wall
   flashes black, then white. Check the green outline hugs the bright area; drag the corners if not.
   If auto-calibration failed you must drag the corners yourself, and the report keeps that failure on record.
3. Put a hand in the beam: the **live view** should show a blue tint that follows it.
4. **Run guided test.** Follow the big text on the wall. Each step announces itself for a few seconds
   (longer for the ones that need people or a lantern), then starts. `Space` starts, `Esc` stops.
   While a test runs the control panel shrinks to one small row at the bottom so it hides as little of the picture as possible.

| Step | You | What it measures | Pass |
|---|---|---|---|
| **Latency** | hands out, still | The wall flashes a dark square 20 times, only after the square has been seen clear; how long until the camera **and** detector notice (and release). Reports the raw detector and the debounced one the game uses. A square the camera never noticed counts as 2 s. | median <= 300 ms, p95 <= 450 ms; more than 5% never noticed fails, any miss warns |
| **Quiet room** | nothing in the beam, still (60 s) | Phantom shadows per half of the wall: how often one appears, how much of the time one is present, how long the longest stays | <= 1 appearance per lane per minute, present <= 5% of the time, longest <= 5 s |
| **Shadow fit** | hand or prop in the beam | Fit your shadow to a glowing ring and hold it 1 s, 10 times. A try only starts from a clear ring. | fits in >= 8 of 10 within 10 s |
| **Small ring** | the same, smaller ring | The smallest shadow the setup resolves (informs, does not decide) | same |
| **People in beam** | 2-3 people, a child if possible, props | How much of each lane's area is covered | information (design cap: 25 % per lane) |
| **Quiet + lantern** | light the lantern or fire, lamps on; people stay **nearby but out of the beam** | Phantom shadows with camp lighting | same as Quiet room |
| **Recalibrate** | **bump the projector, then press the button** | How long the black/white flash and settle takes to find the picture again, and how far it moved | <= 6 s (game adds a 3 s countdown and a tap) |
| **Connectivity** | phones scan the QR code and keep the screen on | Round-trip time through the relay; any 5 s window with a reply slower than 500 ms counts as stalled | <= 25 % stalled windows, 4+ phones for a full pass |

You can also run any single test from the *Ready* panel. A test you skip or that is voided shows as **SKIP**, never as a pass.
*Clear results* on the report screen starts again and keeps the calibration.

## 3. Read the report

The overall line is one of (strongest first):

- **INVALID RUN**: the page itself hit an error. This says nothing about your hardware; send the report.
- **NO-GO**: at least one gate failed. This wins even when other tests were not run. The report prints the design document's fallback for each failure.
- **INCOMPLETE**: no gate failed, but a gate test was not run or was voided (see *Not run or invalid*).
- **CAUTION**: a gate passed with a warning (slower than hoped, part of the board hard to read, hand-placed corners). Read the *->* line under it.
- **GO**: every gate passed. The idea is physically viable here.

Gate rows are marked `*`. Rows without `*` (noise, bodies in the beam, recalibration, connectivity) do not change the headline, but a failed or warned one is
listed under **Needs attention**, because it changes the plan (for example a connectivity failure makes the offline mode a must-build).

If the run used short timings (`fast=1`, or the hosted preview) the report says **NOT A VALID MEASUREMENT** in its header.

Use **Copy report** (or **Download JSON**, which keeps every trial) and paste it into the chat together with a few facts the page cannot know:
projector model and brightness, what you projected onto, camera model, how bright the room was, and where you ran it.

## 4. What the numbers do and do not mean

- **Latency** is *display to camera to mask*: the dark square is painted, the camera sees it, the detector reacts. It excludes
  your hand's own movement, which is instant, and the time the game then takes to react on screen. It is a good proxy for
  "hand moves, lantern reacts", not an exact copy.
- The thresholds are the design document's **assumptions** (section 15), not laws. The report prints each number next to its threshold so you can judge.
- Ring-fit times measure the *whole* loop: you, the shadow, the camera, the detector. A slow, nervous hand shows up as noise.
- **Connectivity** measures the path between the phones and whatever served the page. Served from your laptop, that is your **local Wi-Fi**: the report says so,
  and caps the result at a warning. To learn about *mobile data at camp*, serve the page over the internet (setup C), then open the QR link from phones on
  mobile data at the camp spot. Phones that are connected and reporting when you press *Start probe* are the ones scored; phones that left earlier or join
  later are not. A phone whose screen turned off is shown as *slept* and its seconds are left out, not blamed on the network. Plain-http pages cannot hold a wake lock,
  so set the phones' Auto-Lock to Never. The phone page stops pinging when the host ends the probe.
- The simulator exists to prove the page works. It has no real latency, no real projector, no real people.

## 5. How the page protects the result

A test that went wrong is **voided and shown as SKIP**, not scored. In particular:

- **Blind areas.** The control panel is part of the projected picture, so the detector ignores the cells under it. While a test runs the panel is one small row;
  every result is measured over the cells that *can* be seen, and the share hidden is printed (and warns above 5% of a lane). A test target that is
  more than 10% unmeasurable (outside the camera's view, too dim, under the panel) voids the run.
- **Clear start.** The latency square only flashes after it was seen clear, and a ring try only starts from a clear ring, so a shadow already sitting there cannot
  pass as an instant success. If it never clears the run is voided.
- **Interruptions.** If the page is hidden (locked screen, other tab), freezes, or the camera is lost or stops delivering pictures, the running test is discarded
  and the Ready screen says why. A timed test that processed too few camera samples is voided.
- **Changed picture.** Resizing or rotating the window after calibration marks the calibration out of date and blocks tests until you calibrate again. A failed
  recalibration does the same.
- **Honest labels.** An auto-calibration failure stays in the report even if you place the corners by hand. Page errors are listed once and make the run INVALID.

## 6. URL options

`sim=1` use the simulator · `fast=1` short timings (a dry run in ~1 minute; **flagged as not valid**) · `review=1` show the calibration review even in the simulator ·
`on=0.25&off=0.38` shadow thresholds (lower = needs a darker shadow; **flagged**) · `base=https://...` address phones should use in the QR code.

Shortcuts: `Space` primary button · `Esc` stop · `M` toggle the blue shadow tint · `B` debug panel (or triple-tap the top-left corner).

## 7. Troubleshooting

| Symptom | Try |
|---|---|
| "Camera access needs https" | Use `localhost` (setup A or B) or an https address (setup C). |
| Calibration says the camera can barely tell the projector from the room | Dim the room, raise projector brightness, remove glare. |
| "cannot see the whole projection" | Move the camera back or zoom out. |
| Live view is tinted where nothing is | Camera moved (recalibrate), the room changed, or an ambient light flickers. Try `on=0.25&off=0.38`, or darker room. |
| "Invalid run: x% of the test square/ring cannot be measured" | Part of the picture is outside the camera's view or too dim: re-aim, recalibrate, repeat. |
| "Calibration is out of date" | The window changed size, or recalibration failed. Press *Calibrate again*. |
| "Interrupted: the page was hidden" | Keep the host screen on and in front (the page asks for a wake lock where the browser allows it). |
| Everything is slow | Close other tabs; a phone that gets hot throttles. Use a wired display. |
| QR code does not open on phones | Phones need to reach the server's address shown under the code (same Wi-Fi, or setup C). |
