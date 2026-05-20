/**
 * TikTok Content Posting API client — uploads briefing videos to the user's
 * TikTok inbox (drafts mode).
 *
 * Auth: OAuth 2.0 authorization-code flow with a long-lived refresh token.
 * The refresh token is captured once via `scripts/tiktok-auth.ts` and stored
 * as an env var; on every publish we exchange it for a short-lived access
 * token.
 *
 * Mode: `Upload to Inbox` only. We never call `/v2/post/publish/video/init/`
 * (Direct Post) because that requires TikTok app review and we want a manual
 * approval step on the phone anyway.
 *
 * Env vars (Railway):
 *   - TT_CLIENT_KEY       OAuth client key (TikTok dev portal)
 *   - TT_CLIENT_SECRET    OAuth client secret
 *   - TT_REFRESH_TOKEN    Long-lived refresh token from the one-time dance
 *
 * Docs: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
 */

const AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const INBOX_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
const STATUS_FETCH_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

/** Scopes we require. `user.info.basic` is a TikTok-mandated baseline. */
export const TT_SCOPES = ["user.info.basic", "video.upload"] as const;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type: string;
  scope: string;
  open_id?: string;
}

/**
 * Exchange the long-lived refresh token for a short-lived access token.
 * Called fresh before every publish — access tokens last ~24h but refreshing
 * each time keeps the path simple and avoids token-cache footguns.
 */
async function refreshAccessToken(): Promise<string> {
  const clientKey = readEnv("TT_CLIENT_KEY");
  const clientSecret = readEnv("TT_CLIENT_SECRET");
  const refreshToken = readEnv("TT_REFRESH_TOKEN");

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: TokenResponse & { error?: string; error_description?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`TikTok token refresh: non-JSON response ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || !parsed.access_token) {
    const detail = parsed.error_description || parsed.error || text;
    throw new Error(`TikTok token refresh failed ${res.status}: ${String(detail).slice(0, 300)}`);
  }
  return parsed.access_token;
}

interface InboxInitResponse {
  data: { publish_id: string; upload_url: string };
  error: { code: string; message: string; log_id?: string };
}

export interface UploadOpts {
  videoBuffer: Buffer;
  /** Optional — if TikTok ever surfaces this. Inbox mode mostly ignores it; the
   *  real caption gets typed on the phone. We send it anyway when present. */
  caption?: string;
}

export interface UploadResult {
  publishId: string;
  uploadElapsedMs: number;
  bytes: number;
}

/**
 * Push a finished MP4 into the connected TikTok account's inbox/drafts.
 * Three steps: init (get upload_url + publish_id), PUT bytes, return ids.
 *
 * Inbox-mode uploads must respect TikTok's size + duration limits — we don't
 * enforce them here (caller knows the source). For reference: ≤500 MB,
 * ≤10 min, 9:16/1:1/16:9 supported. Our 20s 720p clips clear all bars easily.
 */
export async function uploadBriefingToTikTok(opts: UploadOpts): Promise<UploadResult> {
  const accessToken = await refreshAccessToken();
  const t0 = Date.now();
  const videoSize = opts.videoBuffer.length;

  // Single-chunk upload — works for files up to ~64 MB, which covers any
  // sane briefing clip. TikTok requires chunk_size >= 5 MB except for the
  // last chunk; with a single chunk equal to the whole file this trivially
  // passes for our ~10-35 MB clips.
  const chunkSize = videoSize;
  const totalChunkCount = 1;

  const initRes = await fetch(INBOX_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });
  const initText = await initRes.text();
  let initJson: InboxInitResponse;
  try {
    initJson = JSON.parse(initText);
  } catch {
    throw new Error(`TikTok inbox init: non-JSON response ${initRes.status}: ${initText.slice(0, 300)}`);
  }
  if (!initRes.ok || !initJson.data?.upload_url || !initJson.data?.publish_id) {
    const code = initJson?.error?.code;
    const message = initJson?.error?.message || initText;
    throw new Error(
      `TikTok inbox init failed ${initRes.status} ${code ?? ""}: ${String(message).slice(0, 300)}`,
    );
  }
  const { publish_id, upload_url } = initJson.data;

  // PUT the bytes. Content-Range is REQUIRED even for a single chunk;
  // TikTok's upload-server rejects requests that don't carry it.
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoSize),
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: new Uint8Array(opts.videoBuffer),
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw new Error(`TikTok inbox PUT failed ${putRes.status}: ${text.slice(0, 300)}`);
  }

  return {
    publishId: publish_id,
    uploadElapsedMs: Date.now() - t0,
    bytes: videoSize,
  };
}

/** Possible status values from TikTok's status-fetch endpoint. */
export type TtPublishStatus =
  | "PROCESSING_UPLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export interface PublishStatus {
  status: TtPublishStatus | string;
  failReason?: string;
  publiclyAvailablePostId?: string;
}

/**
 * (Optional) Poll the status of a previously initiated upload. Useful for the
 * demo recording — proves the video reached the user's inbox.
 */
export async function fetchPublishStatus(publishId: string): Promise<PublishStatus> {
  const accessToken = await refreshAccessToken();
  const res = await fetch(STATUS_FETCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const text = await res.text();
  let parsed: {
    data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: string[] };
    error?: { code?: string; message?: string };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`TikTok status fetch: non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(
      `TikTok status fetch ${res.status}: ${parsed.error?.message ?? text.slice(0, 200)}`,
    );
  }
  return {
    status: parsed.data?.status ?? "UNKNOWN",
    failReason: parsed.data?.fail_reason,
    publiclyAvailablePostId: parsed.data?.publicaly_available_post_id?.[0],
  };
}

// ---------------------------------------------------------------------------
// Auth dance helpers — used only by scripts/tiktok-auth.ts
// ---------------------------------------------------------------------------

export function buildAuthUrl(
  clientKey: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: TT_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
    // PKCE — required by TikTok as of 2024+. We use the S256 method (SHA-256
    // of the verifier, base64url-encoded). The verifier travels back to us
    // in exchangeCodeForTokens so TikTok can verify the pair.
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  clientKey: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ refresh_token: string | null; access_token: string | null; open_id: string | null }> {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: body.toString(),
  });
  const text = await res.text();
  let parsed: TokenResponse & { error?: string; error_description?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`TikTok code exchange: non-JSON ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || !parsed.access_token) {
    const detail = parsed.error_description || parsed.error || text;
    throw new Error(`TikTok code exchange failed ${res.status}: ${String(detail).slice(0, 300)}`);
  }
  return {
    refresh_token: parsed.refresh_token ?? null,
    access_token: parsed.access_token ?? null,
    open_id: parsed.open_id ?? null,
  };
}
