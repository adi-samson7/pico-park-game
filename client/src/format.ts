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

/**
 * Shortens a list of names to fit a column:
 * "Ada, Sam", "Ada, Sam +2".
 */
export function formatNames(
  names: readonly string[],
  maxChars = 22
): string {

  let text = "";

  for (let i = 0; i < names.length; i++) {

    const next =
      i === 0
        ? names[i]
        : `${text}, ${names[i]}`;

    const remaining = names.length - i - 1;

    const suffix =
      remaining > 0
        ? ` +${remaining}`
        : "";

    if (
      next.length + suffix.length >
        maxChars &&
      i > 0
    ) {

      return `${text} +${names.length - i}`;
    }

    text = next;
  }

  return text.length > maxChars
    ? `${text.slice(0, maxChars - 1)}…`
    : text;
}

/** "1st", "2nd", "3rd", "4th"... "11th", "22nd". */
export function ordinal(
  n: number
): string {

  const hundreds = n % 100;

  if (hundreds >= 11 && hundreds <= 13) {
    return `${n}th`;
  }

  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
