/**
 * Hedra API client — talking-head video generation from image + audio.
 *
 * Hedra is the lip-sync specialist. We give it our Higgsfield Soul still
 * and our ElevenLabs MP3; it returns a lip-synced MP4 where the presenter's
 * mouth and head movements match our voiceover. Native ElevenLabs partnership
 * means voice quality is preserved (unlike Higgsfield's video models which
 * route audio to SFX and re-synthesize dialogue).
 *
 * API base: `https://api.hedra.com/web-app/public`
 * Auth: `X-API-Key` header (env `HEDRA_API_KEY`).
 *
 * Flow:
 *   1. POST /assets { name, type: "image" } → { id }
 *   2. POST /assets/{id}/upload (multipart file=) — upload image bytes
 *   3. POST /assets { name, type: "audio" } → { id }
 *   4. POST /assets/{id}/upload (multipart file=) — upload audio bytes
 *   5. POST /generations { type: "video", ai_model_id, start_keyframe_id,
 *        audio_id, generated_video_inputs: { text_prompt, aspect_ratio,
 *        resolution, duration_ms } } → { id }
 *   6. GET /generations/{id}/status → { status, progress, asset_id }
 *      Poll until status = "complete" (or "completed").
 *   7. GET /assets/{asset_id} → { url } — final MP4 URL.
 */

const HEDRA_BASE =
  process.env.HEDRA_API_BASE || "https://api.hedra.com/web-app/public";

/** Hedra Avatar model — talking-head with lip-sync. */
const AVATAR_MODEL_ID = "26f0fc66-152b-40ab-abed-76c43df99bc8";

function apiKey(): string {
  const k = process.env.HEDRA_API_KEY;
  if (!k) throw new Error("HEDRA_API_KEY not configured");
  return k;
}

async function jsonOrThrow(res: Response, label: string): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Hedra ${label} ${res.status} ${res.statusText}: ${text.slice(0, 400)}`,
    );
  }
  return res.json();
}

async function createAsset(name: string, type: "image" | "audio"): Promise<string> {
  const res = await fetch(`${HEDRA_BASE}/assets`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, type }),
  });
  const data = (await jsonOrThrow(res, `createAsset(${type})`)) as { id?: string };
  if (!data.id) throw new Error(`Hedra createAsset(${type}) returned no id`);
  return data.id;
}

async function uploadAssetBytes(
  assetId: string,
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
  form.append("file", blob, filename);
  const res = await fetch(`${HEDRA_BASE}/assets/${assetId}/upload`, {
    method: "POST",
    headers: { "X-API-Key": apiKey() },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Hedra uploadAssetBytes(${assetId}) ${res.status}: ${text.slice(0, 400)}`,
    );
  }
}

interface CreateGenerationOpts {
  imageAssetId: string;
  audioAssetId: string;
  textPrompt: string;
  aspectRatio: string;
  resolution: string;
  durationMs: number;
}

async function createGeneration(opts: CreateGenerationOpts): Promise<string> {
  const res = await fetch(`${HEDRA_BASE}/generations`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "video",
      ai_model_id: AVATAR_MODEL_ID,
      start_keyframe_id: opts.imageAssetId,
      audio_id: opts.audioAssetId,
      generated_video_inputs: {
        text_prompt: opts.textPrompt,
        aspect_ratio: opts.aspectRatio,
        resolution: opts.resolution,
        duration_ms: opts.durationMs,
      },
    }),
  });
  const data = (await jsonOrThrow(res, "createGeneration")) as { id?: string };
  if (!data.id) throw new Error("Hedra createGeneration returned no id");
  return data.id;
}

interface GenerationStatus {
  status: string;
  progress?: number;
  eta_sec?: number;
  asset_id?: string;
  url?: string;
  error?: string;
  error_message?: string;
}

async function getGenerationStatus(generationId: string): Promise<GenerationStatus> {
  const res = await fetch(`${HEDRA_BASE}/generations/${generationId}/status`, {
    headers: { "X-API-Key": apiKey() },
  });
  return (await jsonOrThrow(res, "getGenerationStatus")) as GenerationStatus;
}

async function getAssetUrl(assetId: string): Promise<string> {
  const res = await fetch(`${HEDRA_BASE}/assets/${assetId}`, {
    headers: { "X-API-Key": apiKey() },
  });
  const data = (await jsonOrThrow(res, "getAssetUrl")) as { url?: string };
  if (!data.url) throw new Error(`Hedra getAssetUrl(${assetId}) returned no url`);
  return data.url;
}

export interface TalkingHeadOpts {
  imageBytes: Buffer;
  imageContentType: string;
  audioBytes: Buffer;
  audioContentType: string;
  /** Short scene/mood description for the model. Optional but improves output. */
  textPrompt?: string;
  /** Default "9:16" — vertical for YouTube Shorts. */
  aspectRatio?: string;
  /** Default "720p". */
  resolution?: string;
  /** Default 20000 (20 sec). Briefing scripts at 30-40 words run ~12-16s at
   *  conversational pace; 20s leaves headroom for the "As always... Trade the
   *  Edge... Respect the Risk." tagline beats. */
  durationMs?: number;
  /** Poll cadence in ms — default 5000. */
  pollIntervalMs?: number;
  /** Hard ceiling on polling — default 5 min. */
  maxPollMs?: number;
}

export interface TalkingHeadResult {
  generationId: string;
  assetId: string;
  videoUrl: string;
  elapsedMs: number;
  pollCount: number;
}

const TERMINAL_OK = new Set(["complete", "completed", "success", "succeeded"]);
const TERMINAL_FAIL = new Set(["failed", "error", "errored", "cancelled", "canceled"]);

