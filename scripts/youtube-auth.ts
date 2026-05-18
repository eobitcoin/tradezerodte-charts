/**
 * One-time YouTube OAuth dance — obtain a refresh token.
 *
 * Usage:
 *   1. Create OAuth 2.0 Client ID in Google Cloud Console (type: "Desktop app").
 *      Download the client_id and client_secret.
 *   2. Set env vars locally and run:
 *        YT_CLIENT_ID=...apps.googleusercontent.com \
 *        YT_CLIENT_SECRET=GOCSPX-... \
 *        npx tsx scripts/youtube-auth.ts
 *   3. The script spins up a tiny HTTP server on http://localhost:53682,
 *      opens your browser to the Google consent screen, and captures the
 *      callback. The refresh token is printed to stdout.
 *   4. Copy the refresh_token into Railway env as YT_REFRESH_TOKEN.
 *
 * The redirect URI must be registered on the OAuth client. For a Desktop app
 * type, Google accepts arbitrary http://localhost:* URIs without explicit
 * registration. If you used "Web application" instead, you must add
 * `http://localhost:53682/oauth/callback` to "Authorized redirect URIs".
 */

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { buildAuthUrl, exchangeCodeForTokens } from "../lib/youtube";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.error(
        `Could not auto-open browser. Open this URL manually:\n${url}\n`,
      );
    }
  });
}

async function main() {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET env vars first.");
    process.exit(1);
  }

  const authUrl = buildAuthUrl(clientId, clientSecret, REDIRECT_URI);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404).end();
        return;
      }
      const c = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(`<h1>Auth error</h1><p>${err}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${err}`));
        return;
      }
      if (!c) {
        res.writeHead(400).end("missing code");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<h1>Done!</h1><p>You can close this tab. Check the terminal for your refresh token.</p>`,
      );
      server.close();
      resolve(c);
    });
    server.listen(PORT, () => {
      console.log(`Listening on ${REDIRECT_URI}`);
      console.log(`Opening browser to:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
    server.on("error", reject);
  });

  const tokens = await exchangeCodeForTokens(clientId, clientSecret, REDIRECT_URI, code);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. This usually means the Google account already granted consent. " +
        "Revoke the app at https://myaccount.google.com/permissions and re-run.",
    );
    process.exit(1);
  }
  console.log("\n=== SAVE THIS TO RAILWAY AS YT_REFRESH_TOKEN ===");
  console.log(tokens.refresh_token);
  console.log("================================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
