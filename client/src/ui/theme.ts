// ==========================================
// LOOK OF THE MENU AND LOBBY
// ==========================================
//
// Dark navy panels, blue for "do this", a pixel font
// for the title and a monospace for everything else.
// The fonts are bundled with the game (see main.ts),
// nothing is fetched from the internet.

export const FONT_BODY =
  '"JetBrains Mono", "Courier New", monospace';

export const FONT_TITLE =
  '"Press Start 2P", "Courier New", monospace';

export const COLOR = {

  // backdrop
  bgTop: 0x070914,
  bgBottom: 0x141730,
  floor: 0x10122a,
  floorEdge: 0x1d2040,

  // panels
  panel: 0x131627,
  panelDeep: 0x0c0e1c,
  panelRaised: 0x1b1f36,
  stroke: 0x363b5a,
  strokeSoft: 0x252944,

  // accents
  blue: 0x2f6bff,
  blueDark: 0x1f4fcc,
  blueLight: 0x6a95ff,

  green: 0x3ddc6a,
  amber: 0xffcc55,
  red: 0xff6b6b,

  // text, as CSS strings
  textBright: "#ffffff",
  text: "#e4e7ff",
  textSoft: "#b9bedf",
  textDim: "#7e84a8",
  textFaint: "#565b80",
  green_: "#6dff9a",
  amber_: "#ffd36b",
  red_: "#ff7b7b",
  blue_: "#8fb0ff"
} as const;

export const hex = (
  color: number
): string =>
  "#" +
  color
    .toString(16)
    .padStart(6, "0");
