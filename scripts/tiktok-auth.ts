/**
 * One-time TikTok OAuth dance — obtain a refresh token.
 *
 * Usage:
 *   1. Register a TikTok app at https://developers.tiktok.com/.
 *      - Add Login Kit + Content Posting API (Upload to Inbox mode)
 *      - Redirect URI: http://localhost:53683/oauth/callback
 *      - Scopes: user.info.basic, video.upload
 *      - Add your TikTok handle as a Target User (sandbox mode)
 *
 *   2. Set env vars locally and run:
 *        TT_CLIENT_KEY="sb..." \
 *        TT_CLIENT_SECRET="..." \
 *        npx tsx scripts/tiktok-auth.ts
 *
 *   3. Browser opens to TikTok's consent screen. Sign in with the Target User
 *      account, grant the requested scopes, and you'll be redirected back.
 *
 *   4. Refresh token is printed to stdout. Copy it into Railway as
 *      TT_REFRESH_TOKEN.
 *
 * Common gotchas:
 *   - TikTok requires the redirect URI to match EXACTLY what was registered.
 *     If you registered with a trailing slash or different port, this script
 *     will fail.
 *   - Sandbox apps must include the signing-in user in the Target Users list,
 *     otherwise TikTok shows "this user has not been authorized."
 */

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, exchangeCodeForTokens } from "../lib/tiktok";

const PORT = 53683;
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
  const clientKey = process.env.TT_CLIENT_KEY;
  const clientSecret = process.env.TT_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    console.error("Set TT_CLIENT_KEY and TT_CLIENT_SECRET env vars first.");
    process.exit(1);
  }

  // CSRF guard — TikTok echoes this back; we verify it matches.
  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(clientKey, REDIRECT_URI, state);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404).end();
        return;
      }
      const c = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      const errDesc = url.searchParams.get("error_description");
      if (err) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(`<h1>Auth error</h1><p>${err}: ${errDesc ?? ""}</p>`);
        server.close();
        reject(new Error(`TikTok OAuth error: ${err}${errDesc ? ` — ${errDesc}` : ""}`));
        return;
      }
      if (!c) {
        res.writeHead(400).end("missing code");
        return;
      }
      if (returnedState !== state) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(`<h1>State mismatch</h1><p>CSRF check failed.</p>`);
        server.close();
        reject(new Error("OAuth state mismatch — possible CSRF, aborting"));
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

  const tokens = await exchangeCodeForTokens(clientKey, clientSecret, code, REDIRECT_URI);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. The connected TikTok account may have already granted consent — " +
        "revoke at https://www.tiktok.com/setting/account-permissions (or in-app: Settings → Privacy → " +
        "Personalization & Data → Third-party apps) and re-run.",
    );
    process.exit(1);
  }
  console.log("\n=== SAVE THIS TO RAILWAY AS TT_REFRESH_TOKEN ===");
  console.log(tokens.refresh_token);
  console.log("================================================");
  if (tokens.open_id) {
    console.log(`\nopen_id: ${tokens.open_id} (the TikTok account this token is bound to)`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
