/**
 * YouTube Data API v3 client — uploads briefing videos to the brand channel.
 *
 * Auth: OAuth 2.0 refresh-token flow. Service accounts cannot upload to a
 * personal/brand YouTube channel (only to YouTube Content Manager, which is
 * enterprise-only), so we hold a long-lived refresh token issued by a
 * one-time interactive OAuth dance (see `scripts/youtube-auth.ts`).
 *
 * Env vars (Railway):
 *   - YT_CLIENT_ID          OAuth 2.0 client ID
 *   - YT_CLIENT_SECRET      OAuth 2.0 client secret
 *   - YT_REFRESH_TOKEN      Refresh token from the one-time auth dance
 *
 * Quota: `videos.insert` costs ~1600 units. Default daily quota is 10,000.
 * One briefing/day = comfortably under the cap.
 */

import { Readable } from "node:stream";
import { google, type youtube_v3 } from "googleapis";

/**
 * Disclosure footer appended to every briefing description.
 *
 * Two regulatory items live here:
 *
 *   1. AI-generated content notice. YouTube's "altered or synthetic
 *      content" policy (June 2024+) requires creators to disclose when
 *      realistic-looking AI is used for the host/presenter. We also
 *      set `status.containsSyntheticMedia=true` on the upload itself
 *      (that's the canonical signal); the text here just makes the
 *      disclosure visible to viewers.
 *
 *   2. Music attribution. The BGM is original composition generated
 *      via Suno (Pro license, full commercial use). Stating this in
 *      the description pre-empts erroneous Content ID claims and
 *      establishes the audit trail if a dispute ever needs filing.
 *
 * Edit here to update both daily + weekly + future briefings at once.
 */
export const BRIEFING_DISCLOSURE_FOOTER = `

—

This video features an AI-generated presenter created with Hedra; the voice is AI-generated via ElevenLabs. Original soundtrack composed using Suno AI (Pro license — commercial use). Market commentary and analysis is human-curated.

Not investment advice. Trading options involves substantial risk of loss; trade only with capital you can afford to lose.`;

interface UploadOpts {
  /** Video bytes (MP4). Streamed to YouTube; do not load enormous files into memory if you can avoid it. */
  videoBuffer: Buffer;
  title: string;
  description: string;
  /** Comma-friendly tag list. */
  tags?: string[];
  /** YouTube category — 26 = Howto & Style, 25 = News & Politics, 22 = People & Blogs. */
  categoryId?: string;
  /** Privacy: "public", "unlisted", or "private". Defaults to "public". */
  privacyStatus?: "public" | "unlisted" | "private";
  /** True → publishes as a Short (vertical aspect, ≤60s). YouTube auto-detects from aspect ratio + duration, but we tag #Shorts in the description as belt-and-suspenders. */
  isShort?: boolean;
}

export interface UploadResult {
  /** YouTube video ID — visible at https://www.youtube.com/watch?v=<id> */
  videoId: string;
  /** Final privacy status YouTube assigned. */
  privacyStatus: string;
  /** Public watch URL. */
  watchUrl: string;
  /** ms spent inside videos.insert. */
  elapsedMs: number;
}

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

/**
 * Build an authenticated OAuth2 client. Throws if env vars are missing.
 * The token-refresh dance is handled inside googleapis on each call.
 */
export function getYouTubeOAuthClient() {
  const client = new google.auth.OAuth2({
    clientId: readEnv("YT_CLIENT_ID"),
    clientSecret: readEnv("YT_CLIENT_SECRET"),
    // Redirect URI is only used during the one-time auth dance, not here.
  });
  client.setCredentials({ refresh_token: readEnv("YT_REFRESH_TOKEN") });
  return client;
}

/**
 * Upload a briefing MP4 to YouTube. Returns the new video ID. Idempotency is
 * the caller's responsibility — calling this twice creates two YouTube videos.
 *
 * The video is uploaded via googleapis' built-in resumable upload (the SDK
 * picks chunked when the body is a stream > a few MB). We wrap the Buffer
 * in a Readable so progress can be observed and so we don't materialize a
 * second copy of the bytes.
 */
export async function uploadBriefingToYouTube(opts: UploadOpts): Promise<UploadResult> {
  const auth = getYouTubeOAuthClient();
  const yt = google.youtube({ version: "v3", auth });

  const t0 = Date.now();
  const body = Readable.from(opts.videoBuffer);

  // Description = caller's text + standard disclosure footer (AI +
  // music license). Shorts also get the #Shorts hash so YouTube routes
  // the video into the Shorts shelf.
  const baseDescription = opts.description + BRIEFING_DISCLOSURE_FOOTER;
  const description = opts.isShort
    ? `${baseDescription}\n\n#Shorts`
    : baseDescription;

  const requestBody: youtube_v3.Schema$Video = {
    snippet: {
      title: opts.title,
      description,
      tags: opts.tags ?? ["0DTE", "options", "day trading", "stock market"],
      categoryId: opts.categoryId ?? "25", // News & Politics — fits market commentary
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: {
      privacyStatus: opts.privacyStatus ?? "public",
      selfDeclaredMadeForKids: false,
      embeddable: true,
      // YouTube's required AI-disclosure flag. We use a synthetic
      // talking-head (Hedra) and a synthetic voice (ElevenLabs), so
      // this is always true for briefings. Setting it from the API
      // is the canonical signal — viewers see a "Altered or synthetic
      // content" label on the watch page, and the channel stays in
      // compliance with the June 2024 YouTube AI-content policy.
      containsSyntheticMedia: true,
    },
  };

  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    notifySubscribers: true,
    requestBody,
    media: {
      mimeType: "video/mp4",
      body,
    },
  });

  const data = res.data;
  if (!data.id) {
    throw new Error(
      `YouTube videos.insert returned no id: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  return {
    videoId: data.id,
    privacyStatus: data.status?.privacyStatus ?? "unknown",
    watchUrl: `https://www.youtube.com/watch?v=${data.id}`,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Generate the OAuth consent URL for the one-time auth dance. Used by the
 * `scripts/youtube-auth.ts` CLI.
 */
export function buildAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
  const client = new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  return client.generateAuthUrl({
    access_type: "offline",     // get a refresh token, not just an access token
    prompt: "consent",          // force consent every time so refresh_token is always returned
    scope: ["https://www.googleapis.com/auth/youtube.upload"],
  });
}

/**
 * Exchange an OAuth code (received via the redirect after consent) for tokens.
 * The `refresh_token` field of the result is what gets stored as YT_REFRESH_TOKEN.
 */
export async function exchangeCodeForTokens(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ refresh_token: string | null; access_token: string | null }> {
  const client = new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
  const { tokens } = await client.getToken(code);
  return {
    refresh_token: tokens.refresh_token ?? null,
    access_token: tokens.access_token ?? null,
  };
}
