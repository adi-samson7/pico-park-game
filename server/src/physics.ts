// ==========================================
// PHYSICS
// ==========================================
//
// Pure, framework-free simulation step for
// the platformer. GameRoom owns the players
// and calls stepPlayers() once per tick.
//
// All positions are CENTRE based (x, y is
// the centre of the player's box and of
// every platform).

export const PHYSICS = {

  MOVE_SPEED: 220,

  JUMP_SPEED: -500,

  GRAVITY: 1200,

  // Total jumps before landing.
  MAX_JUMPS: 2,

  GROUND_TOP: 540,

  PLAYER_WIDTH: 40,

  PLAYER_HEIGHT: 60,

  WORLD_WIDTH: 800,

  WORLD_HEIGHT: 600,

  // Max simulated seconds per tick.
  MAX_DT: 0.05,

  // How far below the top of a surface a
  // player's feet may have been on the
  // previous tick and still land on it.
  LANDING_TOLERANCE: 4,

  // Vertical overlap (px) that counts as
  // a real collision rather than contact.
  CONTACT_SLOP: 2,

  // Below this y a player has fallen out
  // of the world (their box is off screen).
  KILL_Y: 660,

  // Spike strips.
  SPIKE_HEIGHT: 16,

  // Spikes are forgiving: the player must
  // sink this far into them to be hit...
  SPIKE_SINK: 6,

  // ...and overlap them by this much less
  // than their full width on each side.
  SPIKE_MARGIN: 6
} as const;

// A gap in the ground, x1..x2 (world px).
export interface Pit {

  x1: number;
  x2: number;
}

// A strip of spikes sitting ON a surface.
// x is the centre, y the surface top.
export interface Spikes {

  x: number;
  y: number;
  width: number;
}

export interface PhysicsBody {

  id: string;

  x: number;
  y: number;

  velocityX: number;
  velocityY: number;

  alive: boolean;

  // 0..MAX_JUMPS. Reset on landing.
  jumpCount: number;

  // True while resting on the ground, a
  // platform or another player.
  grounded: boolean;

  // Session id of the player this one is
  // standing on, or null.
  standingOn: string | null;
}

export interface PhysicsPlatform {

  x: number;
  y: number;

  width: number;
  height: number;
}

// ==========================================
// JUMP
// ==========================================

/**
 * Attempts a (double) jump.
 *
 * - First jump must start on a surface.
 * - Walking off a ledge consumes the first
 *   jump, leaving one air jump.
 * - No further jumps until landing.
 */
export function tryJump(
  body: PhysicsBody
): boolean {

  if (!body.alive) {
    return false;
  }

  const used =
    body.grounded
      ? 0
      : Math.max(
          body.jumpCount,
          1
        );

  if (used >= PHYSICS.MAX_JUMPS) {
    return false;
  }

  body.velocityY =
    PHYSICS.JUMP_SPEED;

  body.jumpCount =
    used + 1;

  body.grounded =
    false;

  body.standingOn =
    null;

  return true;
}

// ==========================================
// STEP
// ==========================================

/**
 * Advances every player by one tick.
 *
 * @returns ids of players that fell out of
 *          the world and need a respawn.
 */
export function stepPlayers(
  players: PhysicsBody[],
  platforms: PhysicsPlatform[],
  deltaSeconds: number,
  pits: Pit[] = []
): string[] {

  const dt =
    Math.min(
      deltaSeconds,
      PHYSICS.MAX_DT
    );

  const alive =
    players.filter(
      player => player.alive
    );

  const byId =
    new Map(
      alive.map(
        player => [
          player.id,
          player
        ]
      )
    );

  const previous =
    new Map<
      string,
      { x: number; y: number }
    >();

  for (const player of alive) {

    previous.set(
      player.id,
      {
        x: player.x,
        y: player.y
      }
    );
  }

  // ----------------------------------------
  // PHASE 1
  // Own movement + static world. Supports
  // are processed before their riders so a
  // rider can inherit the support's motion.
  // ----------------------------------------

  const ordered =
    [...alive].sort(
      (a, b) =>
        stackDepth(a, byId) -
        stackDepth(b, byId)
    );

  const moved =
    new Map<
      string,
      { dx: number; dy: number }
    >();

  const fallen: string[] = [];

  for (const player of ordered) {

    const before =
      previous.get(
        player.id
      )!;

    const support =
      resolveSupport(
        player,
        byId
      );

    // Carry along with the support.

    let startY =
      player.y;

    if (support) {

      const carry =
        moved.get(
          support.id
        ) ?? {
          dx: 0,
          dy: 0
        };

      player.x += carry.dx;

      player.y += carry.dy;

      startY =
        player.y;
    }

    integrate(
      player,
      dt
    );

    let landed =
      landOnGround(
        player,
        startY,
        pits
      );

    if (!landed) {

      landed =
        landOnPlatforms(
          player,
          startY,
          platforms
        );
    }

    if (landed) {

      // Resting on something static.
      player.standingOn =
        null;

    } else if (
      support &&
      player.standingOn
    ) {

      keepStanding(
        player,
        support
      );
    }

    if (
      !player.standingOn &&
      !landed
    ) {

      player.grounded =
        false;
    }

    moved.set(
      player.id,
      {
        dx:
          player.x - before.x,

        dy:
          player.y - before.y
      }
    );

    if (
      player.y >
      PHYSICS.KILL_Y
    ) {

      fallen.push(
        player.id
      );
    }
  }

  // ----------------------------------------
  // PHASE 2
  // Landing on other players' heads.
  // A few passes let stacks of three or
  // four settle in a single tick.
  // ----------------------------------------

  for (let pass = 0; pass < 3; pass++) {

    for (const faller of ordered) {

      for (const support of ordered) {

        if (faller === support) {
          continue;
        }

        landOnPlayer(
          faller,
          support,
          previous
        );
      }
    }
  }

  // ----------------------------------------
  // PHASE 3
  // Players are solid horizontally.
  // ----------------------------------------

  separatePlayers(ordered);

  return fallen;
}

