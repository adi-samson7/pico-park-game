// ==========================================
// CLIENT-SIDE PREDICTION
// ==========================================
//
// The server owns the game: it decides where
// everybody is. But waiting for it to echo your
// own movement back would make every key press
// feel late by a full round trip.
//
// So the client runs the SAME physics code the
// server runs (server/src/physics.ts, copied to
// client/src/shared/physics.ts) on its own
// player, right away, and sends the inputs to
// the server too. The server's answers are then
// used to correct small differences:
//
//   - every input carries a sequence number
//   - every server state says "I have applied
//     your inputs up to number N"
//   - we compare the server's position with where
//     we predicted we would be after input N
//
// If the two disagree by more than the timing
// noise (the server and the client do not step at
// exactly the same instants): take the server's
// state, replay the inputs it has not seen yet,
// and let the screen position glide to the
// corrected one instead of jumping.
//
// Pure logic (no Phaser, no DOM) so it can be
// unit tested against the real server physics.

import {
  PHYSICS,
  stepPlayers,
  tryJump,
  type PhysicsBody,
  type PhysicsPlatform,
  type Pit
} from "../shared/physics.ts";

export interface InputState {

  left: boolean;

  right: boolean;

  jump: boolean;
}

/** What the server tells us about a player. */
export interface NetPlayer {

  id: string;

  x: number;
  y: number;

  velocityX?: number;
  velocityY?: number;

  alive?: boolean;

  jumpCount?: number;

  grounded?: boolean;

  standingOn?: string | null;

  // False while the player's connection is
  // down (they are not part of the world).
  connected?: boolean;

  // Last input sequence number the server
  // applied for this player.
  ack?: number;
}

export interface World {

  platforms: PhysicsPlatform[];

  pits: Pit[];
}

export interface PredictorOptions {

  // Differences below this are always ignored
  // (px). Faster movement tolerates more, see
  // tickTolerance.
  deadzone: number;

  // The server applies an input and steps its
  // physics on its own schedule, so even a
  // perfect prediction can be off by about one
  // tick of movement. Differences up to this
  // many ticks of the player's speed are
  // ignored.
  tickTolerance: number;

  // Velocity differences below this (px/s)
  // are ignored.
  velocityTolerance: number;

  // With no matching acknowledgement to compare
  // against, only a difference this large (px)
  // is acted on.
  farDistance: number;

  // How fast the screen position glides after
  // a big correction.
  offsetHalfLifeMs: number;

  // A correction bigger than this is not
  // smoothed: the player simply appears there.
  maxOffset: number;

  // Inputs kept while waiting for the server.
  historyLimit: number;
}

export const DEFAULT_PREDICTION: PredictorOptions = {

  deadzone: 2,

  tickTolerance: 1.6,

  velocityTolerance: 70,

  farDistance: 40,

  offsetHalfLifeMs: 70,

  maxOffset: 150,

  historyLimit: 180
};

interface Step {

  seq: number;

  input: InputState;

  dt: number;

  // Where we ended up after this step.
  x: number;
  y: number;

  vx: number;
  vy: number;
}

export class Predictor {

  // The predicted local player (physics
  // coordinates: centre of the box).
  body: PhysicsBody | null = null;

  // Highest input number handed out.
  seq = 0;

  // Screen position = body + offset. A big
  // correction moves the body at once and puts
  // the opposite in here, then lets it fade.
  offset = { x: 0, y: 0 };

  stats = {
    // Server states checked against us.
    checked: 0,

    // ...of which we had to be corrected.
    corrected: 0
  };

  // Size (px) of the most recent difference
  // between prediction and server.
  lastError = 0;

  private steps: Step[] = [];

  private others =
    new Map<string, NetPlayer>();

  private world: World = {
    platforms: [],
    pits: []
  };

  readonly options: PredictorOptions;

  constructor(
    readonly selfId: string,
    options: Partial<PredictorOptions> = {}
  ) {

    this.options = {
      ...DEFAULT_PREDICTION,
      ...options
    };
  }

  // ========================================
  // SETUP
  // ========================================

  setWorld(world: World) {

    this.world = world;
  }

  /** Forget the local body: the next server
   *  state creates it again (new level,
   *  reconnect, respawn). */
  reset() {

    this.body = null;

    this.steps = [];

    this.offset = { x: 0, y: 0 };
  }

  /** The other players, as of the newest
   *  server state. They are only obstacles and
   *  carriers for the local player. */
  setOthers(players: NetPlayer[]) {

    this.others.clear();

    for (const player of players) {

      if (
        player.id !== this.selfId &&
        player.connected !== false &&
        player.alive !== false
      ) {

        this.others.set(player.id, player);
      }
    }
  }

  // ========================================
  // INPUT
  // ========================================

  /**
   * Applies one frame of input to the local
   * player.
   *
   * @returns the input's sequence number to
   *          send to the server, or null when
   *          there is no body yet (no server
   *          state has arrived).
   */
  step(
    input: InputState,
    deltaSeconds: number
  ): number | null {

    if (!this.body) {
      return null;
    }

    const dt =
      Math.max(
        0,
        Math.min(
          deltaSeconds,
          PHYSICS.MAX_DT
        )
      );

    this.simulate(input, dt);

    this.seq++;

    this.steps.push({
      seq: this.seq,
      input: { ...input },
      dt,
      x: this.body.x,
      y: this.body.y,
      vx: this.body.velocityX,
      vy: this.body.velocityY
    });

    if (
      this.steps.length >
      this.options.historyLimit
    ) {

      this.steps.shift();
    }

    return this.seq;
  }

