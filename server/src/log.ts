// ==========================================
// LOGGING
// ==========================================
//
// LOG_LEVEL=silent turns the game server's
// info logging off (used by the tests). Read
// on every call so it can be changed at
// runtime.

export function log(
  ...args: unknown[]
) {

  if (
    process.env.LOG_LEVEL ===
    "silent"
  ) {
    return;
  }

  console.log(
    ...args
  );
}
