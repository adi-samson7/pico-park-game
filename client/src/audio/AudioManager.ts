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

// Sound is ON unless the player has turned it off with M or
// the speaker. The choice is remembered in the browser.
//
// The key carries a version: an earlier release saved the
// choice under "pico.muted", and a browser where it was ever
// switched off would stay silent forever. Reading a new key
// starts everybody with sound on once; from then on their own
// choice is kept.
const MUTE_KEY = "pico.muted.v2";

const OLD_MUTE_KEY = "pico.muted";

// How loud music and effects are (each 0 to 1, in the
// settings menu), remembered like the mute choice.
const VOLUME_KEY = "pico.volume.v1";

// What "full volume" means for each bus.
const BASE_SFX = 0.8;

const BASE_MUSIC = 0.16;

// A number from 0 to 1 (anything else: `fallback`).
function clampLevel(
  value: unknown,
  fallback = 1
): number {

  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.max(
    0,
    Math.min(1, value)
  );
}

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

  // 0..1: the settings sliders.
  private musicLevelValue = 1;

  private sfxLevelValue = 1;

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

    this.loadVolumes();

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
        BASE_SFX * this.sfxLevelValue;

      this.musicBus =
        this.ctx.createGain();

      this.musicBus.gain.value =
        BASE_MUSIC * this.musicLevelValue;

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

  // ========================================
  // VOLUME (music and effects)
  // ========================================

  get musicLevel(): number {
    return this.musicLevelValue;
  }

  get sfxLevel(): number {
    return this.sfxLevelValue;
  }

  setMusicLevel(level: number) {

    this.musicLevelValue =
      clampLevel(level);

    if (this.musicBus) {

      this.musicBus.gain.value =
        BASE_MUSIC * this.musicLevelValue;
    }

    this.saveVolumes();
  }

  setSfxLevel(level: number) {

    this.sfxLevelValue =
      clampLevel(level);

    if (this.sfxBus) {

      this.sfxBus.gain.value =
        BASE_SFX * this.sfxLevelValue;
    }

    this.saveVolumes();
  }

  private loadVolumes() {

    try {

      const saved =
        JSON.parse(
          window.localStorage.getItem(
            VOLUME_KEY
          ) ?? "null"
        );

      if (saved && typeof saved === "object") {

        this.musicLevelValue =
          clampLevel(saved.music, 1);

        this.sfxLevelValue =
          clampLevel(saved.sfx, 1);
      }

    } catch {
      // storage blocked or damaged: full volume
    }
  }

  private saveVolumes() {

    try {

      window.localStorage.setItem(
        VOLUME_KEY,
        JSON.stringify({
          music: this.musicLevelValue,
          sfx: this.sfxLevelValue
        })
      );

    } catch {
      // ignore
    }
  }

  // localStorage can throw (private mode,
  // blocked storage): never let it break
  // the game.

  private loadMuted(): boolean {

    try {

      // the old choice is not used any more
      window.localStorage.removeItem(
        OLD_MUTE_KEY
      );

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
