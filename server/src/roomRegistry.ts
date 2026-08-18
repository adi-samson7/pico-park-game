const roomRegistry =
  new Map<string, string>();

// ==========================================
// REGISTER
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
    `Registered room ${code} -> ${roomId}`
  );
}

// ==========================================
// FIND
// ==========================================

export function findRoom(
  roomCode: string
): string | undefined {

  return roomRegistry.get(
    roomCode
      .trim()
      .toUpperCase()
  );
}

// ==========================================
// REMOVE
// ==========================================

export function removeRoom(
  roomCode: string
) {
  const code =
    roomCode
      .trim()
      .toUpperCase();

  roomRegistry.delete(code);

  console.log(
    `Removed room ${code}`
  );
}