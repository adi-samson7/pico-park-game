// ==========================================
// SYNTH
// ==========================================
//
// Every sound effect is generated with the
// Web Audio API, so the game needs no audio
// files. These functions only depend on the
// BaseAudioContext interface, which means
// they run the same on a live AudioContext
// and on an OfflineAudioContext (used to
// measure the sounds in tests).

export type SfxName =
  | "click"
  | "ready"
  | "unready"
  | "join"
  | "leave"
  | "start"
  | "jump"
  | "doubleJump"
  | "land"
  | "crystal"
  | "doorOpen"
  | "spikes"
  | "fall"
  | "respawn"
  | "levelComplete"
  | "win";

export const SFX_NAMES: SfxName[] = [
  "click",
  "ready",
  "unready",
  "join",
  "leave",
  "start",
  "jump",
  "doubleJump",
  "land",
  "crystal",
  "doorOpen",
  "spikes",
  "fall",
  "respawn",
  "levelComplete",
  "win"
];

export interface SfxOptions {

  // 0..1, multiplies the sound's own level.
  volume?: number;

  // Frequency multiplier (1 = normal).
  pitch?: number;
}

// Note frequencies (Hz).
export const NOTE = {
  C4: 261.63,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.5,
  G6: 1568.0
} as const;

interface ToneSpec {

  from: number;

  to?: number;

  duration: number;

  type?: OscillatorType;

  volume?: number;

  // Seconds after the sound's start.
  delay?: number;
}

function tone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  start: number,
  spec: ToneSpec
) {

  const t =
    start + (spec.delay ?? 0);

  const osc =
    ctx.createOscillator();

  osc.type =
    spec.type ?? "square";

  osc.frequency.setValueAtTime(
    spec.from,
    t
  );

  if (
    spec.to !== undefined &&
    spec.to !== spec.from
  ) {

    osc.frequency.exponentialRampToValueAtTime(
      Math.max(spec.to, 1),
      t + spec.duration
    );
  }

  const gain =
    ctx.createGain();

  const peak =
    spec.volume ?? 0.3;

  gain.gain.setValueAtTime(
    0.0001,
    t
  );

  gain.gain.exponentialRampToValueAtTime(
    peak,
    t + 0.006
  );

  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    t + spec.duration
  );

  osc.connect(gain);

  gain.connect(dest);

  osc.start(t);

  osc.stop(
    t + spec.duration + 0.02
  );
}

interface NoiseSpec {

  duration: number;

  volume?: number;

  // Filter cutoff (Hz).
  frequency: number;

  type?: BiquadFilterType;

  delay?: number;
}

function noise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  start: number,
  spec: NoiseSpec
) {

  const t =
    start + (spec.delay ?? 0);

  const length =
    Math.max(
      1,
      Math.floor(
        ctx.sampleRate *
          spec.duration
      )
    );

  const buffer =
    ctx.createBuffer(
      1,
      length,
      ctx.sampleRate
    );

  const data =
    buffer.getChannelData(0);

  for (
    let i = 0;
    i < length;
    i++
  ) {

    data[i] =
      Math.random() * 2 - 1;
  }

  const source =
    ctx.createBufferSource();

  source.buffer =
    buffer;

  const filter =
    ctx.createBiquadFilter();

  filter.type =
    spec.type ?? "lowpass";

  filter.frequency.value =
    spec.frequency;

  const gain =
    ctx.createGain();

  gain.gain.setValueAtTime(
    spec.volume ?? 0.3,
    t
  );

  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    t + spec.duration
  );

  source.connect(filter);

  filter.connect(gain);

  gain.connect(dest);

  source.start(t);
}

/**
 * Plays a sound effect starting at `start`.
 *
 * @returns the effect's length in seconds.
 */
