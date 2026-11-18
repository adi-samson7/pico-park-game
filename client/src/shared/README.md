# shared

`physics.ts` is a **copy** of `server/src/physics.ts`, the game's physics rules.

The client runs the same code on the local player to predict movement (see
`../net/prediction.ts`). Do not edit this copy: change `server/src/physics.ts`
and run `npm run sync:physics` from the repository root. A test
(`server/test/physics-sync.test.ts`) and CI fail when the two differ.

It is a copy rather than an import from `../../../server` so the client builds
by itself, wherever it is deployed.
