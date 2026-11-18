// ==========================================
// SERVER ADDRESS
// ==========================================
//
// One server address serves everything:
// the WebSocket game connection and the
// HTTP room-code lookup.
//
//   - VITE_SERVER_URL (build-time env)
//     overrides everything, e.g.
//     VITE_SERVER_URL=https://game.example.com
//
//   - `npm run dev` (Vite dev server): the
//     game server on localhost:2567.
//
//   - production build: the same origin the
//     page was loaded from (the server also
//     serves the client), over wss:// when
//     the page is https://.

const explicit =
  (
    import.meta.env.VITE_SERVER_URL as
      string | undefined
  )?.trim();

const base =
  explicit
    ? explicit
    : import.meta.env.DEV
      ? "http://localhost:2567"
      : window.location.origin;

export const SERVER_HTTP_URL =
  base.replace(
    /\/+$/,
    ""
  );

export const SERVER_WS_URL =
  SERVER_HTTP_URL.replace(
    /^http/,
    "ws"
  );
