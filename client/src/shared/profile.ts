// ==========================================
// PLAYER PROFILE: NAMES AND COLOURS
// ==========================================
//
// Pure rules, shared by the server (which has the
// last word) and the client (which uses them to
// give feedback while typing). The client keeps a
// checked-in copy: client/src/shared/profile.ts,
// see scripts/sync-physics.mjs.
//
// Names come from strangers and end up on other
// people's screens, so they are cleaned strictly:
// letters, digits and a few punctuation marks only,
// one line, short.

export const NAME_MAX = 12;

// What players may pick from. Nobody else in the
// room may have the same colour. The first four
// are the original player colours.
export const PALETTE = [
  0xff4444, // red
  0x4488ff, // blue
  0x44cc66, // green
  0xffcc33, // yellow
  0xff8844, // orange
  0xaa66ff, // purple
  0xff66bb, // pink
  0x44ddee  // cyan
] as const;

export function isPaletteColor(
  value: unknown
): value is number {

  return (
    typeof value === "number" &&
    (PALETTE as readonly number[]).includes(
      value
    )
  );
}

// Letters, combining marks (the vowel signs of
// many scripts are marks), digits, space and
// _ . ' ! -  Everything else (emoji, control
// characters, zero-width tricks, angle brackets,
// quotes...) is removed.
const DISALLOWED =
  /[^\p{L}\p{M}\p{N} _.'!-]/gu;

/**
 * A safe display name, or "" if nothing usable
 * is left.
 */
export function sanitizeName(
  raw: unknown
): string {

  if (typeof raw !== "string") {
    return "";
  }

  return raw
    // look at the characters players see
    .normalize("NFKC")
    // one line, single spaces (before anything
    // is deleted, so a line break between two
    // words stays a space)
    .replace(/\s+/g, " ")
    .replace(DISALLOWED, "")
    // a mark needs a letter to sit on...
    .replace(/(^|[^\p{L}\p{N}\p{M}])\p{M}+/gu, "$1")
    // ...and a pile of them is "zalgo" text:
    // two per letter is plenty for real scripts
    .replace(/(\p{M}{2})\p{M}+/gu, "$1")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

export function defaultName(
  playerIndex: number
): string {

  return `Player ${playerIndex + 1}`;
}

/**
 * `name`, or `name 2`, `name 3`... if someone in
 * the room already has it (ignoring case). The
 * result still fits NAME_MAX.
 */
export function uniqueName(
  name: string,
  taken: readonly string[]
): string {

  const used =
    new Set(
      taken.map(
        other =>
          other.toLowerCase()
      )
    );

  if (!used.has(name.toLowerCase())) {
    return name;
  }

  for (let n = 2; n < 100; n++) {

    const suffix = ` ${n}`;

    const candidate =
      name
        .slice(
          0,
          NAME_MAX - suffix.length
        )
        .trimEnd() + suffix;

    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return name;
}

/**
 * The colour a player gets: the one they asked for
 * if it is in the palette and free, otherwise the
 * first free one, starting from their seat's own
 * colour so the default look stays the same.
 */
export function pickColor(
  requested: unknown,
  taken: readonly number[],
  preferredIndex = 0
): number {

  if (
    isPaletteColor(requested) &&
    !taken.includes(requested)
  ) {
    return requested;
  }

  for (let i = 0; i < PALETTE.length; i++) {

    const candidate =
      PALETTE[
        (preferredIndex + i) %
          PALETTE.length
      ];

    if (!taken.includes(candidate)) {
      return candidate;
    }
  }

  // More players than colours: cannot happen
  // (rooms hold four), but never crash.
  return PALETTE[
    preferredIndex % PALETTE.length
  ];
}
