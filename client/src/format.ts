// ==========================================
// FORMATTING (times for screens)
// ==========================================

/**
 * A time for a screen: "8.4 s" under a minute,
 * "1:02.3" from a minute on, "12:05.0" for the
 * very patient.
 */
export function formatTime(
  ms: number
): string {

  if (
    typeof ms !== "number" ||
    !Number.isFinite(ms) ||
    ms < 0
  ) {
    return "--";
  }

  // tenths of a second, rounded
  const tenths = Math.round(ms / 100);

  const seconds = tenths / 10;

  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(seconds / 60);

  const rest = seconds - minutes * 60;

  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
