// Runs before every client build (npm "prebuild").
//
// On Vercel the client is a static site: the game server is somewhere else, and
// the client only finds it through VITE_SERVER_URL, which is baked in at build
// time. Forgetting it would not fail anything visibly: the game would try to
// talk to the Vercel site itself and every "Create room" would say "not found".
// So on Vercel the build refuses to continue without a usable address.
//
//   - it must be set
//   - it must be https://  (the page is https; browsers block a plain ws://
//     connection from it)
//
// Everywhere else (local builds, Docker, where the server serves the client
// itself) VITE_SERVER_URL is optional and this check says nothing.

const onVercel = Boolean(process.env.VERCEL);

const url = (process.env.VITE_SERVER_URL ?? "").trim();

function fail(message) {

  console.error("");
  console.error("  VITE_SERVER_URL problem: " + message);
  console.error("");
  console.error("  Set it in Vercel: Project -> Settings -> Environment Variables,");
  console.error("  to the address of the game server, for example:");
  console.error("    VITE_SERVER_URL=https://pico-coop.onrender.com");
  console.error("  then redeploy (it is read at build time).");
  console.error("");

  process.exit(1);
}

if (onVercel) {

  if (!url) {
    fail("it is not set, so the game would look for its server on the Vercel site itself.");
  }

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    fail(`"${url}" is not a valid address.`);
  }

  if (parsed.protocol !== "https:") {
    fail(`"${url}" is not https://. A page served over https cannot open an insecure connection.`);
  }

  if (/vercel\.app$/i.test(parsed.hostname)) {
    console.warn(
      `  Warning: ${parsed.hostname} looks like a Vercel site. Vercel cannot run the game server (no WebSockets).`
    );
  }

  console.log(`Game server: ${parsed.origin}`);

} else if (url) {

  console.log(`Game server (VITE_SERVER_URL): ${url}`);
}
