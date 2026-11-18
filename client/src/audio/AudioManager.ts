import {
  SFX_NAMES,
  playSfx,
  type SfxName,
  type SfxOptions
} from "./synth";

// ==========================================
// MUSIC
// ==========================================
//
// Tiny step sequencer. Each track is a loop
// of 8th-note steps: semitone offsets above
// the root (null = rest).

export type MusicName =
  | "menu"
  | "game";

interface Track {

  bpm: number;

  // Root of the key (Hz).
  root: number;

  lead: (number | null)[];

  bass: (number | null)[];

  leadType: OscillatorType;
}

const TRACKS: Record<
  MusicName,
  Track
> = {

  // Calm and friendly.
  menu: {

    bpm: 92,

    root: 261.63,

    leadType: "triangle",

    lead: [
      0, 4, 7, 12, 7, 4, 7, null,
      2, 5, 9, 14, 9, 5, 9, null,
      4, 7, 11, 16, 11, 7, 11, null,
      2, 7, 9, 7, 4, 2, 0, null
    ],

    bass: [
      -12, null, null, null, -12, null, null, null,
      -10, null, null, null, -10, null, null, null,
      -8, null, null, null, -8, null, null, null,
      -10, null, null, null, -12, null, null, null
    ]
  },

  // A bit more driving for gameplay.
  game: {

    bpm: 128,

    root: 220.0,

    leadType: "square",

    lead: [
      12, null, 15, 12, 17, null, 15, 12,
      10, null, 12, 10, 15, null, 12, 10,
      8, null, 12, 8, 15, null, 12, 8,
      10, 12, 15, 17, 15, 12, 10, null
    ],

    bass: [
      0, null, 0, 0, 0, null, 0, null,
      -2, null, -2, -2, -2, null, -2, null,
      -4, null, -4, -4, -4, null, -4, null,
      -2, null, -2, -2, 0, null, 0, null
    ]
  }
};

const MUTE_KEY = "pico.muted";

// ==========================================
// AUDIO MANAGER
// ==========================================

class AudioManager {

  private ctx: AudioContext | null =
    null;

  private master: GainNode | null =
    null;

  private sfxBus: GainNode | null =
    null;

  private musicBus: GainNode | null =
    null;

  private analyser:
    AnalyserNode | null =
    null;

  private analyserBuffer:
    Float32Array<ArrayBuffer> | null =
    null;

  private muted = false;

  // Track the game wants playing (it
  // starts once audio is unlocked).
  private wantedMusic:
    MusicName | null =
    null;

  private activeMusic:
    MusicName | null =
    null;

  private musicTimer:
    number | null =
    null;

  private nextStepTime = 0;

  private step = 0;

  // Listeners told about mute changes.
  private muteListeners:
    Array<(muted: boolean) => void> =
    [];

  constructor() {

    this.muted =
      this.loadMuted();

    if (
      typeof window !==
      "undefined"
    ) {

      // Browsers only allow audio after a
      // user gesture.

      const unlock = () => {

        this.unlock();
      };

      window.addEventListener(
        "pointerdown",
        unlock
      );

      window.addEventListener(
        "keydown",
        unlock
      );
    }
  }

  // ========================================
  // UNLOCK
  // ========================================