// ==========================================
// HELPERS
// ==========================================

function integrate(
  player: PhysicsBody,
  dt: number
) {

  player.x +=
    player.velocityX * dt;

  player.x =
    clampX(player.x);

  player.velocityY +=
    PHYSICS.GRAVITY * dt;

  player.y +=
    player.velocityY * dt;
}

function clampX(
  x: number
): number {

  const half =
    PHYSICS.PLAYER_WIDTH / 2;

  return Math.max(
    half,
    Math.min(
      PHYSICS.WORLD_WIDTH - half,
      x
    )
  );
}

function stackDepth(
  player: PhysicsBody,
  byId: Map<string, PhysicsBody>
): number {

  let depth = 0;

  let current: PhysicsBody | undefined =
    player;

  // Guard against accidental cycles.

  while (
    current?.standingOn &&
    depth < 8
  ) {

    current =
      byId.get(
        current.standingOn
      );

    depth++;
  }

  return depth;
}

/**
 * The player this one is currently
 * standing on, if the contact is still
 * valid. Clears the link otherwise.
 */
function resolveSupport(
  player: PhysicsBody,
  byId: Map<string, PhysicsBody>
): PhysicsBody | undefined {

  if (!player.standingOn) {
    return undefined;
  }

  const support =
    byId.get(
      player.standingOn
    );

  // Rising (jumped) players detach.

  if (
    !support ||
    player.velocityY < 0
  ) {

    player.standingOn =
      null;

    return undefined;
  }

  return support;
}

/**
 * Keeps a rider glued to the top of the
 * player beneath them, or detaches them if
 * they walked off.
 */
function keepStanding(
  rider: PhysicsBody,
  support: PhysicsBody
) {

  const overlapping =
    Math.abs(
      rider.x - support.x
    ) < PHYSICS.PLAYER_WIDTH;

  if (
    !overlapping ||
    rider.velocityY < 0
  ) {

    rider.standingOn =
      null;

    rider.grounded =
      false;

    return;
  }

  rider.y =
    support.y -
    PHYSICS.PLAYER_HEIGHT;

  rider.velocityY =
    0;

  rider.jumpCount =
    0;

  rider.grounded =
    true;
}

/**
 * True if any part of the player's feet
 * rests on solid ground, i.e. they are not
 * entirely over a pit.
 */
export function groundSupports(
  x: number,
  pits: Pit[]
): boolean {

  const half =
    PHYSICS.PLAYER_WIDTH / 2;

  const left =
    x - half;

  const right =
    x + half;

  return !pits.some(
    pit =>
      pit.x1 <= left &&
      pit.x2 >= right
  );
}

function landOnGround(
  player: PhysicsBody,
  startY: number,
  pits: Pit[]
): boolean {

  if (player.velocityY < 0) {
    return false;
  }

  const halfH =
    PHYSICS.PLAYER_HEIGHT / 2;

  const top =
    PHYSICS.GROUND_TOP;

  // Swept: the feet must have been above
  // the floor last tick. A player already
  // below it (falling through a pit) must
  // never be snapped back up by solid
  // ground at the pit's edge.

  if (
    startY + halfH > top + 1 ||
    player.y + halfH < top
  ) {
    return false;
  }

  if (
    !groundSupports(
      player.x,
      pits
    )
  ) {
    return false;
  }

  player.y =
    top - halfH;

  player.velocityY =
    0;

  player.jumpCount =
    0;

  player.grounded =
    true;

  return true;
}

