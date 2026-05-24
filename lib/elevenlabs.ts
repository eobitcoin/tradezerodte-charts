/**
 * ElevenLabs TTS client.
 *
 * Used by the briefing pipeline to convert a 35-50 word voiceover script
 * into an MP3, which is then handed to Higgsfield's `seedance_2_0` model
 * as the `audio` reference for the lip-synced talking-head video.
 *
 * Auth: ELEVENLABS_API_KEY env var. The voice ID is per-briefing (default
 * is the brand voice configured on env BRIEFING_VOICE_ID).
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 * Returns: audio/mpeg binary.
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

export interface VoiceoverResult {
  buffer: Buffer;
  mimeType: string;
  voiceId: string;
  modelId: string;
  charCount: number;
}

export interface VoiceoverOptions {
  voiceId: string;
  /** Default `eleven_multilingual_v2` — handles English with subtle Nordic
   *  accents better than the monolingual model and supports voice cloning. */
  modelId?: string;
  /** Voice style/stability tuning. ElevenLabs defaults are usually fine; we
   *  expose them in case the brand voice needs adjustment without code change. */
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export async function generateVoiceover(
  script: string,
  opts: VoiceoverOptions,
): Promise<VoiceoverResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  if (!script.trim()) throw new Error("script is empty");
  if (!opts.voiceId) throw new Error("voiceId is required");

  const modelId = opts.modelId ?? "eleven_multilingual_v2";
  const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}`;
  const body = {
    text: script,
    model_id: modelId,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
      style: opts.style ?? 0.0,
      use_speaker_boost: opts.useSpeakerBoost ?? true,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed: ${res.status} ${res.statusText} ${text.slice(0, 240)}`,
    );
  }

  const arrayBuf = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    mimeType: res.headers.get("content-type") ?? "audio/mpeg",
    voiceId: opts.voiceId,
    modelId,
    charCount: script.length,
  };
}

/** Build the bucket key for a daily briefing's voiceover MP3. */
export function buildBriefingAudioKey(tradingDay: string): string {
  return `briefings/${tradingDay}/voiceover.mp3`;
}

/** Build the bucket key for a weekly earnings brief's voiceover MP3.
 *  Keyed on `weekAnchor` (the Sunday-of-the-week date the brief publishes). */
export function buildWeeklyEarningsAudioKey(weekAnchor: string): string {
  return `weekly-earnings-briefings/${weekAnchor}/voiceover.mp3`;
}
