// ==========================================
// LEVELS
// ==========================================
//
// Pure data: no server or Colyseus imports,
// so tests (and tools) can load it directly.
//
// All coordinates are CENTRE based, in world
// pixels (the world is 800 x 600, the ground
// surface is at y = 540).

import type {
  Pit,
  Spikes
} from "./physics.js";

export interface Platform {

  x: number;
  y: number;

  width: number;
  height: number;
}

export interface LevelData {

  platforms: Platform[];

  // Centre of the exit door. The door
  // opens once every crystal is collected
  // and the level ends when ALL players
  // are standing in it.
  exit: {
    x: number;
    y: number;
  };

  // Gaps in the ground. Falling in respawns
  // the player at their spawn point.
  pits: Pit[];

  // Spike strips. Touching one respawns
  // the player at their spawn point.
  spikes: Spikes[];

  crystals: {
    x: number;
    y: number;
  }[];
}

// ------------------------------------------
// EXIT DOOR
// ------------------------------------------

// Wide enough for four solid (40px) players
// side by side: a player counts as inside
// when their centre is within the door's
// width and within EXIT_REACH_Y vertically.

export const EXIT_WIDTH = 140;

export const EXIT_HEIGHT = 64;

export const EXIT_REACH_Y = 36;

// ------------------------------------------
// SPAWNS
// ------------------------------------------

// One per player slot. Players drop in from
// y = 300, so hazards must stay clear of the
// column each spawn lands in (tests check).

export const SPAWN_POSITIONS = [

  {
    x: 180,
    y: 300
  },

  {
    x: 300,
    y: 300
  },

  {
    x: 420,
    y: 300
  },

  {
    x: 540,
    y: 300
  }
];

// ------------------------------------------
// LEVELS
// ------------------------------------------

export const LEVELS: LevelData[] = [

  // ======================================
  // LEVEL 1
  // ======================================

  {
    exit: { x: 250, y: 258 },

    pits: [
      { x1: 610, x2: 730 }
    ],

    spikes: [
      { x: 235, y: 540, width: 70 }
    ],

    platforms: [

      {
        x: 100,
        y: 450,
        width: 180,
        height: 20
      },

      {
        x: 360,
        y: 400,
        width: 160,
        height: 20
      },

      {
        x: 600,
        y: 450,
        width: 150,
        height: 20
      },

      {
        x: 250,
        y: 300,
        width: 150,
        height: 20
      }
    ],

    crystals: [

      { x: 120, y: 410 },
      { x: 170, y: 410 },
      { x: 220, y: 410 },

      { x: 380, y: 360 },
      { x: 430, y: 360 },
      { x: 480, y: 360 },

      { x: 620, y: 410 },
      { x: 670, y: 410 },

      { x: 280, y: 260 },
      { x: 350, y: 260 },

      // over the pit
      { x: 640, y: 480 },
      { x: 690, y: 480 },
      { x: 765, y: 510 }
    ]
  },

  // ======================================
  // LEVEL 2
  // ======================================

  {
    exit: { x: 470, y: 178 },

    pits: [
      { x1: 220, x2: 390 }
    ],

    spikes: [
      { x: 480, y: 420, width: 40 },
      { x: 660, y: 540, width: 80 }
    ],

    platforms: [

      {
        x: 80,
        y: 430,
        width: 140,
        height: 20
      },

      {
        x: 300,
        y: 350,
        width: 140,
        height: 20
      },

      {
        x: 520,
        y: 430,
        width: 160,
        height: 20
      },

      {
        x: 180,
        y: 250,
        width: 140,
        height: 20
      },

      {
        x: 470,
        y: 220,
        width: 150,
        height: 20
      }
    ],

    crystals: [

      { x: 100, y: 390 },
      { x: 150, y: 390 },

      { x: 320, y: 310 },
      { x: 370, y: 310 },

      { x: 540, y: 390 },
      { x: 590, y: 390 },

      { x: 200, y: 210 },
      { x: 250, y: 210 },

      { x: 490, y: 180 },
      { x: 550, y: 180 },

      // over the pit
      { x: 250, y: 490 },
      { x: 305, y: 470 },
      { x: 360, y: 490 }
    ]
  },

  // ======================================
  // LEVEL 3
  // ======================================

  {
    exit: { x: 300, y: 178 },

    pits: [
      { x1: 215, x2: 385 }
    ],

    spikes: [
      { x: 630, y: 540, width: 80 }
    ],

    platforms: [

      {
        x: 80,
        y: 450,
        width: 130,
        height: 20
      },

      {
        x: 260,
        y: 380,
        width: 120,
        height: 20
      },

      {
        x: 450,
        y: 310,
        width: 120,
        height: 20
      },

      {
        x: 620,
        y: 400,
        width: 120,
        height: 20
      },

      {
        x: 300,
        y: 220,
        width: 160,
        height: 20
      }
    ],

    crystals: [

      { x: 100, y: 410 },
      { x: 150, y: 410 },

      { x: 280, y: 340 },
      { x: 330, y: 340 },

      { x: 470, y: 270 },
      { x: 520, y: 270 },

      { x: 640, y: 360 },
      { x: 690, y: 360 },

      { x: 330, y: 180 },
      { x: 410, y: 180 },

      // over the pit
      { x: 270, y: 490 },
      { x: 300, y: 470 },
      { x: 330, y: 490 }
    ]
  }
];