/**
 * True if the player is touching any spike
 * strip. Deliberately forgiving: the feet
 * must sink into the spikes and the
 * overlap is shrunk at the sides.
 */
export function touchesSpikes(
  player: PhysicsBody,
  spikes: Spikes[]
): boolean {

  const halfW =
    PHYSICS.PLAYER_WIDTH / 2;

  const halfH =
    PHYSICS.PLAYER_HEIGHT / 2;

  const feet =
    player.y + halfH;

  const head =
    player.y - halfH;

  for (const strip of spikes) {

    const top =
      strip.y -
      PHYSICS.SPIKE_HEIGHT;

    if (
      Math.abs(
        player.x - strip.x
      ) <
        strip.width / 2 +
        halfW -
        PHYSICS.SPIKE_MARGIN &&
      feet >
        top +
        PHYSICS.SPIKE_SINK &&
      head < strip.y
    ) {

      return true;
    }
  }

  return false;
}

/**
 * Swept test: the player only lands if
 * their feet were at or above the platform
 * top on the previous tick, so fast falls
 * cannot tunnel and platforms stay one-way.
 */
function landOnPlatforms(
  player: PhysicsBody,
  startY: number,
  platforms: PhysicsPlatform[]
): boolean {

  if (player.velocityY < 0) {
    return false;
  }

  const halfW =
    PHYSICS.PLAYER_WIDTH / 2;

  const halfH =
    PHYSICS.PLAYER_HEIGHT / 2;

  const oldBottom =
    startY + halfH;

  const newBottom =
    player.y + halfH;

  for (const platform of platforms) {

    const top =
      platform.y -
      platform.height / 2;

    const overlapping =
      player.x + halfW >
        platform.x -
          platform.width / 2 &&
      player.x - halfW <
        platform.x +
          platform.width / 2;

    if (
      overlapping &&
      oldBottom <= top + 1 &&
      newBottom >= top
    ) {

      player.y =
        top - halfH;

      player.velocityY =
        0;

      player.jumpCount =
        0;

      player.grounded =
        true;

      return true;
    }
  }

  return false;
}

function landOnPlayer(
  faller: PhysicsBody,
  support: PhysicsBody,
  previous: Map<
    string,
    { x: number; y: number }
  >
) {

  // Already attached to this player.

  if (
    faller.standingOn ===
    support.id
  ) {
    return;
  }

  if (faller.velocityY < 0) {
    return;
  }

  if (
    Math.abs(
      faller.x - support.x
    ) >= PHYSICS.PLAYER_WIDTH
  ) {
    return;
  }

  const halfH =
    PHYSICS.PLAYER_HEIGHT / 2;

  const fallerBefore =
    previous.get(
      faller.id
    );

  const supportBefore =
    previous.get(
      support.id
    );

  if (
    !fallerBefore ||
    !supportBefore
  ) {
    return;
  }

  // Compare against where the support's
  // head WAS, so a support that jumps up
  // into a falling player (or sinks away
  // beneath one) is still handled.

  const oldFeet =
    fallerBefore.y + halfH;

  const oldHead =
    supportBefore.y - halfH;

  const newFeet =
    faller.y + halfH;

  const newHead =
    support.y - halfH;

  const crossedFromAbove =
    oldFeet <=
      oldHead +
        PHYSICS.LANDING_TOLERANCE &&
    newFeet >= newHead;

  if (!crossedFromAbove) {
    return;
  }

  faller.y =
    newHead - halfH;

  faller.velocityY =
    0;

  faller.jumpCount =
    0;

  faller.grounded =
    true;

  faller.standingOn =
    support.id;
}

function separatePlayers(
  players: PhysicsBody[]
) {

  for (let i = 0; i < players.length; i++) {

    for (
      let j = i + 1;
      j < players.length;
      j++
    ) {

      const a = players[i];

      const b = players[j];

      if (
        a.standingOn === b.id ||
        b.standingOn === a.id
      ) {
        continue;
      }

      const overlapX =
        PHYSICS.PLAYER_WIDTH -
        Math.abs(a.x - b.x);

      const overlapY =
        PHYSICS.PLAYER_HEIGHT -
        Math.abs(a.y - b.y);

      if (
        overlapX <= 0 ||
        overlapY <=
          PHYSICS.CONTACT_SLOP
      ) {
        continue;
      }

      // Identical x: split by array order
      // so the pair always separates.

      const direction =
        a.x === b.x
          ? -1
          : Math.sign(a.x - b.x);

      a.x =
        clampX(
          a.x +
            direction *
              overlapX / 2
        );

      b.x =
        clampX(
          b.x -
            direction *
              overlapX / 2
        );
    }
  }
}