// ---------------------------------------------------------------------------
// Async API — split submit and poll so a long-running Hedra generation
// doesn't blow the 60s MCP transport timeout. Routine calls submit, persists
// the generation_id, then polls via separate calls.
// ---------------------------------------------------------------------------

export interface SubmitOpts {
  imageBytes: Buffer;
  imageContentType: string;
  audioBytes: Buffer;
  audioContentType: string;
  textPrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  durationMs?: number;
}

export interface SubmitResult {
  generationId: string;
  imageAssetId: string;
  audioAssetId: string;
  elapsedMs: number;
}

export async function submitHedraGeneration(opts: SubmitOpts): Promise<SubmitResult> {
  const t0 = Date.now();

  // Parallelize the two asset creation + upload pairs to halve wait time.
  const [imageAssetId, audioAssetId] = await Promise.all([
    (async () => {
      const id = await createAsset("portrait.png", "image");
      await uploadAssetBytes(id, "portrait.png", opts.imageBytes, opts.imageContentType);
      return id;
    })(),
    (async () => {
      const id = await createAsset("voiceover.mp3", "audio");
      await uploadAssetBytes(id, "voiceover.mp3", opts.audioBytes, opts.audioContentType);
      return id;
    })(),
  ]);

  const generationId = await createGeneration({
    imageAssetId,
    audioAssetId,
    textPrompt:
      opts.textPrompt ??
      "A female presenter delivering a confident, calm, conversational morning briefing to camera.",
    aspectRatio: opts.aspectRatio ?? "9:16",
    resolution: opts.resolution ?? "720p",
    durationMs: opts.durationMs ?? 20000,
  });

  return {
    generationId,
    imageAssetId,
    audioAssetId,
    elapsedMs: Date.now() - t0,
  };
}

export interface HedraStatusResult {
  /** Normalized: "in_progress" | "complete" | "failed". */
  status: "in_progress" | "complete" | "failed";
  /** Raw status string from Hedra, for diagnostics. */
  rawStatus: string;
  progress?: number;
  etaSec?: number;
  assetId?: string;
  /** Final video URL when status=complete. */
  videoUrl?: string;
  errorMessage?: string;
}

export async function checkHedraStatus(generationId: string): Promise<HedraStatusResult> {
  const s = await getGenerationStatus(generationId);
  const raw = (s.status || "").toLowerCase();
  if (TERMINAL_OK.has(raw)) {
    if (!s.asset_id) {
      return {
        status: "failed",
        rawStatus: raw,
        errorMessage: "completed but no asset_id returned",
      };
    }
    const videoUrl = s.url ?? (await getAssetUrl(s.asset_id));
    return {
      status: "complete",
      rawStatus: raw,
      progress: s.progress,
      etaSec: s.eta_sec,
      assetId: s.asset_id,
      videoUrl,
    };
  }
  if (TERMINAL_FAIL.has(raw)) {
    return {
      status: "failed",
      rawStatus: raw,
      progress: s.progress,
      errorMessage: s.error_message || s.error || JSON.stringify(s),
    };
  }
  return {
    status: "in_progress",
    rawStatus: raw,
    progress: s.progress,
    etaSec: s.eta_sec,
  };
}

// ---------------------------------------------------------------------------
// Legacy synchronous API. Kept for callers that don't care about MCP timeouts
// (e.g. a CLI tool). Don't call this from MCP handlers.
// ---------------------------------------------------------------------------

export async function generateTalkingHead(opts: TalkingHeadOpts): Promise<TalkingHeadResult> {
  const t0 = Date.now();

  // 1-2. Image asset
  const imageAssetId = await createAsset("portrait.png", "image");
  await uploadAssetBytes(
    imageAssetId,
    "portrait.png",
    opts.imageBytes,
    opts.imageContentType,
  );

  // 3-4. Audio asset
  const audioAssetId = await createAsset("voiceover.mp3", "audio");
  await uploadAssetBytes(
    audioAssetId,
    "voiceover.mp3",
    opts.audioBytes,
    opts.audioContentType,
  );

  // 5. Generation
  const generationId = await createGeneration({
    imageAssetId,
    audioAssetId,
    textPrompt:
      opts.textPrompt ??
      "A female presenter delivering a confident, calm, conversational morning briefing to camera.",
    aspectRatio: opts.aspectRatio ?? "9:16",
    resolution: opts.resolution ?? "720p",
    durationMs: opts.durationMs ?? 20000,
  });

  // 6. Poll
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const maxPollMs = opts.maxPollMs ?? 5 * 60 * 1000;
  const pollStart = Date.now();
  let pollCount = 0;
  let status: GenerationStatus;
  for (;;) {
    if (Date.now() - pollStart > maxPollMs) {
      throw new Error(
        `Hedra generation ${generationId} timed out after ${maxPollMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    pollCount++;
    status = await getGenerationStatus(generationId);
    const s = (status.status || "").toLowerCase();
    if (TERMINAL_OK.has(s)) break;
    if (TERMINAL_FAIL.has(s)) {
      const msg = status.error_message || status.error || JSON.stringify(status);
      throw new Error(`Hedra generation ${generationId} failed: ${msg}`);
    }
  }

  if (!status.asset_id) {
    throw new Error(
      `Hedra generation ${generationId} completed but no asset_id returned`,
    );
  }

  // 7. Asset URL
  const videoUrl = status.url ?? (await getAssetUrl(status.asset_id));

  return {
    generationId,
    assetId: status.asset_id,
    videoUrl,
    elapsedMs: Date.now() - t0,
    pollCount,
  };
}
