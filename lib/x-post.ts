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

function xError(err: unknown): Error {
  const e = err as {
    code?: number;
    data?: { detail?: string; title?: string; reason?: string; errors?: Array<{ message?: string }> };
  };
  const detail =
    e?.data?.detail || e?.data?.title || e?.data?.reason || e?.data?.errors?.[0]?.message || "";
  return new Error(
    `X API ${e?.code ?? "?"}${detail ? `: ${detail}` : `: ${err instanceof Error ? err.message : String(err)}`}`,
  );
}

/** True when the failure is about post LENGTH (no Premium on the account /
 *  >280 chars) — the signal to fall back from a long post to a thread. */
export function isLengthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("too long") || msg.includes("character") || msg.includes("length");
}

/** Post a single tweet; returns the tweet id. Throws on API errors
 *  (403 usually means the access token was minted with Read Only perms).
 *  Surfaces X's error detail — the bare status code is undiagnosable. */
export async function postTweet(text: string): Promise<string> {
  try {
    const res = await client().v2.tweet(text);
    return res.data.id;
  } catch (err) {
    throw xError(err);
  }
}

/** Post a reply in a thread; returns the reply's tweet id. */
export async function postReply(text: string, inReplyToTweetId: string): Promise<string> {
  try {
    const res = await client().v2.reply(text, inReplyToTweetId);
    return res.data.id;
  } catch (err) {
    throw xError(err);
  }
}
