import fs from "node:fs";
import path from "node:path";

import { NAME_MAX, sanitizeName } from "./profile.js";

import { log } from "./log.js";

// ==========================================
// LEADERBOARD: BEST LEVEL TIMES
// ==========================================
//
// One entry per cleared level: how long the level was
// played (counted by the server, from the end of the
// "LEVEL N" screen to the moment everybody was in the
// door), who played it and how many they were.
//
// Boards are kept per level AND per team size: four
// players are not racing one. `level` 0 is the whole
// game (all levels added up) and gets its own board.

// The "level" of the entry for a whole game.
export const FULL_RUN = 0;

export const MAX_TEAM = 4;

export interface LeaderboardEntry {

  // 1.. = a level, 0 = the full run.
  level: number;

  // Time in milliseconds.
  ms: number;

  // Who played (as named at the time).
  names: string[];

  // How many played.
  size: number;

  // When (milliseconds since the epoch).
  at: number;
}

export interface Placement {

  // 1 = the best time for this level and team size.
  // null: not good enough to be kept.
  rank: number | null;

  // A new best.
  record: boolean;

  // The time that was best before (ms), if any.
  previousBest: number | null;

  size: number;
}

export interface LeaderboardStore {

  /** Whatever was saved (validated by the Leaderboard). */
  load(): unknown;

  save(entries: LeaderboardEntry[]): void;
}

// ------------------------------------------
// VALIDATION
// ------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function cleanEntry(
  raw: any
): LeaderboardEntry | null {

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const { level, ms, names, size, at } = raw;

  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > 99 ||
    typeof ms !== "number" ||
    !Number.isFinite(ms) ||
    ms <= 0 ||
    ms > ONE_DAY_MS ||
    !Array.isArray(names) ||
    names.length < 1 ||
    names.length > MAX_TEAM ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_TEAM ||
    typeof at !== "number" ||
    !Number.isFinite(at)
  ) {
    return null;
  }

  const cleanNames =
    names.map(
      (name: unknown) =>
        sanitizeName(name).slice(0, NAME_MAX) || "?"
    );

  return {
    level,
    ms: Math.round(ms),
    names: cleanNames,
    size,
    at
  };
}

// ------------------------------------------
// THE BOARD
// ------------------------------------------

const byTime = (
  a: LeaderboardEntry,
  b: LeaderboardEntry
) =>
  a.ms - b.ms || a.at - b.at;

export class Leaderboard {

  private entries: LeaderboardEntry[] = [];

  /**
   * @param store         where it is kept (none: memory only)
   * @param keepPerBoard  best entries kept per level and team size
   */
  constructor(
    private readonly store?: LeaderboardStore,
    private readonly keepPerBoard = 100
  ) {

    this.load();
  }

  private load() {

    let raw: unknown;

    try {
      raw = this.store?.load();
    } catch (error) {

      log("Leaderboard could not be read:", String(error));

      return;
    }

    if (!Array.isArray(raw)) {
      return;
    }

    for (const item of raw) {

      const entry = cleanEntry(item);

      if (entry) {
        this.entries.push(entry);
      }
    }

    // Anything beyond the limit (a file edited by hand).
    this.trim();
  }

  get size(): number {
    return this.entries.length;
  }

  private board(
    level: number,
    size: number
  ): LeaderboardEntry[] {

    return this.entries
      .filter(
        entry =>
          entry.level === level &&
          entry.size === size
      )
      .sort(byTime);
  }

  private trim() {

    const boards = new Map<string, LeaderboardEntry[]>();

    for (const entry of this.entries) {

      const key = `${entry.level}/${entry.size}`;

      const list = boards.get(key) ?? [];

      list.push(entry);

      boards.set(key, list);
    }

    this.entries = [];

    for (const list of boards.values()) {

      this.entries.push(
        ...list
          .sort(byTime)
          .slice(0, this.keepPerBoard)
      );
    }
  }

  /**
   * Adds a result and says where it landed among the
   * results of the same level and team size.
   */
  record(
    entry: LeaderboardEntry
  ): Placement {

    const clean = cleanEntry(entry);

    if (!clean) {

      return {
        rank: null,
        record: false,
        previousBest: null,
        size: entry?.size ?? 0
      };
    }

    const before = this.board(clean.level, clean.size);

    const previousBest = before[0]?.ms ?? null;

    // Ahead of everything that is faster, or equally fast
    // but earlier.
    const rank =
      1 + before.filter(
        other =>
          byTime(other, clean) <= 0
      ).length;

    if (rank > this.keepPerBoard) {

      return {
        rank: null,
        record: false,
        previousBest,
        size: clean.size
      };
    }

    this.entries.push(clean);

    this.trim();

    this.persist();

    return {
      rank,
      record: rank === 1,
      previousBest,
      size: clean.size
    };
  }

  private persist() {

    try {
      this.store?.save(this.entries);
    } catch (error) {

      // The game must never stop because a disk is full.
      log("Leaderboard could not be saved:", String(error));
    }
  }

  /**
   * The best `limit` results of a level. `size` 0 mixes
   * all team sizes.
   */
  top(
    level: number,
    size = 0,
    limit = 10
  ): LeaderboardEntry[] {

    return this.entries
      .filter(
        entry =>
          entry.level === level &&
          (size === 0 || entry.size === size)
      )
      .sort(byTime)
      .slice(0, limit);
  }

  /** Every board, for the screen that shows them. */
  boards(
    maxLevels: number,
    size = 0,
    limit = 10
  ): Record<string, LeaderboardEntry[]> {

    const result: Record<string, LeaderboardEntry[]> = {};

    for (let level = 1; level <= maxLevels; level++) {
      result[String(level)] = this.top(level, size, limit);
    }

    result[String(FULL_RUN)] = this.top(FULL_RUN, size, limit);

    return result;
  }
}

// ------------------------------------------
// KEPT IN A FILE
// ------------------------------------------

/**
 * A JSON file, written safely (a half-written file is never
 * seen: it is written beside it and renamed). A file that
 * cannot be understood is set aside, not deleted.
 */
export function fileStore(
  file: string
): LeaderboardStore {

  return {

    load() {

      if (!fs.existsSync(file)) {
        return [];
      }

      try {

        const parsed = JSON.parse(
          fs.readFileSync(file, "utf8")
        );

        return Array.isArray(parsed?.entries)
          ? parsed.entries
          : [];

      } catch {

        const aside = `${file}.corrupt-${Date.now()}`;

        try {
          fs.renameSync(file, aside);
        } catch {
          // leave it be
        }

        log("Leaderboard file was unreadable, set aside as", aside);

        return [];
      }
    },

    save(entries) {

      fs.mkdirSync(
        path.dirname(file),
        { recursive: true }
      );

      const temporary = `${file}.${process.pid}.tmp`;

      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, entries })
      );

      fs.renameSync(temporary, file);
    }
  };
}

// ------------------------------------------
// THE ONE IN USE
// ------------------------------------------

let current = new Leaderboard();

export function getLeaderboard(): Leaderboard {
  return current;
}

export function setLeaderboard(
  leaderboard: Leaderboard
) {
  current = leaderboard;
}
