// ==========================================
// SESSION (resume after a page reload)
// ==========================================
//
// The connection library keeps a player in
// their room across a dropped connection on its
// own. A page reload is different: the page
// forgets everything, including which room the
// player was in.
//
// So the "reconnection token" the server hands
// out is remembered in sessionStorage (it
// belongs to this browser tab and disappears
// when the tab is closed) and used on the next
// start to walk straight back in.
//
// Storage is injected so this can be tested.

const KEY = "pico.session";

// A token older than the server's reconnection
// window is useless; do not even try.
export const MAX_SESSION_AGE_MS =
  10 * 60 * 1000;

export interface KeyValueStorage {

  getItem(key: string): string | null;

  setItem(key: string, value: string): void;

  removeItem(key: string): void;
}

export interface SavedSession {

  // `roomId:token`, as the client library
  // reports it.
  token: string;

  // For display: the shareable room code.
  roomCode: string;

  savedAt: number;
}

export function saveSession(
  storage: KeyValueStorage | null,
  session: {
    token: string;
    roomCode?: string;
  },
  now = Date.now()
) {

  if (!storage || !session.token) {
    return;
  }

  try {

    const value: SavedSession = {
      token: session.token,
      roomCode: session.roomCode ?? "",
      savedAt: now
    };

    storage.setItem(
      KEY,
      JSON.stringify(value)
    );

  } catch {
    // Private mode / quota: resuming simply
    // is not available.
  }
}

export function loadSession(
  storage: KeyValueStorage | null,
  now = Date.now()
): SavedSession | null {

  if (!storage) {
    return null;
  }

  try {

    const raw = storage.getItem(KEY);

    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw);

    if (
      !value ||
      typeof value.token !== "string" ||
      !value.token.includes(":") ||
      typeof value.savedAt !== "number"
    ) {

      storage.removeItem(KEY);

      return null;
    }

    if (now - value.savedAt > MAX_SESSION_AGE_MS) {

      storage.removeItem(KEY);

      return null;
    }

    return {
      token: value.token,
      roomCode:
        typeof value.roomCode === "string"
          ? value.roomCode
          : "",
      savedAt: value.savedAt
    };

  } catch {

    try {
      storage.removeItem(KEY);
    } catch {
      // ignore
    }

    return null;
  }
}

export function clearSession(
  storage: KeyValueStorage | null
) {

  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** sessionStorage, or null when the browser
 *  does not allow it. */
export function browserStorage():
  KeyValueStorage | null {

  try {

    return window.sessionStorage;

  } catch {

    return null;
  }
}

// The browser tab's own session: what the
// scenes call.

export const tabSession = {

  remember(
    token: string,
    roomCode?: string
  ) {

    saveSession(
      browserStorage(),
      { token, roomCode }
    );
  },

  load(): SavedSession | null {

    return loadSession(
      browserStorage()
    );
  },

  forget() {

    clearSession(
      browserStorage()
    );
  }
};