  unlock() {

    if (!this.ctx) {

      const Ctor =
        window.AudioContext ||
        (
          window as unknown as {
            webkitAudioContext?:
              typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!Ctor) {
        return;
      }

      this.ctx =
        new Ctor();

      this.master =
        this.ctx.createGain();

      this.master.gain.value =
        this.muted ? 0 : 1;

      this.analyser =
        this.ctx.createAnalyser();

      this.analyser.fftSize =
        1024;

      this.analyserBuffer =
        new Float32Array(
          this.analyser.fftSize
        );

      this.sfxBus =
        this.ctx.createGain();

      this.sfxBus.gain.value =
        0.8;

      this.musicBus =
        this.ctx.createGain();

      this.musicBus.gain.value =
        0.16;

      this.sfxBus.connect(
        this.master
      );

      this.musicBus.connect(
        this.master
      );

      this.master.connect(
        this.analyser
      );

      this.analyser.connect(
        this.ctx.destination
      );
    }

    if (
      this.ctx.state ===
      "suspended"
    ) {

      void this.ctx.resume();
    }

    if (this.wantedMusic) {

      this.startMusic(
        this.wantedMusic
      );
    }
  }

  get running(): boolean {

    return (
      this.ctx !== null &&
      this.ctx.state ===
        "running"
    );
  }

  // ========================================
  // SFX
  // ========================================

  sfx(
    name: SfxName,
    options: SfxOptions = {}
  ) {

    if (
      !this.ctx ||
      !this.sfxBus ||
      !this.running
    ) {
      return;
    }

    try {

      playSfx(
        this.ctx,
        this.sfxBus,
        name,
        this.ctx.currentTime + 0.005,
        options
      );

    } catch (error) {

      console.warn(
        "sfx failed:",
        name,
        error
      );
    }
  }

  // ========================================
  // MUSIC
  // ========================================

  playMusic(
    name: MusicName | null
  ) {

    this.wantedMusic =
      name;

    if (name === null) {

      this.stopMusic();

      return;
    }

    if (
      this.running &&
      this.activeMusic !== name
    ) {

      this.startMusic(
        name
      );
    }
  }

  stopMusic() {

    this.wantedMusic =
      null;

    this.activeMusic =
      null;

    if (
      this.musicTimer !== null
    ) {

      window.clearInterval(
        this.musicTimer
      );

      this.musicTimer =
        null;
    }
  }

  private startMusic(
    name: MusicName
  ) {

    if (
      !this.ctx ||
      !this.running ||
      this.activeMusic === name
    ) {
      return;
    }

    if (
      this.musicTimer !== null
    ) {

      window.clearInterval(
        this.musicTimer
      );
    }

    this.activeMusic =
      name;

    this.step = 0;

    this.nextStepTime =
      this.ctx.currentTime + 0.1;

    this.musicTimer =
      window.setInterval(
        () =>
          this.scheduleMusic(),
        50
      );

    this.scheduleMusic();
  }

  // Queue every step that falls inside the
  // next 200 ms.

  private scheduleMusic() {

    const ctx =
      this.ctx;

    const name =
      this.activeMusic;

    if (
      !ctx ||
      !this.musicBus ||
      !name
    ) {
      return;
    }

    const track =
      TRACKS[name];

    const stepSeconds =
      60 / track.bpm / 2;

    while (
      this.nextStepTime <
      ctx.currentTime + 0.2
    ) {

      const i =
        this.step %
        track.lead.length;

      const lead =
        track.lead[i];

      const bass =
        track.bass[i];

      if (lead !== null) {

        this.musicNote(
          track.root *
            Math.pow(
              2,
              lead / 12
            ),
          this.nextStepTime,
          stepSeconds * 0.9,
          track.leadType,
          0.5
        );
      }

      if (bass !== null) {

        this.musicNote(
          track.root *
            Math.pow(
              2,
              bass / 12
            ),
          this.nextStepTime,
          stepSeconds * 3.6,
          "sine",
          0.9
        );
      }

      this.nextStepTime +=
        stepSeconds;

      this.step++;
    }
  }

  private musicNote(
    frequency: number,
    when: number,
    duration: number,
    type: OscillatorType,
    volume: number
  ) {

    if (
      !this.ctx ||
      !this.musicBus
    ) {
      return;
    }

    const osc =
      this.ctx.createOscillator();

    osc.type =
      type;

    osc.frequency.value =
      frequency;

    const gain =
      this.ctx.createGain();

    gain.gain.setValueAtTime(
      0.0001,
      when
    );

    gain.gain.exponentialRampToValueAtTime(
      volume,
      when + 0.01
    );

    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      when + duration
    );

    osc.connect(gain);

    gain.connect(
      this.musicBus
    );

    osc.start(when);

    osc.stop(
      when + duration + 0.02
    );
  }

  // ========================================
  // MUTE
  // ========================================

  get isMuted(): boolean {

    return this.muted;
  }

  toggleMute(): boolean {

    this.muted =
      !this.muted;

    if (this.master) {

      this.master.gain.value =
        this.muted ? 0 : 1;
    }

    this.saveMuted();

    for (
      const listener
      of this.muteListeners
    ) {

      listener(
        this.muted
      );
    }

    return this.muted;
  }

  onMuteChange(
    listener: (
      muted: boolean
    ) => void
  ): () => void {

    this.muteListeners.push(
      listener
    );

    return () => {

      this.muteListeners =
        this.muteListeners.filter(
          l => l !== listener
        );
    };
  }

  // localStorage can throw (private mode,
  // blocked storage): never let it break
  // the game.

  private loadMuted(): boolean {

    try {

      return (
        window.localStorage.getItem(
          MUTE_KEY
        ) === "1"
      );

    } catch {

      return false;
    }
  }

  private saveMuted() {

    try {

      window.localStorage.setItem(
        MUTE_KEY,
        this.muted ? "1" : "0"
      );

    } catch {
      // ignore
    }
  }

  // ========================================
  // TEST HELPERS
  // ========================================

  /** Loudest recent sample (0..1) at the
   *  master output. */
  peak(): number {

    if (
      !this.analyser ||
      !this.analyserBuffer
    ) {
      return 0;
    }

    this.analyser.getFloatTimeDomainData(
      this.analyserBuffer
    );

    let max = 0;

    for (
      const sample
      of this.analyserBuffer
    ) {

      max =
        Math.max(
          max,
          Math.abs(sample)
        );
    }

    return max;
  }

  /** Renders one effect offline and
   *  measures it. */
  async measure(
    name: SfxName,
    options: SfxOptions = {}
  ): Promise<{
    peak: number;
    rms: number;
    seconds: number;
    audibleSeconds: number;
  }> {

    const rate = 44100;

    const offline =
      new OfflineAudioContext(
        1,
        rate * 3,
        rate
      );

    const seconds =
      playSfx(
        offline,
        offline.destination,
        name,
        0,
        options
      );

    const rendered =
      await offline.startRendering();

    const data =
      rendered.getChannelData(0);

    let peak = 0;

    let sum = 0;

    let audible = 0;

    for (const sample of data) {

      const a =
        Math.abs(sample);

      peak =
        Math.max(peak, a);

      sum +=
        sample * sample;

      if (a > 0.01) {
        audible++;
      }
    }

    return {

      peak,

      rms:
        Math.sqrt(
          sum / data.length
        ),

      seconds,

      audibleSeconds:
        audible / rate
    };
  }

  get sfxNames(): SfxName[] {

    return SFX_NAMES;
  }
}

export const audio =
  new AudioManager();
