// ==========================================
// LATENCY
// ==========================================
//
// Round-trip time (ping) of the connection to
// the server, smoothed so the number on screen
// does not flicker, and sorted into a quality
// band players understand at a glance.
//
// Pure logic (no timers, no sockets).

export type Quality =
  | "good"
  | "ok"
  | "poor"
  | "offline";

/** Upper bounds (ms) of each band. */
export const QUALITY_LIMITS = {

  good: 80,

  ok: 160
} as const;

export function qualityOf(
  rttMs: number | null | undefined
): Quality {

  if (
    rttMs === null ||
    rttMs === undefined ||
    !Number.isFinite(rttMs)
  ) {

    return "offline";
  }

  if (rttMs <= QUALITY_LIMITS.good) {
    return "good";
  }

  if (rttMs <= QUALITY_LIMITS.ok) {
    return "ok";
  }

  return "poor";
}

export const QUALITY_COLORS: Record<
  Quality,
  number
> = {

  good: 0x44dd66,

  ok: 0xffcc33,

  poor: 0xff5544,

  offline: 0x888888
};

export class LatencyMeter {

  private average: number | null = null;

  private samples = 0;

  /** @param weight how much a new sample counts
   *  (0..1). Higher reacts faster. */
  constructor(
    private readonly weight = 0.3
  ) {}

  add(rttMs: number) {

    if (
      !Number.isFinite(rttMs) ||
      rttMs < 0
    ) {
      return;
    }

    this.average =
      this.average === null
        ? rttMs
        : this.average +
          (rttMs - this.average) *
            this.weight;

    this.samples++;
  }

  /** Smoothed round-trip time, or null before
   *  the first sample. */
  get rtt(): number | null {

    return this.average === null
      ? null
      : Math.round(this.average);
  }

  get count(): number {
    return this.samples;
  }

  get quality(): Quality {

    return qualityOf(this.rtt);
  }

  /** Connection gone: show "offline" until new
   *  samples arrive. */
  reset() {

    this.average = null;

    this.samples = 0;
  }
}
