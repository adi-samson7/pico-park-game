// ==========================================
// SNAPSHOT INTERPOLATION
// ==========================================
//
// The server sends every player's position
// about 60 times a second, but the packets do
// not arrive evenly: the network adds jitter.
// Drawing each one the moment it arrives makes
// other players stutter.
//
// Instead remote players are drawn a little in
// the PAST (the "interpolation delay"), always
// between two snapshots we already have. A late
// packet then just fills a gap that has not
// been drawn yet.
//
// Pure logic (no Phaser, no DOM, no timers) so
// it can be unit tested.

export interface Snapshot {

  // Local arrival time, in milliseconds.
  t: number;

  x: number;
  y: number;
}

export class SnapshotBuffer {

  private snapshots: Snapshot[] = [];

  /**
   * @param keepMs         how much history to keep
   * @param teleportPixels a jump bigger than this
   *                       between two snapshots is a
   *                       respawn: do not slide
   *                       across the screen
   */
  constructor(
    private readonly keepMs = 1000,
    private readonly teleportPixels = 90
  ) {}

  get length(): number {
    return this.snapshots.length;
  }

  get newest(): Snapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  clear() {
    this.snapshots = [];
  }

  push(t: number, x: number, y: number) {

    const last = this.newest;

    // Arrival times only move forward. A
    // snapshot with the same time replaces
    // the previous one.

    if (last && t < last.t) {
      return;
    }

    if (last && t === last.t) {

      last.x = x;
      last.y = y;

      return;
    }

    this.snapshots.push({ t, x, y });

    // Forget what is too old to be needed,
    // but never the newest one.

    const horizon = t - this.keepMs;

    while (
      this.snapshots.length > 2 &&
      this.snapshots[1].t < horizon
    ) {
      this.snapshots.shift();
    }
  }

  /**
   * Where the player should be drawn at time
   * `renderTime` (already shifted into the
   * past by the caller).
   *
   * Before the first snapshot: the first one.
   * After the newest: the newest (hold still
   * rather than guess).
   */
  sample(
    renderTime: number
  ): { x: number; y: number } | null {

    const list = this.snapshots;

    if (list.length === 0) {
      return null;
    }

    if (renderTime <= list[0].t) {
      return { x: list[0].x, y: list[0].y };
    }

    const last = list[list.length - 1];

    if (renderTime >= last.t) {
      return { x: last.x, y: last.y };
    }

    // Find the pair around renderTime.

    let i = list.length - 1;

    while (i > 0 && list[i - 1].t > renderTime) {
      i--;
    }

    const a = list[i - 1];
    const b = list[i];

    // A respawn: stay at the old spot until
    // the new one is reached, then jump.

    if (
      Math.hypot(b.x - a.x, b.y - a.y) >
      this.teleportPixels
    ) {

      return renderTime >= b.t
        ? { x: b.x, y: b.y }
        : { x: a.x, y: a.y };
    }

    const f =
      (renderTime - a.t) / (b.t - a.t);

    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f
    };
  }
}
