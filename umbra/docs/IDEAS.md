# Shadow-projector party game — idea shortlist

**The hardware loop**

```
 phone (camera + browser)  ──HDMI/cast──▶  projector  ──light──▶  wall / table
        ▲                                      ▲
        │ sees the wall                        │ people hold hands / props here
        └──────── shadows = the game's "solid" objects ─────────┘
 other phones  ──(wireless)──▶  host phone   (controllers)
```

Everything you draw on the projector is *light*; anything a player holds in the beam
is a *hole in the light*. The camera sees the holes. So the shadow is a physical,
tangible, free-form "controller" that the whole room can share.

**One design rule falls out of this:** the game can only draw things that are bright
(white, or saturated colours). Dark ink on the projector is indistinguishable from a
shadow. Every idea below is a "light table" game for that reason.

---

## 1. UMBRA — co-op shadow puzzle ★ (built)

A glowing **Orb** has to reach the **Goal**. Shadows are solid: hands, arms, books, a
cardboard cut-out — whatever the crew holds in the beam becomes a ramp, wall or
bridge. Phones give each player powers:

| Phone role | What it does |
|---|---|
| **Nudge** (everyone) | push the orb left/right |
| **Gravity Master** (rotates each level) | flips gravity to any of 4 directions |
| **Switches** | open gates elsewhere on the board |

Puzzle pieces: shadow **plates** (hold a shadow on them to open a gate), **gates**,
**laser beams** (a shadow across the beam cuts it), **spikes**, **stars**.
Why it works: the "physical" half (building shadows) and the "digital" half (phones)
need constant talk — "hold the beam! now gravity up! *now!*".

## 2. Shadow Lemmings
Tiny walkers stream out of a hatch and march blindly. The crew builds bridges and
walls from shadows; phones issue "turn around / stop / jump" orders. Great for 5+
people, more chaotic; needs walker physics + many entities.

## 3. Shadow Charades ("Hole in the Wall")
The projector shows a target silhouette (rabbit, bridge, letter). The team forms it with
hands/bodies; the camera scores overlap (IoU). Phones vote/skip/give hints.
Technically the simplest (just mask-vs-template), very social, low depth.

## 4. Light Heist (asymmetric 1-vs-all)
A "guard" player on a phone sweeps spotlight cones across the board; the crew uses
shadows as hiding places for thief tokens they steer from their phones. Needs
turn/score design but is the best *competitive* option.

## 5. Eclipse Defence
Waves of light-bugs rush a core. Shadows block their path; phone players fire light
bolts that shadows also block. Tower-defence feel; good for repeat play.

## 6. Shadow Pinball / Marble Run
Free-for-all: everyone builds bumpers and ramps while a phone-controlled flipper
launches balls; score by which team's goal the ball lands in.

## 7. Floor-is-Lava Tag (physical)
Floor-projected: the beam is "lava", shadows are safe islands. Players *stand* in
shadows cast by props (umbrellas, boxes) and the host phone moves the light around.

---

### Why #1 first
* Teaches the core trick (shadow = solid) in 10 seconds.
* Uses all three input channels: body (shadows), phones (powers), voice (co-ordination).
* Level-based, so new puzzles are just data (see `public/js/game/levels.js`).
* The same engine can host #3 (charades), #5 and #6 later.