export function playSfx(
  ctx: BaseAudioContext,
  dest: AudioNode,
  name: SfxName,
  start: number,
  options: SfxOptions = {}
): number {

  const pitch =
    options.pitch ?? 1;

  // Everything routes through one gain so
  // `volume` scales the whole effect.

  const bus =
    ctx.createGain();

  bus.gain.value =
    options.volume ?? 1;

  bus.connect(dest);

  const t = (
    spec: ToneSpec
  ) =>
    tone(
      ctx,
      bus,
      start,
      {
        ...spec,

        from:
          spec.from * pitch,

        to:
          spec.to === undefined
            ? undefined
            : spec.to * pitch
      }
    );

  const n = (
    spec: NoiseSpec
  ) =>
    noise(
      ctx,
      bus,
      start,
      spec
    );

  switch (name) {

    // ------------------------------------
    // UI
    // ------------------------------------

    case "click":

      t({
        from: 700,
        to: 480,
        duration: 0.09,
        type: "square",
        volume: 0.26
      });

      return 0.11;

    case "ready":

      t({
        from: 520,
        duration: 0.07,
        type: "triangle",
        volume: 0.3
      });

      t({
        from: 780,
        duration: 0.11,
        type: "triangle",
        volume: 0.3,
        delay: 0.07
      });

      return 0.2;

    case "unready":

      t({
        from: 700,
        duration: 0.07,
        type: "triangle",
        volume: 0.25
      });

      t({
        from: 440,
        duration: 0.11,
        type: "triangle",
        volume: 0.25,
        delay: 0.07
      });

      return 0.2;

    case "join":

      t({
        from: 392,
        duration: 0.08,
        type: "sine",
        volume: 0.3
      });

      t({
        from: 587,
        duration: 0.14,
        type: "sine",
        volume: 0.3,
        delay: 0.08
      });

      return 0.25;

    case "leave":

      t({
        from: 587,
        duration: 0.08,
        type: "sine",
        volume: 0.25
      });

      t({
        from: 392,
        duration: 0.14,
        type: "sine",
        volume: 0.25,
        delay: 0.08
      });

      return 0.25;

    case "start":

      [
        NOTE.C5,
        NOTE.E5,
        NOTE.G5,
        NOTE.C6
      ].forEach(
        (freq, i) =>
          t({
            from: freq,
            duration: 0.12,
            type: "square",
            volume: 0.22,
            delay: i * 0.07
          })
      );

      return 0.45;

    // ------------------------------------
    // MOVEMENT
    // ------------------------------------

    case "jump":

      t({
        from: 300,
        to: 640,
        duration: 0.13,
        type: "square",
        volume: 0.2
      });

      return 0.15;

    case "doubleJump":

      t({
        from: 460,
        to: 980,
        duration: 0.15,
        type: "square",
        volume: 0.2
      });

      t({
        from: 920,
        to: 1400,
        duration: 0.08,
        type: "triangle",
        volume: 0.14,
        delay: 0.06
      });

      return 0.2;

    case "land":

      n({
        duration: 0.1,
        frequency: 700,
        volume: 0.55
      });

      t({
        from: 170,
        to: 60,
        duration: 0.12,
        type: "sine",
        volume: 0.45
      });

      return 0.14;

    // ------------------------------------
    // GAMEPLAY
    // ------------------------------------

    case "crystal":

      t({
        from: NOTE.E5,
        duration: 0.08,
        type: "triangle",
        volume: 0.28
      });

      t({
        from: NOTE.A5,
        duration: 0.16,
        type: "triangle",
        volume: 0.28,
        delay: 0.07
      });

      return 0.28;

    case "doorOpen":

      [
        NOTE.C5,
        NOTE.E5,
        NOTE.G5,
        NOTE.C6,
        NOTE.E6
      ].forEach(
        (freq, i) =>
          t({
            from: freq,
            duration: 0.16,
            type: "triangle",
            volume: 0.26,
            delay: i * 0.08
          })
      );

      n({
        duration: 0.35,
        frequency: 2500,
        type: "highpass",
        volume: 0.08
      });

      return 0.6;

    case "spikes":

      n({
        duration: 0.22,
        frequency: 1800,
        volume: 0.35
      });

      t({
        from: 420,
        to: 70,
        duration: 0.28,
        type: "sawtooth",
        volume: 0.22
      });

      return 0.3;

    case "fall":

      t({
        from: 900,
        to: 90,
        duration: 0.55,
        type: "sine",
        volume: 0.28
      });

      n({
        duration: 0.2,
        frequency: 600,
        volume: 0.12,
        delay: 0.5
      });

      return 0.7;

    case "respawn":

      t({
        from: 300,
        to: 900,
        duration: 0.18,
        type: "triangle",
        volume: 0.2
      });

      return 0.2;

    case "levelComplete":

      [
        NOTE.C5,
        NOTE.E5,
        NOTE.G5,
        NOTE.C6,
        NOTE.G5,
        NOTE.C6
      ].forEach(
        (freq, i) =>
          t({
            from: freq,
            duration: i >= 4 ? 0.3 : 0.12,
            type: "square",
            volume: 0.22,
            delay:
              i < 4
                ? i * 0.1
                : 0.4 + (i - 4) * 0.14
          })
      );

      return 0.9;

    case "win":

      [
        [NOTE.C5, 0],
        [NOTE.E5, 0.12],
        [NOTE.G5, 0.24],
        [NOTE.C6, 0.36],
        [NOTE.G5, 0.6],
        [NOTE.A5, 0.72],
        [NOTE.G5, 0.84],
        [NOTE.E6, 1.0],
        [NOTE.G6, 1.2]
      ].forEach(
        ([freq, delay]) =>
          t({
            from: freq,
            duration: 0.25,
            type: "square",
            volume: 0.22,
            delay
          })
      );

      [
        NOTE.C4,
        NOTE.E4,
        NOTE.G4
      ].forEach(
        freq =>
          t({
            from: freq,
            duration: 0.9,
            type: "triangle",
            volume: 0.15,
            delay: 1.2
          })
      );

      return 2.1;
  }
}
