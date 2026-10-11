// Levels are plain data. Coordinates are in a 960 x 540 world (y grows downwards), orb radius is 12.
//
//   spawn     [x, y]                     where the orb starts / respawns
//   goal      [x, y, r] | null           reach it to clear the level
//   walls     [[x, y, w, h], ...]        always solid
//   lines     [[x1, y1, x2, y2, t], ...] solid slanted bars
//   spikes    [[x, y, w, h], ...]        deadly
//   beams     [{ a:[x,y], b:[x,y] }]     deadly laser, switched OFF while any shadow crosses it
//   plates    [{ key, x, y, r }]         circles that "press" while shadowed; hold a gate open
//   switches  [{ key, label }]           phone buttons; toggle the gate with the same key
//   gates     [{ key, rect:[x,y,w,h] }]  solid unless a plate or switch with its key is on
//   stars     [[x, y], ...]
//   ghosts    [[x1, y1, x2, y2], ...]    dotted "build something here" hints for new players
//   gravity   true when the Gravity Master role is used
//   orbs      max orbs on the board (Shadow Lab lets you spawn more)

export const LEVELS = [
  {
    id: 'lab',
    name: 'Shadow Lab',
    hint: 'Hold a hand in the light — shadows are solid. Catch the orb, grab the stars.',
    spawn: [480, 70],
    goal: null,
    walls: [[110, 330, 150, 16], [700, 330, 150, 16]],
    stars: [[480, 300], [185, 300], [775, 300]],
    gravity: true,
    orbs: 6,
    sandbox: true,
  },
  {
    id: 'bridge',
    name: 'First Bridge',
    hint: 'Hold something across the gap to make a ramp. ◀ ▶ on your phone nudges the orb.',
    spawn: [120, 196],
    goal: [840, 392, 30],
    walls: [[0, 210, 250, 22], [710, 420, 250, 22]],
    stars: [[480, 299]],
    ghosts: [[250, 214, 710, 424]],
  },
  {
    id: 'gate',
    name: 'Shadow Key',
    hint: 'The purple plate opens the gate while it is in shadow. Keep a hand over it!',
    spawn: [100, 126],
    goal: [875, 440, 30],
    walls: [[0, 150, 220, 22], [0, 470, 960, 70], [640, 0, 18, 330]],
    plates: [{ key: 'A', x: 460, y: 240, r: 46 }],
    gates: [{ key: 'A', rect: [640, 330, 18, 140] }],
    stars: [[400, 440], [760, 440]],
  },
  {
    id: 'lasers',
    name: 'Laser Hall',
    hint: 'Red beams burn the orb. A shadow across a beam switches it off.',
    spawn: [90, 136],
    goal: [880, 440, 30],
    walls: [[0, 160, 200, 22], [0, 470, 960, 70]],
    beams: [
      { a: [420, 220], b: [420, 470] },
      { a: [680, 220], b: [680, 470] },
    ],
    stars: [[250, 440], [550, 440], [800, 440]],
  },
  {
    id: 'flip',
    name: 'Upside Down',
    hint: 'The Gravity Master flips gravity with the D-pad. Bridge the gap with a shadow.',
    spawn: [90, 478],
    goal: [880, 468, 30],
    walls: [[0, 500, 420, 40], [560, 500, 400, 40], [660, 200, 20, 300]],
    stars: [[490, 30], [770, 30]],
    gravity: true,
    ghosts: [[420, 500, 560, 500]],
  },
  {
    id: 'board',
    name: 'Switchboard',
    hint: 'Press the switch on a phone, shadow the plate, and cut the laser. Teamwork!',
    spawn: [90, 86],
    goal: [900, 290, 28],
    walls: [[0, 110, 280, 20], [0, 320, 960, 20]],
    plates: [{ key: 'B', x: 540, y: 150, r: 46 }],
    switches: [{ key: 'A', label: 'Gate 1' }],
    gates: [
      { key: 'A', rect: [380, 0, 18, 320] },
      { key: 'B', rect: [680, 0, 18, 320] },
    ],
    beams: [{ a: [800, 70], b: [800, 320] }],
    stars: [[300, 290], [540, 290]],
  },
];

export function getLevel(i) {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
}
