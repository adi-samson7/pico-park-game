# shared

These files are **copies** of server files:

- `physics.ts` is `server/src/physics.ts`, the game's physics rules. The client
  runs the same code on the local player to predict movement (see
  `../net/prediction.ts`).
- `profile.ts` is `server/src/profile.ts`: how names are cleaned and which
  colours exist, so the client says what the server will say.

Do not edit the copies: change the server's file and run `npm run sync:physics`
from the repository root. A test (`server/test/physics-sync.test.ts`) and CI
fail when a copy differs.

It is a copy rather than an import from `../../../server` so the client builds
by itself, wherever it is deployed.
