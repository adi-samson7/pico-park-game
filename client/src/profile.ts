// ==========================================
// THE PLAYER'S PROFILE (remembered name + colour)
// ==========================================
//
// What the player chose is kept in localStorage so the
// next visit starts with the same name and colour. It
// is sent when joining a room; the server has the last
// word (it may add a number to a name that is taken, or
// give another colour if yours is).
//
// Storage is passed in so this can be tested.

import {
  isPaletteColor,
  sanitizeName
} from "./shared/profile.ts";

import type { KeyValueStorage } from "./net/session.ts";

export interface Profile {

  // "" = no choice: the server names the player
  // "Player N".
  name: string;

  // null = no choice: the server gives the colour of
  // the player's seat.
  color: number | null;
}

const KEY = "pico.profile";

export function emptyProfile(): Profile {

  return {
    name: "",
    color: null
  };
}

export function loadProfile(
  storage: KeyValueStorage | null =
    localStorageOrNull()
): Profile {

  if (!storage) {
    return emptyProfile();
  }

  try {

    const raw = storage.getItem(KEY);

    if (!raw) {
      return emptyProfile();
    }

    const value = JSON.parse(raw);

    return {

      name:
        sanitizeName(value?.name),

      color:
        isPaletteColor(value?.color)
          ? value.color
          : null
    };

  } catch {

    return emptyProfile();
  }
}

export function saveProfile(
  profile: Profile,
  storage: KeyValueStorage | null =
    localStorageOrNull()
) {

  if (!storage) {
    return;
  }

  try {

    storage.setItem(
      KEY,
      JSON.stringify({
        name: sanitizeName(profile.name),
        color:
          isPaletteColor(profile.color)
            ? profile.color
            : null
      })
    );

  } catch {
    // Private mode / quota: it is simply not remembered.
  }
}

/** What to send to the server when joining. Only what
 *  was actually chosen. */
export function joinOptions(
  profile: Profile
): { name?: string; color?: number } {

  const options: { name?: string; color?: number } = {};

  const name = sanitizeName(profile.name);

  if (name) {
    options.name = name;
  }

  if (isPaletteColor(profile.color)) {
    options.color = profile.color;
  }

  return options;
}

function localStorageOrNull():
  KeyValueStorage | null {

  try {

    return window.localStorage;

  } catch {

    return null;
  }
}