  /** The exact rules the server applies when
   *  an input arrives, then one physics tick. */
  private simulate(
    input: InputState,
    dt: number
  ) {

    const body = this.body!;

    if (input.left) {

      body.velocityX =
        -PHYSICS.MOVE_SPEED;

    } else if (input.right) {

      body.velocityX =
        PHYSICS.MOVE_SPEED;

    } else {

      body.velocityX = 0;
    }

    if (input.jump) {

      tryJump(body);
    }

    stepPlayers(
      [body, ...this.obstacles()],
      this.world.platforms,
      dt,
      this.world.pits
    );
  }

  private obstacles(): PhysicsBody[] {

    return Array.from(
      this.others.values(),
      player => ({
        id: player.id,
        x: player.x,
        y: player.y,
        velocityX: player.velocityX ?? 0,
        velocityY: player.velocityY ?? 0,
        alive: true,
        jumpCount: player.jumpCount ?? 0,
        grounded: player.grounded ?? false,
        standingOn: player.standingOn ?? null
      })
    );
  }

  // ========================================
  // SERVER STATE
  // ========================================

  /** Compares the server's view of the local
   *  player with our prediction. */
  reconcile(server: NetPlayer) {

    if (!this.body) {

      this.adopt(server);

      return;
    }

    const ack = server.ack ?? 0;

    const index =
      this.steps.findIndex(
        step => step.seq === ack
      );

    // The server has not seen any input of
    // ours that we still remember (just
    // spawned, or the numbers restarted).
    // Only act if we are clearly elsewhere.

    if (index === -1) {

      const distance =
        Math.hypot(
          server.x - this.body.x,
          server.y - this.body.y
        );

      if (
        distance >
        this.options.farDistance
      ) {

        this.steps = [];

        this.correct(server, []);
      }

      return;
    }

    // Everything older than the acknowledged
    // step has been seen by the server.

    this.steps.splice(0, index);

    const acknowledged =
      this.steps[0];

    const error =
      Math.hypot(
        server.x - acknowledged.x,
        server.y - acknowledged.y
      );

    const velocityError =
      Math.hypot(
        (server.velocityX ?? 0) -
          acknowledged.vx,
        (server.velocityY ?? 0) -
          acknowledged.vy
      );

    this.lastError = error;

    this.stats.checked++;

    // About one tick of movement is noise.

    const speed =
      Math.hypot(
        server.velocityX ?? 0,
        server.velocityY ?? 0
      );

    const tolerance =
      Math.max(
        this.options.deadzone,
        (speed / 60) *
          this.options.tickTolerance
      );

    if (
      error <= tolerance &&
      velocityError <=
        this.options.velocityTolerance
    ) {
      return;
    }

    this.correct(
      server,
      this.steps.slice(1)
    );
  }

  /** Take the server's word for where we were
   *  and play our not-yet-acknowledged inputs
   *  on top. */
  private correct(
    server: NetPlayer,
    unseen: Step[]
  ) {

    const before = {
      x: this.body!.x,
      y: this.body!.y
    };

    this.adopt(server);

    if (this.steps.length > 0) {

      this.steps[0].x = server.x;
      this.steps[0].y = server.y;

      this.steps[0].vx =
        this.body!.velocityX;

      this.steps[0].vy =
        this.body!.velocityY;
    }

    for (const step of unseen) {

      this.simulate(
        step.input,
        step.dt
      );

      step.x = this.body!.x;
      step.y = this.body!.y;

      step.vx = this.body!.velocityX;
      step.vy = this.body!.velocityY;
    }

    // Keep the screen position continuous.

    this.offset.x +=
      before.x - this.body!.x;

    this.offset.y +=
      before.y - this.body!.y;

    if (
      Math.hypot(
        this.offset.x,
        this.offset.y
      ) > this.options.maxOffset
    ) {

      this.offset = { x: 0, y: 0 };
    }

    this.stats.corrected++;
  }

  private adopt(server: NetPlayer) {

    this.body = {
      id: this.selfId,
      x: server.x,
      y: server.y,
      velocityX: server.velocityX ?? 0,
      velocityY: server.velocityY ?? 0,
      alive: true,
      jumpCount: server.jumpCount ?? 0,
      grounded: server.grounded ?? false,
      standingOn: server.standingOn ?? null
    };
  }

  // ========================================
  // OUTPUT
  // ========================================

  /** Lets a correction fade out. Call every
   *  frame. */
  decay(deltaSeconds: number) {

    const keep =
      Math.pow(
        0.5,
        deltaSeconds * 1000 /
          this.options.offsetHalfLifeMs
      );

    this.offset.x *= keep;
    this.offset.y *= keep;

    if (
      Math.abs(this.offset.x) < 0.05 &&
      Math.abs(this.offset.y) < 0.05
    ) {

      this.offset = { x: 0, y: 0 };
    }
  }

  /** Where to draw the local player. */
  render(): { x: number; y: number } | null {

    if (!this.body) {
      return null;
    }

    return {
      x: this.body.x + this.offset.x,
      y: this.body.y + this.offset.y
    };
  }
}
