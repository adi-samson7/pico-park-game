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

  console.log(
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

  console.log(
    `[Registry] Lookup ${code} -> ${roomId ?? "NOT FOUND"}`
  );

  return roomId;
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

  console.log(
    `[Registry] Removed ${code}`
  );
}