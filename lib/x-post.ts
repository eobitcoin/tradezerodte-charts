/**
 * X (Twitter) posting client — used by the BotWick tweets cron to publish
 * the day's best setups to @TheBotWick.
 *
 * Auth is OAuth 1.0a USER CONTEXT (the only auth that can post as the
 * account): consumer key/secret + access token/secret, all four from env.
 * The app's Bearer Token is app-only auth and cannot post — don't use it.
 *
 * NOTE: the Access Token/Secret must be generated AFTER the app's permission
 * is set to "Read and write" — tokens minted under Read Only silently keep
 * Read Only and every post 403s.
 */

import { TwitterApi } from "twitter-api-v2";

export function hasXCredentials(): boolean {
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_SECRET,
  );
}

function client(): TwitterApi {
  if (!hasXCredentials()) {
    throw new Error(
      "X credentials missing: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET",
    );
  }
  return new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
  });
}

/** Post a single tweet; returns the tweet id. Throws on API errors
 *  (403 usually means the access token was minted with Read Only perms). */
export async function postTweet(text: string): Promise<string> {
  const res = await client().v2.tweet(text);
  return res.data.id;
}
