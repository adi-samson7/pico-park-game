import { log } from "./log.js";

const roomRegistry =
  new Map<string, string>();

// ==========================================
// REGISTER ROOM
// ==========================================

export function registerRoom(
  roomCode: string,
  roomId: string
) {

  const code =
    roomCode
      .trim()
      .toUpperCase();

  roomRegistry.set(
    code,
    roomId
  );

  log(
    `[Registry] Registered ${code} -> ${roomId}`
  );
}

// ==========================================
// FIND ROOM
// ==========================================

export function findRoom(
  roomCode: string
): string | undefined {

  const code =
    roomCode
      .trim()
      .toUpperCase();

  const roomId =
    roomRegistry.get(
      code
    );

  log(
    `[Registry] Lookup ${code} -> ${roomId ?? "NOT FOUND"}`
  );

  return roomId;
}

// ==========================================
// CODE EXISTS (silent, for uniqueness checks)
// ==========================================

export function roomCodeExists(
  roomCode: string
): boolean {

  return roomRegistry.has(
    roomCode
      .trim()
      .toUpperCase()
  );
}

// ==========================================
// REMOVE ROOM
// ==========================================

export function removeRoom(
  roomCode: string
) {

  const code =
    roomCode
      .trim()
      .toUpperCase();

  roomRegistry.delete(
    code
  );

  log(
    `[Registry] Removed ${code}`
  );
}
// ==========================================
// COUNT
// ==========================================

export function roomCount(): number {

  return roomRegistry.size;
}
