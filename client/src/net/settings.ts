// ==========================================
// NETCODE SETTINGS
// ==========================================
//
// Defaults are what players get. The URL
// switches exist for testing and comparing:
//
//   ?predict=0   draw the local player from the
//                server only (no prediction)
//   ?interp=0    draw other players at their
//                latest position (easing only)
//   ?interp=200  draw them 200 ms in the past
//   ?retries=3   give up on a lost connection
//                after 3 attempts (default 10)

function readNumber(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {

  if (raw === null || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(max, value)
  );
}

export function readNetSettings(
  search: string
) {

  const params =
    new URLSearchParams(search);

  return {

    // Run the local player's physics on the
    // client and reconcile with the server.
    predict:
      params.get("predict") !== "0",

    // How far in the past other players are
    // drawn (ms). Covers network jitter; kept
    // small because what you see of other players
    // should stay close to where the server (and
    // your own prediction) has them, e.g. when
    // landing on someone's head.
    interpolationMs:
      readNumber(
        params.get("interp"),
        50,
        0,
        500
      ),

    // How many times to try to get back into
    // the room after the connection dropped.
    reconnectAttempts:
      Math.round(
        readNumber(
          params.get("retries"),
          10,
          1,
          30
        )
      )
  };
}

export const NET_SETTINGS =
  readNetSettings(
    typeof window !== "undefined"
      ? window.location.search
      : ""
  );
