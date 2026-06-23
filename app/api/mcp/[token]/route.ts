/**
 * MCP server endpoint for claude.ai custom connectors.
 *
 * Implements the MCP Streamable HTTP transport (single POST endpoint accepting
 * JSON-RPC 2.0 requests). Exposes two tools that the user's claude.ai routines
 * can call to publish their research output to the website:
 *
 *   - publish_dte_research(title, body_md, trading_day?)
 *   - publish_insider_scan(title, body_md, buys[], scan_day?)
 *
 * Auth: a long random token in the URL path (`MCP_TOKEN` env var). claude.ai
 * connectors that don't use OAuth send the URL as-is, so a path token is the
 * simplest way to keep the endpoint private without OAuth setup.
 *
 * The tools internally call our existing /api/posts and /api/insider/posts
 * endpoints using INGEST_API_KEY, so the bearer never leaves the server.
 */

import { NextResponse } from "next/server";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  posts,
  insiderPosts,
  maxPainPosts,
  researchPosts,
  researchUploadChunks,
  cryptoPosts,
  cryptoWeeklyResearchPosts,
  economicEvents,
  institutionalPosts,
  institutionalFunds,
  earningsPosts,
  sectorRotationPosts,
  type Trade as TradeRow,
  type InsiderBuy,
  type MaxPainTicker,
  type MaxPainAlert,
  type ResearchImage,
  type CryptoTrade,
  type InstitutionalStock,
  type EarningsStock,
  type SectorRotationSector,
} from "@/lib/db/schema";
import { fetch13FHoldings } from "@/lib/edgar";
import { nyTradingDay } from "@/lib/trading-day";
import { parseTradesFromMarkdown, inferTitle } from "@/lib/parse-routine";
import { renderMarkdown } from "@/lib/markdown";
import { sendDteResearchEmail } from "@/lib/email";
import { buildTradesTableHtml } from "@/lib/email-render";
import { sortTradesByGrade } from "@/lib/grade";
import { buildResearchImageKey, putObject, publicUrlFor } from "@/lib/s3";
import * as Tradier from "@/lib/tradier";
import { computeTickerStats } from "@/lib/options-math";
import {
  GROUP_LABELS as MAX_PAIN_GROUP_LABELS,
  PIN_TICKERS,
  RETAIL_TICKERS,
} from "@/lib/max-pain";
import {
  CRYPTO_TICKERS,
  fetchCryptoQuotes,
  fetchCryptoKlines,
  fetchFromOkx,
  type CryptoInterval,
  type CryptoTicker,
} from "@/lib/crypto";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";

const TOOLS = [
  {
    name: "publish_dte_research",
    description:
      "Publish (or append to) the daily 0DTE Options Analysis report. Because the full report is large (~30KB), call this tool MULTIPLE TIMES with `append=true` for chunks 2+ — emitting the whole report in one tool call exceeds the model's stream-idle window. Send chunk 1 with `append=false` (creates the post for today), then chunks 2-5 with `append=true` (each call concatenates body_md and re-parses trades from the cumulative body).",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Report title, e.g. '0DTE Options Analysis — April 29, 2026'. Required only on the first chunk.",
        },
        body_md: {
          type: "string",
          description:
            "A chunk of markdown to write. On the first chunk (append=false), include the H1 + Section 1. On chunks 2-5 (append=true), include sections 2 (split across 3 calls), 3-7. Each ticker subsection MUST start with '### TICKER — Company Name' (em-dash or '---'). Each Trade Plan table MUST include a 'Trade Grade' row formatted exactly like '**A-** — short reason'. Grades must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F. For avoid tickers, end the section with '**Trade Grade: F — AVOID. <reason>**'.",
        },
        append: {
          type: "boolean",
          description:
            "false (or omitted) = create/replace the post for trading_day with this body. true = append body_md to the existing post and re-parse trades from the combined body.",
        },
        trading_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        send_email: {
          type: "boolean",
          description:
            "Optional. When true, after this call the bot inbox (DTE_RESEARCH_EMAIL_TO env) also receives an HTML copy of the post (full body + trade summary table). Set true ONLY on the FINAL publish_dte_research call of the run so the email contains the complete post, not a partial first chunk. Defaults to false on every chunk.",
        },
        scan_kind: {
          type: "string",
          enum: ["premarket", "market_open", "analysis", "settlement"],
          description:
            "Which scan this report belongs to. 'premarket' (default) is the 8:30 ET routine, 'market_open' is the 9:45 ET re-grading after the opening drive, 'analysis' is the 10:00+ comparative narrative, 'settlement' is the post-close (~4:15 ET) routine that stamps end-of-day outcomes (target hit / stopped / no fill) onto each trade. The site shows them on separate tabs of the same trading day. Chunked publish (append=true) must use the SAME scan_kind across chunks. Defaults to 'premarket' when omitted (backwards-compatible with the existing premarket routine).",
        },
        sentiment: {
          type: "string",
          enum: ["bullish", "bearish", "neutral"],
          description:
            "Optional overall market sentiment for the post. Surfaces as a chip in the UI. Most useful on settlement and analysis posts.",
        },
        bias: {
          type: "string",
          description:
            "Optional short tag describing the day's character, e.g. 'trend-day', 'chop', 'vol-crush', 'gap-and-go'. Free-form, max ~60 chars.",
        },
        trades: {
          type: "array",
          description:
            "Optional pre-structured trade objects. REQUIRED for the settlement routine — settlement trades carry outcome/pnl_pct/actual_entry/actual_exit/result_notes/status fields that the markdown-table parser can't extract. When provided, these objects are stored directly on the post and the markdown parser is bypassed. The premarket/market_open/analysis routines should NOT pass this — they continue to emit a markdown trade table that the parser reads. When `append=true`, trades passed here are ignored (the merged body is re-parsed).",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              grade: { type: "string" },
              rank: { type: "number" },
              direction: {
                type: "string",
                enum: ["call", "put", "long", "short", "avoid"],
              },
              strike: { type: ["number", "string"] },
              expiry: { type: "string", description: "YYYY-MM-DD" },
              entry_zone: { type: "string" },
              entry_trigger: { type: "string" },
              target1: { type: ["number", "string"] },
              target2: { type: ["number", "string"] },
              stop: { type: ["number", "string"] },
              time_stop: { type: "string" },
              rationale: { type: "string" },
              status: {
                type: "string",
                enum: ["confirmed", "revised", "killed", "added"],
              },
              revision_summary: { type: "string" },
              kill_reason: { type: "string" },
              outcome: {
                type: "string",
                enum: [
                  "target1_hit",
                  "target2_hit",
                  "stopped",
                  "no_fill",
                  "time_stopped",
                  "manual_exit",
                ],
              },
              actual_entry: { type: ["number", "string"] },
              actual_exit: { type: ["number", "string"] },
              pnl_pct: { type: "number" },
              result_notes: { type: "string" },
            },
            required: ["ticker", "grade"],
          },
        },
      },
      required: ["body_md"],
    },
  },
  {
    name: "fetch_dte_post",
    description:
      "Fetch an already-published 0DTE research post for comparison or context. Returns the full post (title, body_md, trades, sentiment, bias, run_at) or null when no post exists for the given (day, scan_kind). Use this from the analysis routine to pull the premarket + market_open scans before writing the comparative narrative; use it from the settlement routine to pull the merged trade plan before computing outcomes.",
    inputSchema: {
      type: "object",
      properties: {
        scan_kind: {
          type: "string",
          enum: ["premarket", "market_open", "analysis", "settlement"],
          description: "Which lane to fetch. Required.",
        },
        trading_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
      required: ["scan_kind"],
    },
  },
  {
    name: "compute_settlement",
    description:
      "Run the deterministic post-close settlement engine for a trading day. Reads the merged trade plan (premarket + market_open + analysis), then walks Tradier 5-minute intraday option premium bars for each call/put trade and produces a per-trade verdict: filled?, target hit?, stopped?, no-fill?, time-stopped? with actual entry/exit prices and P&L%. Use this from the 4:15 PM ET settlement routine — anchor your narrative commentary on the engine's verdict and write 1-2 sentences of result_notes per trade, then publish via publish_dte_research with scan_kind='settlement'. The verdict is authoritative for the structured fields (outcome, pnl_pct, actual_entry, actual_exit); the LLM's commentary lives in result_notes.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York. The day to compute settlement for.",
        },
      },
    },
  },
  {
    name: "publish_briefing_script",
    description:
      "Save the 15-second voiceover script for the daily YouTube briefing video. Phase 1 of the briefing pipeline — Phase 2 (video gen) and Phase 3 (YouTube upload) will read this row downstream. UPSERTs on trading_day; safe to re-run. Script must be 30-45 words (≈15 seconds at conversational pace), first-person presenter voice ('today I like TSLA puts…'). The setting_prompt is a one-line scene/wardrobe/mood description for Higgsfield.\n\n**ALWAYS pass `tickers`** — the exact symbols you name in the script, in spoken order. The /morning-brief page renders these as the right-side calls panel so it matches the video. If you skip this, the page falls back to GUESSING from the premarket scan's top-3 ranking, which often won't match the names you actually chose to discuss (the script themes its picks). Use symbols even when the script says company names (Qualcomm→QCOM, Intel→INTC, Micron→MU).",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        script: {
          type: "string",
          description:
            "Voiceover text. 30-45 words. First-person presenter voice. One-line market context + 3 ticker calls (ticker, direction, headline thesis) + sign-off. No emojis or stage directions — just what she'll say.",
        },
        tickers: {
          type: "array",
          items: { type: "string" },
          description:
            "Uppercased ticker symbols named in the script, in spoken order (e.g. ['QCOM','INTC','MU']). Server uppercases + dedupes; rejects entries that aren't 1-6 letters/digits. Typically the 3 calls the script discusses.",
        },
        setting_prompt: {
          type: "string",
          description:
            "One-line scene/wardrobe/mood description for the Higgsfield video (e.g. 'morning light, cafe counter, espresso in hand, white blouse, warm casual tone'). Keep it concrete; the video model uses this verbatim. Vary it day-to-day so the channel feels fresh.",
        },
      },
      required: ["script", "setting_prompt", "tickers"],
    },
  },
  {
    name: "pick_daily_briefing_setting_prompt",
    description:
      "Pick a setting_prompt for today's daily briefing from a locked 10-prompt rotation. Returns the prompt VERBATIM — the script-writer routine should pass it straight to publish_briefing_script without modifying. Eliminates free-form composition drift (root cause of past double-cup scenes + lack of beverage variety). Deterministic per trading_day: index = (day-of-year) % 10. Pass `index` (0-9) to force a specific one for re-renders. See examples/daily-briefing-setting-prompts.md for the full rotation + design notes.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today in America/New_York. Drives the day-of-year-based rotation index.",
        },
        index: {
          type: "integer",
          minimum: 0,
          maximum: 9,
          description: "Optional 0-9. Forces a specific prompt regardless of trading_day. Use for re-renders or A/B testing.",
        },
      },
    },
  },
  {
    name: "fetch_briefing",
    description:
      "Fetch the briefing row for a trading_day. Returns null when no briefing exists. Used by the video-gen pipeline (Phase 2) to read the script + setting_prompt; used by the admin review surface to inspect status and error_log.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
    },
  },
  {
    name: "generate_voiceover_for_briefing",
    description:
      "Generate the ElevenLabs voiceover MP3 for a briefing's script. Reads the existing `script` column from the briefings row, calls ElevenLabs TTS server-side (uses ELEVENLABS_API_KEY env var), uploads the MP3 to the Railway bucket, and returns a PUBLIC https URL that Higgsfield can fetch directly as the `audio` reference in generate_video. Idempotent: re-running overwrites the audio. Voice ID defaults to env BRIEFING_VOICE_ID (the brand voice); pass `voice_id` only to override for testing. Use this in the Phase 2 daily routine BEFORE calling Higgsfield generate_video.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        voice_id: {
          type: "string",
          description:
            "Optional ElevenLabs voice ID override. Defaults to env BRIEFING_VOICE_ID. Use to test alternate voices without changing the env var.",
        },
      },
    },
  },
  {
    name: "bridge_voiceover_to_higgsfield",
    description:
      "PUT the briefing's ElevenLabs MP3 (stored in our Railway bucket) to a Higgsfield presigned upload URL. Required because Higgsfield's `audio` role on generate_video accepts only `media_id` UUIDs (not https URLs like image roles do), and the routine sandbox can't bridge bytes between MCP services. Flow: routine calls Higgsfield `media_upload` to get a presigned URL + media_id, then calls THIS tool to have our server PUT the bytes, then calls Higgsfield `media_confirm`, then references the media_id in `generate_video` medias[audio]. No Higgsfield API key needed on our side — the presigned URL is the auth.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York. Identifies which briefing's audio to bridge.",
        },
        higgsfield_upload_url: {
          type: "string",
          description:
            "The presigned PUT URL returned by Higgsfield `media_upload`. Required.",
        },
        content_type: {
          type: "string",
          description:
            "Optional override for the Content-Type header on the PUT. Defaults to 'audio/mpeg' which matches what ElevenLabs returns and what `media_upload` was registered with.",
        },
      },
      required: ["higgsfield_upload_url"],
    },
  },
  {
    name: "submit_briefing_video_via_hedra",
    description:
      "STEP 1 of 2 — submit a Hedra Avatar generation job for the daily briefing. Server reads our ElevenLabs MP3 from the bucket, fetches the Soul still from the passed Higgsfield CDN URL, uploads both as Hedra assets, submits the generation, and persists `hedra_generation_id` to the briefing's meta. Returns IMMEDIATELY with the generation ID — does NOT wait for video to render. Designed to fit inside the 60s MCP transport timeout (only does upload + submit, ~10-20s). Use `poll_briefing_video_hedra` afterward to check status and retrieve the final MP4.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's NY date. Identifies the briefing.",
        },
        soul_image_url: {
          type: "string",
          description:
            "Public https URL to the Higgsfield Soul still. Required. Server fetches and uploads to Hedra.",
        },
        text_prompt: {
          type: "string",
          description:
            "Optional scene/mood description for Hedra's Avatar model. Default is a generic presenter prompt.",
        },
        duration_ms: {
          type: "number",
          description:
            "Optional. Default 20000 (20s). Briefing scripts at 30-40 words run ~12-16s spoken; 20s leaves headroom for the \"As always... Trade the Edge... Respect the Risk.\" tagline beats.",
        },
      },
      required: ["soul_image_url"],
    },
  },
  {
    name: "poll_briefing_video_hedra",
    description:
      "STEP 2 of 2 — poll the Hedra generation submitted by `submit_briefing_video_via_hedra`. Reads `hedra_generation_id` from the briefing row's meta, calls Hedra's status endpoint, returns `{status, progress}`. When status is `complete`, the server ALSO downloads the result MP4 and mirrors it to our Railway bucket at `briefings/{trading_day}/video.mp4`, updates the briefing row with the final URL, and returns `video_url`. Idempotent — repeated calls after completion just return the already-stored URL. Call this every 15-30 seconds in a loop until status=`complete` or `failed`.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's NY date. Identifies which briefing's Hedra job to poll.",
        },
        force_remirror: {
          type: "boolean",
          description:
            "Optional. When true, skips the mirrored-URL cache short-circuit and re-pulls the existing Hedra generation through the outro pipeline. Use after a server-side outro/mux bug to re-mirror without incurring new Hedra/ElevenLabs/Higgsfield credits.",
        },
      },
    },
  },
  {
    name: "mux_briefing_audio",
    description:
      "Replace the audio track of a Higgsfield-rendered video with the briefing's ElevenLabs MP3. Server downloads the Higgsfield MP4, reads our MP3 from the Railway bucket, runs ffmpeg to swap the audio (video stream copied, audio re-encoded as AAC), uploads the muxed MP4 back to the bucket, and returns a PUBLIC https URL for the result. Use this after Higgsfield's `generate_video` completes — Higgsfield's models replace our voice with their own in the output, so this step restores the ElevenLabs audio. Lip-sync mouth movements (generated by Higgsfield using our audio's timing) stay intact; only the audio track is swapped. Takes ~2-5 seconds for a 15s clip.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        higgsfield_video_url: {
          type: "string",
          description:
            "Public https URL to the Higgsfield-rendered MP4 (from `generate_video` + `job_display`). Required.",
        },
      },
      required: ["higgsfield_video_url"],
    },
  },
  {
    name: "attach_briefing_video",
    description:
      "Save the Higgsfield-generated video URL onto the briefing row, advancing status from `scripted` (or `generating`) to `pending_upload`. Call this after Higgsfield's `generate_video` job has completed and you have a downloadable video URL. UPSERTs on trading_day. The URL is stored verbatim in the `video_s3_key` column (we mirror to our own bucket later in Phase 3/5).",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        higgsfield_job_id: {
          type: "string",
          description:
            "The job_id returned by Higgsfield's generate_video tool. Stored for audit/debug.",
        },
        video_url: {
          type: "string",
          description:
            "Public https URL to the finished MP4 (Higgsfield CDN or our mirror). Required.",
        },
        thumbnail_url: {
          type: "string",
          description:
            "Optional public https URL to a thumbnail image. Used later for the embed surface.",
        },
      },
      required: ["video_url"],
    },
  },
  // -------- Weekly Earnings Brief (Sunday-morning ~45-50s parallel chain) --------
  {
    name: "publish_weekly_earnings_script",
    description:
      "Persist the script + setting prompt for the Sunday Weekly Earnings Brief. Mirrors `publish_briefing_script` but writes to the `weekly_earnings_briefings` table keyed on `week_anchor` (Sunday-of-the-week date). Word budget is 80-130 (hard bounds 60-180) — aimed at ~45s narration vs the daily ~15s. UPSERTs on week_anchor; safe to re-run.\n\n**ALWAYS pass `tickers`** — the public earnings-brief page and the admin card render those as chips next to the video. Use the actual ticker symbols even if the script uses company names (e.g. Marvell → MRVL, Salesforce → CRM). 3-8 symbols typical; cap 12. Order by narration order, not alphabetical.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description: "YYYY-MM-DD; the Sunday this brief publishes for. Defaults to today's NY date.",
        },
        script: {
          type: "string",
          description: "Voiceover text. 80-130 words. First-person Olivia voice. End with the signature tagline.",
        },
        setting_prompt: {
          type: "string",
          description: "One-line scene/wardrobe/mood description for Higgsfield Soul. Use one of the weekly rotation variants (rooftop / Manhattan / golden hour / casual-sexy editorial).",
        },
        tickers: {
          type: "array",
          items: { type: "string" },
          description:
            "Uppercased ticker symbols mentioned in the script, in narration order (e.g. ['MRVL','DELL','AVGO','CRM','LULU']). Server uppercases + dedupes; rejects anything that isn't 1-6 uppercase letters/digits. Pass [] only when the script genuinely covers no specific names (rare).",
        },
      },
      required: ["script", "setting_prompt", "tickers"],
    },
  },
  {
    name: "fetch_weekly_earnings_brief",
    description:
      "Read the Weekly Earnings Brief row for a given week_anchor. Returns { found, script, setting_prompt, status, video_s3_key, ... } or { found: false }.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today's NY date.",
        },
      },
    },
  },
  {
    name: "generate_voiceover_for_weekly_earnings_brief",
    description:
      "ElevenLabs TTS for a Weekly Earnings Brief. Reads the row's script, generates the MP3, uploads it to the weekly-earnings-briefings bucket prefix, and updates row status to 'generating'. Returns the public audio URL for handing to Hedra.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today's NY date.",
        },
        voice_id: {
          type: "string",
          description: "Optional ElevenLabs voice_id override. Defaults to BRIEFING_VOICE_ID env var.",
        },
      },
    },
  },
  {
    name: "submit_weekly_earnings_video_via_hedra",
    description:
      "STEP 1 of 2 for the weekly video — submit a Hedra Avatar generation. Reads our voiceover MP3 + the Soul still, kicks off the Hedra job, persists generation_id to the briefing row. Default duration 55000ms (55s) since weekly scripts run ~45s; the poll-handler outro pipeline trims at narration end before mirroring. Returns immediately with the generation ID (~10-20s).",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today's NY date.",
        },
        soul_image_url: {
          type: "string",
          description: "Public https URL to the Higgsfield Soul portrait (PNG). Required.",
        },
        text_prompt: {
          type: "string",
          description: "Short scene/mood description for Hedra. Optional but improves output.",
        },
        duration_ms: {
          type: "number",
          description: "Optional. Default 55000 (55s). Weekly scripts run ~45s; the outro pipeline trims at narration end so final landed length is `narration + 2.5s card`.",
        },
      },
      required: ["soul_image_url"],
    },
  },
  {
    name: "poll_weekly_earnings_video_hedra",
    description:
      "STEP 2 of 2 — poll Hedra for the weekly earnings video generation. When complete, downloads the MP4, runs the outro-card pipeline (trim at narration end + crossfade to OliviaTrades.com card), mirrors to our bucket, and updates the row to pending_upload with yt_status/tt_status set to pending_review. Idempotent — safe to call repeatedly; returns cached URL after the first mirror until a re-submit invalidates.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today's NY date.",
        },
        force_remirror: {
          type: "boolean",
          description:
            "Optional. When true, skips the cache short-circuit and re-pulls the existing Hedra generation through the outro pipeline — use to recover from a server-side outro/mux bug without re-billing generation credits.",
        },
      },
    },
  },
  {
    name: "publish_briefing_to_youtube",
    description:
      "Upload an approved briefing video to YouTube. Reads the briefing row for `trading_day`, validates that `yt_status='approved'`, downloads the mirrored MP4 from our Railway bucket, and uploads it via the YouTube Data API. On success: writes `youtube_video_id`, `yt_status='posted'`, `yt_posted_at=now()`. On failure: writes `yt_status='failed'` + `yt_error`. Idempotent guard: if `yt_status='posted'` already, returns the existing `youtube_video_id` without re-uploading. Requires env vars `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        privacy: {
          type: "string",
          enum: ["public", "unlisted", "private"],
          description:
            "Privacy status to publish with. Default 'public'. Use 'unlisted' or 'private' for testing.",
        },
        is_short: {
          type: "boolean",
          description:
            "True (default) to tag the video as a YouTube Short (#Shorts in description). The clip's 9:16 aspect ratio + ≤60s duration make this the right call for Olivia briefings.",
        },
      },
    },
  },
  {
    name: "publish_briefing_to_tiktok",
    description:
      "Push an approved briefing video into the connected TikTok account's inbox/drafts (Upload to Inbox mode — no auto-publish). Reads the briefing row for `trading_day`, validates `tt_status='approved'`, downloads the mirrored MP4 from our bucket, calls TikTok's `/v2/post/publish/inbox/video/init/` to get an upload URL, then PUTs the bytes. On success: writes `tt_publish_id`, `tt_status='posted'`, `tt_posted_at=now()`. The user opens the TikTok mobile app afterward and manually publishes from drafts. Idempotent on `tt_status='posted'`. Requires env vars `TT_CLIENT_KEY`, `TT_CLIENT_SECRET`, `TT_REFRESH_TOKEN`.",
    inputSchema: {
      type: "object",
      properties: {
        trading_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
    },
  },
  {
    name: "publish_weekly_to_youtube",
    description:
      "Sunday Weekly Earnings Brief version of `publish_briefing_to_youtube`. Reads the row in `weekly_earnings_briefings` keyed on `week_anchor` (Sunday-of-the-week date), validates `yt_status='approved'`, downloads the mirrored MP4 from the bucket, and uploads via the YouTube Data API. On success: writes `youtube_video_id`, `yt_status='posted'`, `yt_posted_at=now()`. Idempotent on `yt_status='posted'`. Same env-var requirements as the daily tool.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description:
            "Sunday-of-the-week date as YYYY-MM-DD. REQUIRED. Pass the same value used when the script was published.",
        },
        privacy: {
          type: "string",
          enum: ["public", "unlisted", "private"],
          description: "Privacy status. Default 'public'.",
        },
        is_short: {
          type: "boolean",
          description:
            "True (default) to tag as a YouTube Short. The clip's 9:16 aspect + ~55s duration make this the right call.",
        },
      },
      required: ["week_anchor"],
    },
  },
  {
    name: "publish_weekly_to_tiktok",
    description:
      "Sunday Weekly Earnings Brief version of `publish_briefing_to_tiktok`. Pushes the approved weekly MP4 into TikTok's inbox/drafts (no auto-publish). Reads the row in `weekly_earnings_briefings` keyed on `week_anchor`, validates `tt_status='approved'`, uploads, writes `tt_publish_id` + `tt_status='posted'`. The user finalizes on the TikTok mobile app.",
    inputSchema: {
      type: "object",
      properties: {
        week_anchor: {
          type: "string",
          description:
            "Sunday-of-the-week date as YYYY-MM-DD. REQUIRED.",
        },
      },
      required: ["week_anchor"],
    },
  },
  {
    name: "upload_research_image",
    description:
      "Upload a single chart/image (PNG/JPEG/WebP) for a research post to the website's bucket. Call this BEFORE publish_research, once per image (typically 'weekly' and 'daily' charts).\n\n**MODE A — `source_url` (RECOMMENDED for routines that can host the image elsewhere):** Pass a public HTTPS URL where the image is hosted (e.g. raw.githubusercontent.com, S3, Imgur). Server fetches the bytes and uploads to the bucket. Tiny tool call — just the URL string. No base64 emission needed; bypasses stream-idle issues entirely.\n\n**MODE B — `data_base64` (single-call):** Pass raw base64 of the image bytes (no `data:` prefix). Best when the image is < 30 KB raw (< ~40 KB base64). Larger payloads risk hitting the model's per-turn output cap.\n\n**MODE C — `data_base64` chunked:** Reserved for legacy use only; `source_url` is preferred for large images. Pass `upload_id`, `chunk_total`, `chunk_index` with each call. See full description in `chunk_total` field.\n\nExactly one of `source_url` or `data_base64` must be set.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Uppercase ticker, e.g. 'TSLA'." },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        slot: {
          type: "string",
          description:
            "Logical slot for this image — e.g. 'weekly', 'daily', 'intraday'. Page renders images in slot order (weekly first, then daily, then others).",
        },
        alt: { type: "string", description: "Alt-text caption shown below the image." },
        content_type: {
          type: "string",
          description: "MIME type, default 'image/png'. Supported: image/png, image/jpeg, image/webp, image/svg+xml.",
        },
        data_base64: {
          type: "string",
          description:
            "Raw image bytes as base64 (no `data:` URL prefix). Single-call: the full payload. Chunked: this chunk's slice of the base64 string. Mutually exclusive with `source_url`.",
        },
        source_url: {
          type: "string",
          description:
            "Public HTTPS URL to fetch the image from. Server downloads from this URL and uploads to the bucket. Useful when the routine cannot reliably emit base64 (large images, low output budget). Must be http:// or https:// and respond with an image content-type. Mutually exclusive with `data_base64`.",
        },
        upload_id: {
          type: "string",
          description:
            "REQUIRED for chunked uploads. Any unique stable string — same value for every chunk in this upload. Ignored when chunk_total is 1 or omitted.",
        },
        chunk_index: {
          type: "integer",
          description: "0-based index of this chunk. Default 0.",
        },
        chunk_total: {
          type: "integer",
          description:
            "Total number of chunks for this upload. Default 1 (single-call mode). Set to N (>1) to use chunked mode; the final chunk (chunk_index === N-1) finalizes and returns the bucket URL.",
        },
      },
      required: ["ticker", "slot"],
    },
  },
  {
    name: "publish_research",
    description:
      "Publish (or replace) one ticker's daily long-form research writeup. Upserts on (ticker, scan_day) — re-running for the same ticker on the same day overwrites. Call AFTER you've uploaded any chart images via upload_research_image; pass the returned `{slot, key, url, alt}` objects in the `images` array. The website renders body_md (sanitized markdown) above the images, with images displayed in slot order (weekly → daily → others) below the prose.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Uppercase ticker, e.g. 'TSLA'." },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        title: {
          type: "string",
          description:
            "Post title. Recommended format: '<TICKER> Research — <Month Day, Year>' (e.g. 'TSLA Research — May 1, 2026').",
        },
        headline: {
          type: "string",
          description:
            "One-line summary shown in the right-pane index (e.g. 'TSLA $381.63 — bullish above $393, bearish below $378'). Keep under 160 chars.",
        },
        body_md: {
          type: "string",
          description:
            "Full markdown analysis — narrative, key levels, structure, target projections. Do NOT include `![...](...)` image references; charts are rendered separately from the `images` array below the prose. Markdown is GFM + sanitized.",
        },
        images: {
          type: "array",
          description:
            "Charts to attach. Each entry should reference an upload_research_image result. The page renders these in slot order (weekly → daily → others) under the prose.",
          items: {
            type: "object",
            properties: {
              slot: { type: "string", description: "e.g. 'weekly', 'daily'." },
              key: { type: "string", description: "Bucket key returned by upload_research_image." },
              url: { type: "string", description: "URL returned by upload_research_image (e.g. /api/images/...)." },
              alt: { type: "string" },
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["slot", "key", "url"],
          },
        },
      },
      required: ["ticker", "title", "body_md"],
    },
  },
  {
    name: "publish_metals_research",
    description:
      "Publish (or replace) one metals ticker's weekly long-form research writeup. Same shape as `publish_research` but writes to the metals stream (`asset_class='metals'`) and surfaces at /research/metals/[scan_day]/[ticker]. **Allowed tickers (server-enforced):** GLD, SLV, GDX, GDXJ, CPER, PPLT, NEM, FCX, **XAUTUSDT** (Tether Gold). For XAUTUSDT pull bars via `fetch_crypto_bars` and quotes via `fetch_crypto_quote` (NOT the Tradier fetchers — XAUT/USDT is a crypto pair on OKX, not a US equity). For everything else use Tradier via `fetch_bars`. Pass charts via the `images` array after uploading them with upload_research_image.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description:
            "Uppercase ticker. Must be one of: GLD, SLV, GDX, GDXJ, CPER, PPLT, NEM, FCX.",
        },
        scan_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York. Sunday is the canonical metals publish day.",
        },
        title: {
          type: "string",
          description:
            "Post title. Recommended format: '<TICKER> Metals Research — <Month Day, Year>'.",
        },
        headline: {
          type: "string",
          description:
            "One-line summary shown in the right-pane index (e.g. 'GLD $241.50 — bullish above $245, bearish below $238'). Keep under 160 chars.",
        },
        body_md: {
          type: "string",
          description:
            "Full markdown analysis — narrative, key levels, structure, target projections. Same Wicked Stocks style. Do NOT include image references; charts render separately from the images array.",
        },
        images: {
          type: "array",
          description:
            "Charts to attach. Each entry should reference an upload_research_image result. Page renders in slot order (weekly → daily → others) under the prose.",
          items: {
            type: "object",
            properties: {
              slot: { type: "string", description: "e.g. 'weekly', 'daily'." },
              key: { type: "string", description: "Bucket key returned by upload_research_image." },
              url: { type: "string", description: "URL returned by upload_research_image." },
              alt: { type: "string" },
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["slot", "key", "url"],
          },
        },
      },
      required: ["ticker", "title", "body_md"],
    },
  },
  {
    name: "publish_quantum_research",
    description:
      "Publish (or replace) one quantum-computing ticker's weekly long-form research writeup with technical + fundamental + valuation analysis. Same shape as `publish_research` / `publish_metals_research` but writes to the quantum stream (`asset_class='quantum'`) and surfaces at /research/quantum/[scan_day]/[ticker]. **Allowed tickers (server-enforced):** IONQ, RGTI, QBTS, QUBT, INFQ, FORM. For technical/price data use Tradier via `fetch_quote` + `fetch_bars`. For fundamentals (revenue, gross margin, cash, runway, valuation) call `fetch_sec_fundamentals` — returns null for some tickers (notably INFQ post-SPAC) which is fine, just do technical-only and note the data gap. Same Key Level Map 3-column table format as the other research streams (validator enforces).",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description:
            "Uppercase ticker. Must be one of: IONQ, RGTI, QBTS, QUBT, INFQ, FORM.",
        },
        scan_day: {
          type: "string",
          description:
            "Optional YYYY-MM-DD; defaults to today's date in America/New_York. Sunday is the canonical quantum publish day.",
        },
        title: {
          type: "string",
          description:
            "Post title. Recommended format: '<TICKER> Quantum Research — <Month Day, Year>'.",
        },
        headline: {
          type: "string",
          description:
            "One-line summary shown in the right-pane index (e.g. 'IONQ $48.50 — bullish above $52, bearish below $42'). Keep under 160 chars.",
        },
        body_md: {
          type: "string",
          description:
            "Full markdown analysis including Technical section (Wicked Stocks style — charts/levels/wave structure), Fundamentals section (revenue TTM / YoY / margin / cash / runway from fetch_sec_fundamentals), Valuation (P/S, EV/S, peer compare), Catalyst calendar (next earnings + known announcements), and the canonical Key Level Map 3-column table.",
        },
        images: {
          type: "array",
          description:
            "Charts to attach. Each entry should reference an upload_research_image result. Page renders in slot order (weekly → daily → others) under the prose.",
          items: {
            type: "object",
            properties: {
              slot: { type: "string", description: "e.g. 'weekly', 'daily'." },
              key: { type: "string", description: "Bucket key returned by upload_research_image." },
              url: { type: "string", description: "URL returned by upload_research_image." },
              alt: { type: "string" },
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["slot", "key", "url"],
          },
        },
      },
      required: ["ticker", "title", "body_md"],
    },
  },
  {
    name: "fetch_sec_fundamentals",
    description:
      "Pull fundamentals for a US-listed equity straight from SEC EDGAR's XBRL companyfacts API. Returns trailing-12-month revenue + YoY growth, gross margin, operating income, cash + short-term investments, latest-quarter cash from operations, computed runway in quarters, shares outstanding, and the source filing reference. Free, no API key, no rate limits. Use this for the Fundamentals section of quantum research (and any other fundamental-aware analysis later). Returns null for tickers not in SEC EDGAR (e.g. foreign filers that submit 20-F instead of 10-Q).",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "Uppercase US-listed ticker (e.g. 'IONQ').",
        },
      },
      required: ["ticker"],
    },
  },
  {
    name: "scan_options_edge",
    description:
      "Run the Options Edge IV anomaly scanner across the ~67-name watchlist (SPY, QQQ, IWM + mega-caps + semis + high-IV retail + financials + healthcare + sector ETFs). Reads from the iv_snapshots table built by the daily backfill. For each ticker computes 1-year z-scores on four metrics — ATM IV rank, 25Δ skew, term structure slope (60d-30d), and IV/HV ratio. Returns the ranked anomalies (|z| ≥ 2.0 by default) plus compact per-ticker summaries (ticker, observations, anomalyCount — NOT full series data). Anomaly objects include suggested trade strategy and thesis. Use this in the weekly Options Edge research routine; pass rankedAnomalies verbatim to publish_options_edge_scan. Returns {scanDate, universeSize, rankedAnomalies, tickerSummary}.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "publish_options_edge_scan",
    description:
      "Persist a weekly Options Edge scan to the options_edge_scans table. UPSERTs on scan_day; safe to re-run. Pass the anomalies array from scan_options_edge plus a prose summary the routine wrote. Surfaces at /research/options-edge/[scan_day].",
    inputSchema: {
      type: "object",
      properties: {
        scan_day: {
          type: "string",
          description: "YYYY-MM-DD. Defaults to today's NY date.",
        },
        title: {
          type: "string",
          description:
            "Post title. Recommended: 'Options Edge — <Month Day, Year>'.",
        },
        summary: {
          type: "string",
          description:
            "Prose summary of the scan — markdown. The page renders this above the ranked anomaly cards. 2-4 paragraphs: regime context, headline picks, what's notable across the surface.",
        },
        anomalies: {
          type: "array",
          description:
            "Ranked anomaly objects from scan_options_edge — paste the rankedAnomalies array verbatim.",
          items: { type: "object" },
        },
        universe_size: {
          type: "integer",
          description: "Number of tickers scanned (the scanner returns this).",
        },
      },
      required: ["title", "summary", "anomalies"],
    },
  },
  {
    name: "publish_insider_scan",
    description:
      "Publish the daily SEC Form 4 Insider Buy Scan to the user's website. Call this exactly once at the end of the routine.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Scan title, e.g. 'SEC Form 4 Insider Scan — April 29, 2026'." },
        body_md: {
          type: "string",
          description:
            "Markdown summary of the scan: how many qualifying buys, total combined dollar value, headline filings, brief commentary on themes/sectors.",
        },
        buys: {
          type: "array",
          description:
            "Structured array of qualifying insider buys (≥ $250K, transaction type P, last 24h), sorted by total_value descending. Empty array if no qualifying filings.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              company: { type: "string" },
              executive: { type: "string" },
              title: { type: "string", description: "Insider's role: CEO, CFO, Director, 10% Owner, etc." },
              shares: { type: "integer" },
              total_value: { type: "integer", description: "USD value as a plain integer." },
              position_type: { type: "string", enum: ["new", "addition"] },
              filing_date: { type: "string", description: "YYYY-MM-DD" },
              filing_url: { type: "string" },
              notes: { type: "string" },
            },
            required: ["ticker", "company", "executive"],
          },
        },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
      required: ["title", "body_md", "buys"],
    },
  },
  {
    name: "fetch_quote",
    description:
      "Fetch a current Tradier quote for one or more tickers. Returns spot, bid/ask, prev close, change, change %, volume, day high/low, open. Use this for any stock/ETF/index price the routine needs (TSLA, NVDA, SPY, ^VIX, etc.) — much faster and more reliable than scraping Yahoo or Google.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Ticker symbols, e.g. ['TSLA','NVDA','SPY']. Max 50 per call.",
        },
      },
      required: ["tickers"],
    },
  },
  {
    name: "fetch_option_contract",
    description:
      "Fetch a single option contract's live quote with greeks. Returns bid/ask/last, IV, delta, gamma, theta, vega, OI, volume. Use this AFTER picking a strike to capture real premium pricing in the trade plan (no more 'estimated $1.20–$2.20' — Tradier returns the actual range).",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Underlying ticker, e.g. 'SPY'." },
        expiry: { type: "string", description: "Option expiry YYYY-MM-DD (e.g. '2026-04-30' for 0DTE)." },
        strike: { type: "number", description: "Strike price as a dollar number (e.g. 720)." },
        right: { type: "string", enum: ["call", "put"], description: "Option type." },
      },
      required: ["ticker", "expiry", "strike", "right"],
    },
  },
  {
    name: "fetch_bars",
    description:
      "Fetch OHLC bars for a ticker. Two ways to specify the window: (1) Pass `days` for a quick lookback (default 20 trading days for kind=daily; today's session for kind=intraday). (2) Pass explicit `start` and/or `end` for any historical date range — full multi-year history is supported by Tradier. The response includes intraday VWAP per bar.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        kind: { type: "string", enum: ["daily", "intraday"], description: "Bar granularity." },
        days: {
          type: "integer",
          description:
            "Lookback window. For kind=daily: how many trading days back from today (default 20; no upper cap, but Tradier may throttle large pulls — use start/end for windows > 250 days). Ignored if `start` is provided.",
        },
        start: {
          type: "string",
          description:
            "Inclusive start. For kind=daily: YYYY-MM-DD. For kind=intraday: YYYY-MM-DD or 'YYYY-MM-DD HH:MM' (ET). When set, takes precedence over `days`.",
        },
        end: {
          type: "string",
          description:
            "Inclusive end. Same format as `start`. Defaults to today (or today's RTH close for intraday).",
        },
        interval: {
          type: "string",
          enum: ["1min", "5min", "15min"],
          description: "For kind=intraday: bar interval (default 5min).",
        },
      },
      required: ["ticker", "kind"],
    },
  },
  {
    name: "fetch_options_snapshot",
    description:
      "Fetch a complete max-pain + GEX snapshot for a single ticker. The server pulls the options chain from Tradier (with greeks), computes max pain per expiration, gamma exposure ($B per 1%), zero-gamma flip strike, call/put walls, and the GEX regime, and returns a ready-to-publish per-ticker object you can pass directly to publish_max_pain_scan in the tickers array. Auto-attaches RETAIL/PIN tags as appropriate. If Tradier returns no chain, the response includes `tags: ['STALE']` and minimal fields.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "Uppercase ticker symbol. Use SPX/VIX (no caret) for indices.",
        },
        group: {
          type: "string",
          enum: ["trading_focus", "pin_friendly", "index_vol", "mega_cap"],
          description: "Which sidebar group this ticker belongs to.",
        },
        max_dte: {
          type: "integer",
          description: "Max days-to-expiration to include (default 60).",
        },
      },
      required: ["ticker", "group"],
    },
  },
  {
    name: "get_max_pain_yesterday",
    description:
      "Fetch the most recent prior max-pain snapshot (the latest scan with scan_day < today, in America/New_York). Use this BEFORE running today's scan so you can compare today vs prior and emit regime-change alerts (GAMMA_FLIP_CROSS, REGIME_CHANGE, MAX_PAIN_SHIFT, WALL_BREAK_*, FLIP_MIGRATION). Returns null on the first run (no history yet) — that's expected.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "publish_max_pain_scan",
    description:
      "Publish (or append to) today's max-pain + GEX snapshot for the website. Because 16 tickers × multiple expirations is a large payload, call MULTIPLE TIMES with `append=true`. Each call merges the supplied tickers/alerts into the day's row (tickers de-duped by symbol — last write wins; alerts concatenated). Send chunk 1 with `append=false` to create the day's record (with title + body_md + the first batch of tickers); call again with `append=true` for additional ticker batches and the alerts list.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Scan title, e.g. 'Max Pain Scan — April 30, 2026'. Required only on the first chunk.",
        },
        body_md: {
          type: "string",
          description:
            "Optional short markdown commentary (executive summary, regime overview, notable shifts). Set on first chunk; later chunks may set it to amend.",
        },
        tickers: {
          type: "array",
          description:
            "Per-ticker snapshots. Send 4-5 tickers per call to stay well under the stream-idle window. The server merges by ticker symbol across calls.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              group: {
                type: "string",
                enum: ["trading_focus", "pin_friendly", "index_vol", "mega_cap"],
              },
              spot: { type: "number" },
              frontMonthMaxPain: { type: "number" },
              totalGEX: { type: "number", description: "$B per 1%" },
              flipStrike: { type: "number" },
              callWall: { type: "number" },
              putWall: { type: "number" },
              regime: { type: "string", enum: ["POS", "NEG", "FLIP"] },
              expirations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    exp: { type: "string", description: "YYYY-MM-DD" },
                    dte: { type: "integer" },
                    maxPain: { type: "number" },
                    spot: { type: "number" },
                    callOI: { type: "integer" },
                    putOI: { type: "integer" },
                    pcRatio: { type: "number" },
                    netGEX: { type: "number", description: "$M per 1%" },
                    source: { type: "string" },
                  },
                  required: ["exp"],
                },
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags like RETAIL, PIN, EST, STALE",
              },
              source: { type: "string" },
              notes: { type: "string" },
            },
            required: ["ticker", "group"],
          },
        },
        alerts: {
          type: "array",
          description:
            "Regime-change alerts generated by comparing today vs yesterday. Send on whichever chunk you prefer (typically the last). Concatenated across chunks.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "GAMMA_FLIP_CROSS",
                  "REGIME_CHANGE",
                  "MAX_PAIN_SHIFT",
                  "WALL_BREAK_CALL",
                  "WALL_BREAK_PUT",
                  "FLIP_MIGRATION",
                  "CROSS_SOURCE_DISAGREE",
                ],
              },
              severity: { type: "string", enum: ["HIGH", "MED", "LOW"] },
              message: { type: "string" },
              prior_value: { type: ["number", "string"] },
              current_value: { type: ["number", "string"] },
            },
            required: ["ticker", "type", "severity", "message"],
          },
        },
        append: {
          type: "boolean",
          description: "false (or omitted) on first chunk; true on subsequent chunks.",
        },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
      required: [],
    },
  },
  {
    name: "fetch_crypto_quote",
    description:
      "Fetch live spot prices for crypto USDT pairs from Coingecko. Returns last price, 24h change %, and 24h volume per ticker. Watchlist is BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ZECUSDT, LINKUSDT, AVAXUSDT, SUIUSDT, TAOUSDT, NEARUSDT, ASTERUSDT (the same set the Crypto Radar tracks). **Coingecko is the only source of truth for crypto prices** — never use training-data memory.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Subset of the watchlist. If omitted, returns all 12. Symbols are USDT pairs e.g. 'BTCUSDT'.",
        },
      },
      required: [],
    },
  },
  {
    name: "fetch_crypto_bars",
    description:
      "Fetch OHLC klines for a USDT pair from a public crypto exchange (OKX). Returns up to `limit` bars, oldest first. Use this for any historical price reference: cycle highs/lows, swing anchors, support/resistance levels, multi-timeframe structure. **The returned bars are the only source of truth for crypto historical prices** — every dated price you reference in body_md must come from a row this tool returned. Symbol must be in the crypto watchlist (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, ZECUSDT, LINKUSDT, AVAXUSDT, SUIUSDT, TAOUSDT, NEARUSDT, ASTERUSDT).",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "Uppercase USDT pair e.g. 'BTCUSDT'.",
        },
        interval: {
          type: "string",
          enum: ["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"],
          description: "Bar interval. Common: '4h' for 4-hour, '1d' for daily, '1w' for weekly.",
        },
        limit: {
          type: "integer",
          description: "Number of bars to return (default 200, max 300).",
        },
      },
      required: ["symbol", "interval"],
    },
  },
  {
    name: "publish_crypto_research",
    description:
      "Publish (or replace) today's crypto Daily Research post. Upserts on scan_day — re-running the same day overwrites. The post renders on /crypto/research with a markdown body and a structured trades table for BTCUSDT/ETHUSDT/SOLUSDT (and any other tickers you include). Each ticker becomes one row in the trades table; pass an empty array if you only want a markdown writeup.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Post title, e.g. 'Crypto Research — May 8, 2026'.",
        },
        headline: {
          type: "string",
          description: "One-line summary shown above the trades table (≤ 200 chars). E.g. 'BTC reclaiming $105K; ETH lagging below 4H 200 EMA; SOL coiling at $185 pivot'.",
        },
        body_md: {
          type: "string",
          description: "Full markdown body (analysis, structure, narrative). Image markdown is OK; tables, lists, headings all rendered with rehype-sanitize.",
        },
        trades: {
          type: "array",
          description: "Structured trade plans. Typically one entry each for BTCUSDT, ETHUSDT, SOLUSDT, but flexible — include other watchlist tickers if relevant. Empty array publishes text-only.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "USDT pair e.g. 'BTCUSDT'." },
              bias: {
                type: "string",
                enum: ["long", "short", "neutral", "avoid"],
              },
              entry_zone: {
                type: "string",
                description: "Entry price or range, e.g. '$104,500-$105,200' or '$105,000 on retest'.",
              },
              entry_trigger: {
                type: "string",
                description: "What confirms entry, e.g. '4H close above $105,200' or 'rejection at 4H 200 EMA'.",
              },
              target1: { type: ["number", "string"] },
              target2: { type: ["number", "string"] },
              stop: { type: ["number", "string"] },
              time_horizon: {
                type: "string",
                description: "How long the plan is valid: 'intraday', '1-2 days', 'swing', 'until weekly close', etc.",
              },
              rationale: {
                type: "string",
                description: "Brief 'why' — structural read in 1-2 sentences. Reference real price levels from fetched bars.",
              },
            },
            required: ["ticker"],
          },
        },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
      },
      required: ["title", "body_md"],
    },
  },
  {
    name: "publish_crypto_weekly_research",
    description:
      "Publish (or replace) one ticker's weekly long-form research writeup for the Crypto Weekly Research tab. Upserts on (ticker, scan_day) — re-running for the same ticker on the same week overwrites. Each ticker is its own post (call this once per ticker — typically once each for BTCUSDT, ETHUSDT, SOLUSDT). Pass image refs from upload_research_image (with source_url) — the page renders body_md (sanitized markdown) above the images, weekly chart first then daily chart.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "USDT pair, e.g. 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'.",
        },
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York. Use the Sunday-night run date so all three tickers share the same scan_day.",
        },
        title: {
          type: "string",
          description: "Post title. Recommended format: '<TICKER> Weekly Research — <Month Day, Year>' (e.g. 'BTCUSDT Weekly Research — May 11, 2026').",
        },
        headline: {
          type: "string",
          description: "One-line summary shown above the body (e.g. 'BTC $108,500 — bullish above $105K weekly pivot, bearish below $100K'). ≤ 240 chars.",
        },
        body_md: {
          type: "string",
          description: "Full markdown writeup — narrative, key levels, structure, target projections. Do NOT include `![...](...)` image markdown; charts render separately from the `images` array.",
        },
        images: {
          type: "array",
          description: "Charts to attach. Each entry references an upload_research_image result. Page renders in slot order: weekly first, daily second.",
          items: {
            type: "object",
            properties: {
              slot: { type: "string", description: "'weekly' or 'daily'." },
              key: { type: "string", description: "Bucket key from upload_research_image." },
              url: { type: "string", description: "URL from upload_research_image." },
              alt: { type: "string" },
              width: { type: "integer" },
              height: { type: "integer" },
            },
            required: ["slot", "key", "url"],
          },
        },
      },
      required: ["ticker", "title", "body_md"],
    },
  },
  {
    name: "publish_economic_calendar",
    description:
      "Publish (upsert) the upcoming week's US economic calendar events with regime-aware impact narratives. Call this once per Sunday run with the full event list for the week. Each event upserts on (country, title, event_time) — re-running with updated data after a print fills in `actual` without clobbering existing commentary. Include high- and medium-importance US events; only include EU/GB/JP/CN events that are likely to move US risk (ECB/BoJ/BoE decisions, major CN data).",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: "Structured list of economic events for the upcoming week (and optionally this week's remainder).",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event name, e.g. 'CPI YoY', 'FOMC Rate Decision', 'Powell Speaks at Brookings'." },
              country: { type: "string", description: "ISO-2 country: US, EU, GB, JP, CN." },
              event_time: { type: "string", description: "ISO-8601 UTC datetime, e.g. '2026-05-13T12:30:00Z'." },
              importance: { type: "string", enum: ["low", "medium", "high"] },
              estimate: { type: "number", description: "Consensus estimate (numeric, null if none)." },
              prior: { type: "number", description: "Previous reading (numeric, null if not applicable)." },
              actual: { type: "number", description: "Actual print, if already released; null otherwise." },
              unit: { type: "string", description: "Display unit: '%', 'K', '$B', etc." },
              description: {
                type: "string",
                description: "1–2 sentence plain-English description of what the event measures.",
              },
              impact_text: {
                type: "string",
                description: "100–200 word regime-aware narrative on potential market impact. Note current Fed/central-bank stance, asymmetric reactions for hot vs cold prints, and which assets (SPX, rates, USD, gold, VIX) are most exposed.",
              },
              asset_tags: {
                type: "array",
                description: "Asset/instrument tickers most likely to move (e.g. ['SPX','rates','USD','gold','VIX']).",
                items: { type: "string" },
              },
            },
            required: ["title", "country", "event_time", "importance"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    name: "get_institutional_funds",
    description:
      "Return the admin-configured list of funds the weekly Institutional Flow scan should pull 13F filings for. Call this at the start of every institutional run — admin edits between runs (add/disable funds via /admin/research/funds) are the whole point. Hardcoding the fund list is NOT acceptable.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fetch_13f_holdings",
    description:
      "Fetch the N most recent 13F-HR filings for a given SEC CIK and return PARSED holdings (no fabrication, no third-party aggregators). Server runs on Railway with open egress to data.sec.gov, so this works even when the calling routine's container cannot reach EDGAR directly. Returns issuer name + CUSIP for each holding — resolve CUSIP→ticker via a separate live-price lookup (Yahoo Finance accepts CUSIP, or use the issuer name with a web search). For the institutional scan, call this for each fund returned by get_institutional_funds, then compare the latest two filings by CUSIP to detect acceleration. Note: value_usd is reported as SEC stores it (whole dollars for filings since 2022-Q4, $1000s before — newer filings are virtually always whole dollars).",
    inputSchema: {
      type: "object",
      properties: {
        cik: {
          type: "string",
          description:
            "10-digit zero-padded CIK (e.g. '0001067983' for Berkshire). Non-padded numeric strings are accepted too; the server pads automatically.",
        },
        num_quarters: {
          type: "integer",
          minimum: 1,
          maximum: 8,
          description:
            "How many most-recent 13F-HR filings to return. Default 2 — enough to compare quarter-over-quarter. Increase to 4 only for trend analysis across a year.",
        },
      },
      required: ["cik"],
    },
  },
  {
    name: "publish_institutional_research",
    description:
      "Publish (UPSERT) the weekly Institutional Flow scan to the /research/institutional tab. ONE row per scan_day — re-runs on the same day overwrite cleanly. The `stocks` array drives the page render directly; do NOT pass a markdown body. Each stock entry needs the supportingFunds breakdown, the retailAttention block, and a thesis. Call this exactly once per run, after fetching funds via get_institutional_funds and comparing the latest two 13F windows.",
    inputSchema: {
      type: "object",
      properties: {
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        summary: {
          type: "string",
          description:
            "1–2 paragraph executive summary. State which 13F windows were compared, how many manager-tickers qualified, and the single most surprising finding. Plain prose, no bullet points. ≤ 4000 chars.",
        },
        methodology: {
          type: "string",
          description:
            "1 paragraph plain-text description of the filter logic actually applied this run. Mention any caveats that hit (missing filings, sector-ETF skips, quant-manager weighting). ≤ 2000 chars.",
        },
        stocks: {
          type: "array",
          description:
            "Up to 10 stocks (typically 5) that passed both the acceleration filter and the retail-attention filter. Order is preserved — most compelling first. Empty array IS allowed when nothing qualifies; the page renders 'no candidates qualified this scan' and shows the methodology.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "Uppercase ticker, e.g. 'TSLA'." },
              companyName: { type: "string" },
              sector: { type: "string", description: "GICS sector or null." },
              marketCapUsdB: {
                type: "number",
                description: "Market cap in $B (e.g. 12.4 for $12.4B). Null if unknown.",
              },
              avgEntryPriceEstimate: {
                type: "number",
                description:
                  "Estimated average entry price across the funds, derived from filing value ÷ shares held at quarter-end. ESTIMATE only — 13F doesn't report cost basis.",
              },
              currentPrice: { type: "number", description: "Latest live price." },
              totalSharesHeldUsd: {
                type: "number",
                description: "Total $ value of the position across the supporting funds, latest 13F.",
              },
              totalSharesHeld: {
                type: "number",
                description: "Total share count across the supporting funds, latest 13F.",
              },
              supportingFunds: {
                type: "array",
                description:
                  "Per-fund breakdown for funds in the configured watchlist that ADDED to or NEWLY OPENED this position. At least 1, typically 2–3. Funds that didn't change or trimmed are omitted.",
                items: {
                  type: "object",
                  properties: {
                    fund: { type: "string", description: "Fund display name (matches get_institutional_funds name)." },
                    sharesNow: { type: "number", description: "Shares held in the latest filing." },
                    sharesPrior: {
                      type: "number",
                      description: "Shares held in the prior filing. Use null when isNewPosition=true.",
                    },
                    deltaPct: {
                      type: "number",
                      description: "Q/Q % change in shares. Null when isNewPosition=true (the page renders +∞).",
                    },
                    isNewPosition: {
                      type: "boolean",
                      description: "True if the fund had zero shares in the prior filing (new position this quarter).",
                    },
                  },
                  required: ["fund", "sharesNow", "isNewPosition"],
                },
              },
              retailAttention: {
                type: "object",
                description: "Proof that the retail crowd hasn't caught on yet. All four fields are nullable when unavailable.",
                properties: {
                  googleTrendsScore: {
                    type: "number",
                    description: "0–100, 30-day average. Low = quiet. ≤ 25 contributes to the 'low attention' decision.",
                  },
                  news30DayCount: {
                    type: "number",
                    description: "Count of mainstream-source articles in the last 30 days. ≤ 15 contributes to 'low attention'.",
                  },
                  isOnRetailHotlist: {
                    type: "boolean",
                    description:
                      "True if the ticker is currently in the top-100 on r/wallstreetbets, StockTwits trending, or any major 'most active' list. If true, the stock should generally be EXCLUDED — the edge is gone.",
                  },
                  optionsCallPutOiRatio: {
                    type: "number",
                    description: "Total call OI ÷ total put OI. < 2.0 contributes to 'low attention' (no meme/squeeze setup).",
                  },
                },
                required: ["isOnRetailHotlist"],
              },
              earningsNext: {
                type: "string",
                description: "Next earnings date in YYYY-MM-DD format. Skip the stock entirely if within 7 trading days.",
              },
              thesis: {
                type: "string",
                description:
                  "3–5 sentence plain prose. Explain WHY these specific funds added — not just WHAT they did. Reference their broader portfolio. End with the specific catalyst they likely see that retail hasn't priced in yet. ≤ 2000 chars.",
              },
              risks: {
                type: "string",
                description:
                  "1–3 sentence honest counter — what would invalidate the thesis. Earnings event, sector regime change, name-specific overhang. Don't soft-pedal. ≤ 1000 chars.",
              },
            },
            required: [
              "ticker",
              "companyName",
              "supportingFunds",
              "retailAttention",
              "thesis",
            ],
          },
        },
        run_meta: {
          type: "object",
          description: "Optional metadata: filing windows compared, model version, prompt version, anything for after-action review.",
          additionalProperties: true,
        },
      },
      required: ["summary", "methodology", "stocks"],
    },
  },
  {
    name: "publish_earnings_whiplash",
    description:
      "Publish (UPSERT) the weekly Earnings Whiplash Map scan to the /research/earnings tab. ONE row per scan_day — re-runs on the same day overwrite cleanly. The `stocks` array drives the page render directly; do NOT pass a markdown body. Each stock entry needs the historical post-earnings move stats, the current options-implied move, and a thesis. Flag 3 names with isFlagged=true where IV is meaningfully BELOW historical realized vol (asymmetric long-vol setups). Call this exactly once per run.",
    inputSchema: {
      type: "object",
      properties: {
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today's date in America/New_York.",
        },
        summary: {
          type: "string",
          description:
            "1–2 paragraph executive summary. State the date range scanned (next ~14 days), how many setups qualified, and which 3 names you flagged as asymmetric. Plain prose, no bullet points. ≤ 4000 chars.",
        },
        methodology: {
          type: "string",
          description:
            "1 paragraph plain-text description of the filter logic actually applied: lookback window for historical moves, how implied move was derived (front-month ATM straddle ÷ underlying), what 'meaningfully lower' means in your threshold. Mention caveats (small sample, vol regime shifts). ≤ 2000 chars.",
        },
        stocks: {
          type: "array",
          description:
            "Up to 20 stocks (typically 10). Order is preserved — rank by historical post-earnings move size descending. The 3 flagged asymmetric setups must have isFlagged=true; everything else isFlagged=false.",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string", description: "Uppercase ticker." },
              companyName: { type: "string" },
              sector: { type: "string", description: "GICS sector or null." },
              marketCapUsdB: { type: "number", description: "Market cap in $B. Null if unknown." },
              earningsDate: {
                type: "string",
                description: "Next earnings report date in YYYY-MM-DD.",
              },
              earningsTime: {
                type: "string",
                enum: ["bmo", "amc", "unknown"],
                description: "Before-market-open / after-market-close / unknown.",
              },
              currentPrice: { type: "number", description: "Latest live price." },
              historicalAvgMovePct: {
                type: "number",
                description:
                  "Average ABSOLUTE % post-earnings move over the lookback window. e.g. 9.4 means the stock has moved 9.4% on average (up or down) on the session following the report.",
              },
              historicalMaxMovePct: {
                type: "number",
                description: "Worst absolute % post-earnings move in the lookback window.",
              },
              historicalMovesAbove8Pct: {
                type: "integer",
                description:
                  "Count of post-earnings sessions in the lookback where |move| ≥ 8%.",
              },
              lookbackQuarters: {
                type: "integer",
                description: "How many quarters were averaged (typically 8 = 2 years).",
              },
              impliedMovePct: {
                type: "number",
                description:
                  "Current options-implied move, derived from the front-month ATM straddle premium ÷ underlying price. Example: SPY $5.20 straddle ÷ $520 spot = 1.0% implied move.",
              },
              ivVsHvDeltaPct: {
                type: "number",
                description:
                  "impliedMovePct − historicalAvgMovePct. NEGATIVE = IV cheap (long-vol candidate). POSITIVE = IV rich. The 3 flagged names should have meaningfully negative deltas (typically ≤ −1.5 percentage points).",
              },
              isFlagged: {
                type: "boolean",
                description: "True for the 3 asymmetric setups; false for the other 7.",
              },
              flagReason: {
                type: "string",
                description:
                  "1–2 sentence plain-English reason WHY this is the asymmetric setup the routine flagged. Reference the IV gap and the historical realized. Required when isFlagged=true; null otherwise.",
              },
              thesis: {
                type: "string",
                description:
                  "3–4 sentence plain prose. For flagged names: the specific catalyst/setup that makes the historical realized likely to repeat (e.g., guidance pattern, sector dispersion, recent comps that moved big). For ranked names: what makes this stock's earnings historically volatile and what to watch for at this report. ≤ 1500 chars.",
              },
              risks: {
                type: "string",
                description:
                  "1–2 sentence honest counter — what would invalidate the setup. Don't soft-pedal. ≤ 800 chars.",
              },
            },
            required: [
              "ticker",
              "companyName",
              "earningsDate",
              "earningsTime",
              "isFlagged",
              "thesis",
            ],
          },
        },
        run_meta: {
          type: "object",
          description: "Optional metadata: data sources used, IV calc method, model version.",
          additionalProperties: true,
        },
      },
      required: ["summary", "methodology", "stocks"],
    },
  },
  {
    name: "fetch_earnings_whiplash",
    description:
      "Read the most-recent published Earnings Whiplash scan (or a specific scan_day). Returns the structured stocks[] array + summary + methodology + run_at so downstream routines (e.g. the Sunday Weekly Earnings Brief script writer) can build on the flagged setups without re-running the analysis.",
    inputSchema: {
      type: "object",
      properties: {
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD. If omitted, returns the most recent scan (typically the prior Saturday's run).",
        },
      },
    },
  },
  {
    name: "fetch_latest_earnings_scan",
    description:
      "Read the most-recent raw weekly earnings_scans row produced by the Railway earnings-scan-cron. Unlike fetch_earnings_whiplash (which reads the prose-published earnings_posts), this returns the FORWARD calendar with pre-computed per-ticker stats: impliedMovePct from the live straddle, historyStats.medianAbs from 8 prior earnings cycles, etc. Designed for the Saturday Earnings Whiplash claude.ai routine to consume — no Finnhub or Polygon calls needed downstream; the heavy lifting already happened in the cron.",
    inputSchema: {
      type: "object",
      properties: {
        scan_week: {
          type: "string",
          description: "Optional YYYY-MM-DD. If omitted, returns the most recent scan_week.",
        },
      },
    },
  },
  {
    name: "publish_sector_rotation",
    description:
      "Publish (UPSERT) the weekly Sector Rotation Detector scan to the /research/rotation tab. ONE row per scan_day. The `sectors` array drives the page render directly — no markdown body. For each of the 11 S&P 500 sectors, supply RS now vs RS prior year and a direction (turning_positive / turning_negative / stable_positive / stable_negative). Sectors with isRotating=true ALSO need a topEtfs array (5 entries ranked by 10-day money flow). Call exactly once per run.",
    inputSchema: {
      type: "object",
      properties: {
        scan_day: {
          type: "string",
          description: "Optional YYYY-MM-DD; defaults to today in America/New_York.",
        },
        summary: {
          type: "string",
          description:
            "1–2 paragraph executive summary: how many sectors are flipping this week, in which direction, the single most surprising rotation. Plain prose, no bullet points. ≤ 4000 chars.",
        },
        methodology: {
          type: "string",
          description:
            "1 paragraph: comparison windows used (e.g. 'last 30 trading days vs the same calendar window in 2025'), the money-flow proxy used (price × volume × sign), the threshold for 'isRotating' (sign flip + magnitude), any caveats (regime shifts, holidays in the window). ≤ 2000 chars.",
        },
        sectors: {
          type: "array",
          description:
            "Up to 15 sectors. Typically the 11 SPDR sectors plus any thematic groupings (e.g. Semiconductors carved out of Tech). Order with rotating sectors FIRST, ranked by rotationMagnitudePct DESC.",
          items: {
            type: "object",
            properties: {
              sectorName: { type: "string", description: "Human label, e.g. 'Technology', 'Energy', 'Communication Services'." },
              sectorEtf: { type: "string", description: "Primary SPDR sector ETF ticker, e.g. 'XLK'." },
              last30DayReturnPct: { type: "number", description: "Sector ETF 30-day return %." },
              spy30DayReturnPct: { type: "number", description: "SPY 30-day return for the same window." },
              relativeStrength: {
                type: "number",
                description: "last30DayReturnPct − spy30DayReturnPct. Positive = sector leads SPY.",
              },
              priorYear30DayReturnPct: {
                type: "number",
                description: "Sector ETF 30-day return for the SAME calendar window one year ago.",
              },
              spyPriorYear30DayReturnPct: {
                type: "number",
                description: "SPY 30-day return for the same prior-year window.",
              },
              relativeStrengthPriorYear: {
                type: "number",
                description: "priorYear values — sector minus SPY a year ago.",
              },
              rotationDirection: {
                type: "string",
                enum: ["turning_positive", "turning_negative", "stable_positive", "stable_negative"],
                description:
                  "turning_positive: RS was negative, now positive (new leadership). turning_negative: was positive, now negative (decaying). stable_*: same sign both windows.",
              },
              rotationMagnitudePct: {
                type: "number",
                description:
                  "|relativeStrength − relativeStrengthPriorYear|. Higher = more decisive flip. Use as the sort key.",
              },
              isRotating: {
                type: "boolean",
                description: "True when rotationDirection is turning_positive or turning_negative.",
              },
              topEtfs: {
                type: "array",
                description:
                  "REQUIRED when isRotating=true: 5 highest-volume ETFs in this sector ranked by 10-day net money flow (#1 = most inflow). Empty array OK when isRotating=false.",
                items: {
                  type: "object",
                  properties: {
                    ticker: { type: "string", description: "ETF ticker." },
                    name: { type: "string", description: "Full fund name, e.g. 'Technology Select Sector SPDR Fund'." },
                    aumUsdB: { type: "number", description: "Assets under management in $B." },
                    avgDailyDollarVolumeUsd: {
                      type: "number",
                      description: "10-day average daily dollar volume (price × shares traded).",
                    },
                    moneyFlowUsd: {
                      type: "number",
                      description:
                        "10-day net money flow proxy. Sum of (price × volume × sign(close − prior_close)) across 10 days. Positive = net inflow.",
                    },
                    moneyFlowRank: { type: "integer", description: "1-5, 1 = highest inflow." },
                    currentPrice: { type: "number" },
                    thirtyDayReturnPct: { type: "number", description: "ETF's 30-day return." },
                    note: {
                      type: "string",
                      description: "Optional 1-line context. e.g. 'Pure semi exposure' or 'Equal-weight'.",
                    },
                  },
                  required: ["ticker", "name", "moneyFlowRank"],
                },
              },
              thesis: {
                type: "string",
                description:
                  "3-5 sentence plain prose. For rotating sectors: WHY this rotation is happening (macro driver, earnings cycle, regime shift, narrative). For stable sectors: 1-2 sentence context note. ≤ 2000 chars.",
              },
              risks: {
                type: "string",
                description: "1-2 sentence honest counter — what would invalidate the rotation read. ≤ 1000 chars.",
              },
            },
            required: [
              "sectorName",
              "sectorEtf",
              "rotationDirection",
              "isRotating",
              "thesis",
            ],
          },
        },
        run_meta: {
          type: "object",
          description: "Optional metadata: comparison windows (dates), money-flow proxy formula, model version.",
          additionalProperties: true,
        },
      },
      required: ["summary", "methodology", "sectors"],
    },
  },
];

// ----------- internal publish helpers (bypass HTTP, write straight to DB) ---

interface DteArgs {
  title?: string;
  body_md: string;
  trading_day?: string;
  append?: boolean;
  /**
   * Optional structured trade objects. When present, these are stored
   * directly on the post — bypassing the markdown table parser. Used by the
   * settlement routine which has trades with outcome/pnl_pct/result_notes
   * fields that don't fit the parser's table-based extraction. When absent,
   * trades are parsed from body_md as before (premarket / market_open /
   * analysis routines work unchanged).
   */
  trades?: TradeRow[];
  sentiment?: "bullish" | "bearish" | "neutral";
  bias?: string;
  /**
   * When true, after a successful publish, also email the bot inbox a copy
   * of the post (rendered HTML body + trade summary table). Reads
   * DTE_RESEARCH_EMAIL_TO env (comma-separated list). Set this true on the
   * FINAL publish_dte_research call so the email contains the complete
   * post, not a partial first chunk.
   */
  send_email?: boolean;
  /**
   * Which scan lane this report belongs to. Defaults to "premarket" so the
   * existing 8:30 routine works untouched. The 9:45 routine sets this to
   * "market_open"; the 10:00 analysis routine sets it to "analysis". Each
   * lane is a separate row keyed on (trading_day, scan_kind).
   */
  scan_kind?: "premarket" | "market_open" | "analysis" | "settlement";
}

function resolveDteScanKind(
  args: DteArgs,
): "premarket" | "market_open" | "analysis" | "settlement" {
  if (
    args.scan_kind === "market_open" ||
    args.scan_kind === "analysis" ||
    args.scan_kind === "settlement"
  ) {
    return args.scan_kind;
  }
  return "premarket";
}

async function publishDte(args: DteArgs): Promise<{ url: string; trades_count: number; trading_day: string; scan_kind: string; mode: string; body_chars: number }> {
  const tradingDay = args.trading_day || nyTradingDay();
  const scanKind = resolveDteScanKind(args);
  const routineName =
    scanKind === "market_open"
      ? "0DTE Market Open Scan"
      : scanKind === "analysis"
        ? "0DTE Comparative Analysis"
        : scanKind === "settlement"
          ? "0DTE Post-Close Settlement"
          : "0DTE Trading Research";
  const meta = { routine_name: routineName, agent: "claude-mcp", scan_kind: scanKind };
  const postUrl = (day: string) => (scanKind === "premarket" ? `/posts/${day}` : `/posts/${day}?tab=${scanKind}`);

  // Append mode: concatenate to existing post (this lane), re-parse trades.
  if (args.append === true) {
    const existing = await db
      .select()
      .from(posts)
      .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, scanKind)))
      .limit(1);
    if (existing[0]) {
      const merged = `${existing[0].bodyMd}\n\n${args.body_md}`;
      const trades = parseTradesFromMarkdown(merged) as TradeRow[];
      const tickers = trades.map((t) => t.ticker);
      const title = args.title || existing[0].title || inferTitle(merged) || `0DTE Options Analysis — ${tradingDay}`;
      const [row] = await db
        .update(posts)
        .set({
          title,
          bodyMd: merged,
          trades,
          tickers,
          runAt: existing[0].runAt ?? new Date(),
          meta,
          updatedAt: sql`now()`,
        })
        .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, scanKind)))
        .returning({ id: posts.id, tradingDay: posts.tradingDay, scanKind: posts.scanKind });
      if (args.send_email) {
        await maybeSendDteEmail({
          title,
          tradingDay: row.tradingDay,
          runAt: existing[0].runAt ?? new Date(),
          sentiment: existing[0].sentiment ?? null,
          bias: existing[0].bias ?? null,
          bodyMd: merged,
          trades,
        });
      }
      return {
        url: postUrl(row.tradingDay),
        trades_count: trades.length,
        trading_day: row.tradingDay,
        scan_kind: row.scanKind,
        mode: "append",
        body_chars: merged.length,
      };
    }
    // Fall through to create path if no existing row for this (day, kind).
  }

  // Create / replace path. Conflict target is the (trading_day, scan_kind)
  // composite unique — so each lane is independent.
  // Prefer caller-supplied structured `trades` array (used by the settlement
  // routine to pass outcome/pnl_pct/result_notes fields the markdown parser
  // can't extract). Fall back to parsing body_md when not supplied.
  const trades: TradeRow[] =
    args.trades && args.trades.length > 0
      ? args.trades
      : (parseTradesFromMarkdown(args.body_md) as TradeRow[]);
  const tickers = trades.map((t) => t.ticker);
  const title = args.title || inferTitle(args.body_md) || `0DTE Options Analysis — ${tradingDay}`;
  const runAt = new Date();

  const [row] = await db
    .insert(posts)
    .values({
      tradingDay,
      scanKind,
      title,
      bodyMd: args.body_md,
      trades,
      tickers,
      sentiment: args.sentiment ?? null,
      bias: args.bias ?? null,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: [posts.tradingDay, posts.scanKind],
      set: {
        title,
        bodyMd: args.body_md,
        trades,
        tickers,
        sentiment: args.sentiment ?? null,
        bias: args.bias ?? null,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: posts.id, tradingDay: posts.tradingDay, scanKind: posts.scanKind });

  if (args.send_email) {
    await maybeSendDteEmail({
      title,
      tradingDay: row.tradingDay,
      runAt,
      sentiment: args.sentiment ?? null,
      bias: args.bias ?? null,
      bodyMd: args.body_md,
      trades,
    });
  }

  return {
    url: postUrl(row.tradingDay),
    trades_count: trades.length,
    trading_day: row.tradingDay,
    scan_kind: row.scanKind,
    mode: args.append === true ? "append-create" : "replace",
    body_chars: args.body_md.length,
  };
}

/** Renders the post body to HTML + a trade summary table and sends the
 *  daily research email. Best-effort: errors are logged but don't block
 *  the publish from returning success. */
async function maybeSendDteEmail(opts: {
  title: string;
  tradingDay: string;
  runAt: Date;
  sentiment: string | null;
  bias: string | null;
  bodyMd: string;
  trades: TradeRow[];
}): Promise<void> {
  try {
    const tickers = opts.trades.map((t) => t.ticker);
    const [bodyHtml, tradesTableHtml] = await Promise.all([
      renderMarkdown(opts.bodyMd, tickers),
      Promise.resolve(buildTradesTableHtml(opts.trades)),
    ]);
    await sendDteResearchEmail({
      title: opts.title,
      tradingDay: opts.tradingDay,
      runAt: opts.runAt,
      sentiment: opts.sentiment,
      bias: opts.bias,
      bodyHtml,
      tradesTableHtml,
    });
  } catch (err) {
    console.error("[publishDte] email failed (publish still succeeded):", err);
  }
}

interface InsiderArgs {
  title: string;
  body_md: string;
  buys: InsiderBuy[];
  scan_day?: string;
}

async function publishInsider(args: InsiderArgs): Promise<{ url: string; buys_count: number; scan_day: string }> {
  const scanDay = args.scan_day || nyTradingDay();
  const title = args.title || inferTitle(args.body_md) || `SEC Form 4 Insider Scan — ${scanDay}`;
  const runAt = new Date();

  const [row] = await db
    .insert(insiderPosts)
    .values({
      scanDay,
      title,
      bodyMd: args.body_md,
      buys: args.buys,
      runAt,
      meta: { routine_name: "SEC Form 4 Insider Scanner", agent: "claude-mcp" },
    })
    .onConflictDoUpdate({
      target: insiderPosts.scanDay,
      set: {
        title,
        bodyMd: args.body_md,
        buys: args.buys,
        runAt,
        meta: { routine_name: "SEC Form 4 Insider Scanner", agent: "claude-mcp" },
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: insiderPosts.id, scanDay: insiderPosts.scanDay });

  return {
    url: `/insider/${row.scanDay}`,
    buys_count: args.buys.length,
    scan_day: row.scanDay,
  };
}

// ----------- options-snapshot fetcher (Tradier) --------------------------

interface FetchSnapshotArgs {
  ticker: string;
  group: "trading_focus" | "pin_friendly" | "index_vol" | "mega_cap";
  max_dte?: number;
}

async function fetchOptionsSnapshot(args: FetchSnapshotArgs): Promise<MaxPainTicker> {
  const ticker = args.ticker.toUpperCase();
  const maxDte = args.max_dte ?? 60;
  const baseTags: string[] = [];
  if (RETAIL_TICKERS.has(ticker)) baseTags.push("RETAIL");
  if (PIN_TICKERS.has(ticker)) baseTags.push("PIN");

  const stale = (note: string): MaxPainTicker => ({
    ticker,
    group: args.group,
    tags: [...baseTags, "STALE"],
    notes: note,
    source: "Tradier (unavailable)",
  });

  const symbol = Tradier.tradierSymbol(ticker);

  let quote: Tradier.TradierQuote | null = null;
  try {
    quote = await Tradier.getQuote(symbol);
  } catch (err) {
    return stale(`Tradier quote failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!quote || !quote.last) {
    return stale(`Tradier quote returned no last price for ${symbol}`);
  }
  const spot = quote.last;

  let expirations: string[];
  try {
    expirations = await Tradier.getExpirations(symbol);
  } catch (err) {
    return stale(`Tradier expirations failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!expirations.length) {
    return stale(`No expirations returned for ${symbol}`);
  }

  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const eligibleExps = expirations.filter((e) => {
    const expMs = Date.parse(`${e}T00:00:00Z`);
    if (Number.isNaN(expMs)) return false;
    const dte = Math.round((expMs - todayMs) / 86_400_000);
    return dte >= 0 && dte <= maxDte;
  });

  if (!eligibleExps.length) {
    return stale(`No expirations within ${maxDte} DTE for ${symbol}`);
  }

  // Pull each chain in parallel (capped concurrency).
  const concurrency = 4;
  const chainsByExp: Record<string, Tradier.TradierOption[]> = {};
  for (let i = 0; i < eligibleExps.length; i += concurrency) {
    const batch = eligibleExps.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (exp) => {
        try {
          const opts = await Tradier.getChain(symbol, exp);
          return [exp, opts] as const;
        } catch {
          return [exp, [] as Tradier.TradierOption[]] as const;
        }
      }),
    );
    for (const [exp, opts] of results) chainsByExp[exp] = opts;
  }

  const stats = computeTickerStats({ spot, today: new Date(todayMs), chainsByExp });
  // Truncate to first 10 expirations for storage; keep full set in source if needed later.
  const firstTen = stats.expirations.slice(0, 10);

  return {
    ticker,
    group: args.group,
    spot: stats.spot,
    frontMonthMaxPain: stats.frontMonthMaxPain,
    totalGEX: stats.totalGEX,
    flipStrike: stats.flipStrike,
    callWall: stats.callWall,
    putWall: stats.putWall,
    regime: stats.regime,
    expirations: firstTen.map((e) => ({
      exp: e.exp,
      dte: e.dte,
      maxPain: e.maxPain,
      spot: e.spot,
      callOI: e.callOI,
      putOI: e.putOI,
      pcRatio: e.pcRatio,
      netGEX: e.netGEX,
      source: "Tradier",
    })),
    tags: baseTags,
    source: "Tradier",
  };
}

// ----------- Research helpers --------------------------------------------

interface UploadResearchImageArgs {
  ticker: string;
  scan_day?: string;
  slot: string;
  alt?: string;
  content_type?: string;
  data_base64?: string;
  source_url?: string;
  upload_id?: string;
  chunk_index?: number;
  chunk_total?: number;
}

const ALLOWED_IMG_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);

const MAX_DECODED_BYTES = 8 * 1024 * 1024; // 8MB after base64 decode

type UploadResult =
  | {
      mode: "final";
      ticker: string;
      scan_day: string;
      slot: string;
      key: string;
      url: string;
      alt?: string;
      size: number;
      content_type: string;
    }
  | {
      mode: "pending";
      upload_id: string;
      chunk_index: number;
      chunk_total: number;
      chunks_received: number;
      bytes_buffered: number;
    };

/** Strip `data:image/png;base64,` prefix if the model passed one by mistake. */
function stripDataUrlPrefix(b64: string): string {
  return b64.startsWith("data:") ? b64.split(",", 2)[1] || "" : b64;
}

async function finalizeAndUpload(params: {
  ticker: string;
  scanDay: string;
  slot: string;
  alt?: string;
  contentType: string;
  fullB64: string;
}): Promise<UploadResult> {
  const { ticker, scanDay, slot, alt, contentType, fullB64 } = params;
  const cleaned = stripDataUrlPrefix(fullB64);
  if (!cleaned) throw new Error("data_base64 is empty after assembly");
  const bytes = Buffer.from(cleaned, "base64");
  if (bytes.byteLength === 0) throw new Error("decoded image is 0 bytes");
  if (bytes.byteLength > MAX_DECODED_BYTES) {
    throw new Error(`image too large: ${bytes.byteLength} bytes (max ${MAX_DECODED_BYTES})`);
  }
  const key = buildResearchImageKey({ ticker, scanDay, slot, contentType });
  const out = await putObject(key, bytes, contentType);
  return {
    mode: "final",
    ticker,
    scan_day: scanDay,
    slot,
    key: out.key,
    url: out.url,
    alt,
    size: out.size,
    content_type: contentType,
  };
}

/** Opportunistic TTL cleanup for stale chunk rows (>1 hour old). */
async function cleanupStaleChunks(): Promise<void> {
  try {
    await db.execute(
      sql`DELETE FROM research_upload_chunks WHERE created_at < now() - interval '1 hour'`,
    );
  } catch {
    // best-effort — don't fail the request on cleanup error
  }
}

async function fetchImageFromUrl(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`source_url is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`source_url must be http(s); got ${parsed.protocol}`);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: { "User-Agent": "oliviatrades-research-fetcher/1.0" },
    });
  } catch (err) {
    throw new Error(`failed to fetch source_url: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`source_url returned HTTP ${res.status} ${res.statusText}`);
  }

  const respCt = (res.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
  // Allow image/* — server enforces caller's content_type when uploading to bucket.
  if (respCt && !respCt.startsWith("image/") && !respCt.startsWith("application/octet-stream")) {
    throw new Error(`source_url returned non-image content-type: ${respCt}`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("source_url returned 0 bytes");
  if (buf.byteLength > MAX_DECODED_BYTES) {
    throw new Error(`source_url returned ${buf.byteLength} bytes (max ${MAX_DECODED_BYTES})`);
  }
  return { bytes: new Uint8Array(buf), contentType: respCt };
}

async function uploadResearchImage(args: UploadResearchImageArgs): Promise<UploadResult> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const slot = String(args.slot || "").trim();
  if (!slot) throw new Error("slot required");
  const scanDay = args.scan_day || nyTradingDay();
  const contentType = args.content_type || "image/png";
  if (!ALLOWED_IMG_TYPES.has(contentType)) {
    throw new Error(`unsupported content_type: ${contentType}`);
  }

  // -------- Mode A: source_url --------
  const sourceUrl = String(args.source_url || "").trim();
  if (sourceUrl) {
    if (args.data_base64) {
      throw new Error("pass either source_url or data_base64, not both");
    }
    const { bytes, contentType: respCt } = await fetchImageFromUrl(sourceUrl);
    // Prefer the caller's declared content_type; otherwise fall back to the response's.
    const finalCt = args.content_type || (respCt && ALLOWED_IMG_TYPES.has(respCt) ? respCt : "image/png");
    const key = buildResearchImageKey({ ticker, scanDay, slot, contentType: finalCt });
    const out = await putObject(key, bytes, finalCt);
    return {
      mode: "final",
      ticker,
      scan_day: scanDay,
      slot,
      key: out.key,
      url: out.url,
      alt: args.alt,
      size: out.size,
      content_type: finalCt,
    };
  }

  // -------- Mode B/C: data_base64 (single or chunked) --------
  const chunkTotal = Math.max(args.chunk_total ?? 1, 1);
  const chunkIndex = Math.max(args.chunk_index ?? 0, 0);
  const data = String(args.data_base64 || "");
  if (data.length === 0) throw new Error("either source_url or data_base64 is required");

  // Single-call mode — no DB staging.
  if (chunkTotal === 1) {
    return finalizeAndUpload({
      ticker,
      scanDay,
      slot,
      alt: args.alt,
      contentType,
      fullB64: data,
    });
  }

  // Chunked mode.
  if (chunkIndex >= chunkTotal) {
    throw new Error(`chunk_index ${chunkIndex} >= chunk_total ${chunkTotal}`);
  }
  const uploadId = String(args.upload_id || "").trim();
  if (!uploadId) throw new Error("upload_id required when chunk_total > 1");
  if (uploadId.length > 200) throw new Error("upload_id too long");

  await cleanupStaleChunks();

  // Strip data: prefix only on the first chunk; subsequent chunks are raw.
  const stored = chunkIndex === 0 ? stripDataUrlPrefix(data) : data;

  await db
    .insert(researchUploadChunks)
    .values({
      uploadId,
      chunkIndex,
      chunkTotal,
      dataB64: stored,
    })
    .onConflictDoUpdate({
      target: [researchUploadChunks.uploadId, researchUploadChunks.chunkIndex],
      set: {
        chunkTotal,
        dataB64: stored,
      },
    });

  // Count rows for this upload_id.
  const rows = await db
    .select({
      chunkIndex: researchUploadChunks.chunkIndex,
      dataB64: researchUploadChunks.dataB64,
    })
    .from(researchUploadChunks)
    .where(eq(researchUploadChunks.uploadId, uploadId))
    .orderBy(asc(researchUploadChunks.chunkIndex));

  if (rows.length < chunkTotal) {
    return {
      mode: "pending",
      upload_id: uploadId,
      chunk_index: chunkIndex,
      chunk_total: chunkTotal,
      chunks_received: rows.length,
      bytes_buffered: rows.reduce((s, r) => s + r.dataB64.length, 0),
    };
  }

  // All chunks received — verify continuity and finalize.
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].chunkIndex !== i) {
      throw new Error(
        `chunk continuity error: expected index ${i}, got ${rows[i].chunkIndex} (have ${rows.length}/${chunkTotal})`,
      );
    }
  }
  const fullB64 = rows.map((r) => r.dataB64).join("");
  const result = await finalizeAndUpload({
    ticker,
    scanDay,
    slot,
    alt: args.alt,
    contentType,
    fullB64,
  });
  // Cleanup chunk rows.
  await db
    .delete(researchUploadChunks)
    .where(eq(researchUploadChunks.uploadId, uploadId));
  return result;
}

interface PublishResearchArgs {
  ticker: string;
  scan_day?: string;
  title: string;
  headline?: string;
  body_md: string;
  images?: ResearchImage[];
}

function deriveHeadline(body: string): string {
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  // Strip leading markdown headers / bullets / quotes for a clean snippet.
  return firstLine.replace(/^[#>*\-\s]+/, "").trim().slice(0, 160);
}

async function publishResearch(args: PublishResearchArgs): Promise<{
  url: string;
  ticker: string;
  scan_day: string;
  images_count: number;
  body_chars: number;
}> {
  return publishResearchInternal(args, "equity");
}

/** Allowlist of metals tickers. Keep tight — the metals routine should
 *  cover this universe and no other names. Rejecting unknown tickers
 *  here is a guardrail against a misconfigured routine accidentally
 *  publishing an equity into the metals stream.
 *
 *  XAUTUSDT is the **Tether Gold (XAUT) / USDT** crypto pair, traded 24/7
 *  on OKX. Each XAUT token is backed by 1 oz of physical gold held by
 *  Tether — it tracks spot gold but trades through weekends and overnight,
 *  so it captures price action that GLD (US equity market hours) misses.
 *  Data path goes through fetch_crypto_bars / fetch_crypto_quote, NOT
 *  fetch_bars (Tradier doesn't list crypto). The routine is expected to
 *  branch on that. Note: an earlier draft used "XAUUSDT" (no T) — that
 *  symbol doesn't exist as a real pair on any major exchange; the
 *  canonical spot-gold-vs-USDT instrument is XAUT/USDT. */
const METALS_ALLOWLIST = new Set([
  "GLD",      // SPDR Gold Trust
  "SLV",      // iShares Silver Trust
  "GDX",      // VanEck Gold Miners
  "GDXJ",     // VanEck Junior Gold Miners
  "CPER",     // US Copper Index Fund
  "PPLT",     // Aberdeen Platinum
  "NEM",      // Newmont
  "FCX",      // Freeport-McMoRan
  "XAUTUSDT", // Tether Gold (XAUT) / USDT — 24/7 spot-gold via OKX
]);

async function publishMetalsResearch(args: PublishResearchArgs): Promise<{
  url: string;
  ticker: string;
  scan_day: string;
  images_count: number;
  body_chars: number;
}> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!METALS_ALLOWLIST.has(ticker)) {
    throw new Error(
      `ticker "${ticker}" is not in the metals allowlist (${Array.from(METALS_ALLOWLIST).join(", ")})`,
    );
  }
  return publishResearchInternal(args, "metals");
}

/** Allowlist of quantum-computing tickers. Six US-listed names spanning
 *  trapped-ion (IONQ), superconducting (RGTI), annealing (QBTS), photonic
 *  (QUBT), neutral-atom (INFQ — Infleqtion, recent SPAC), and the
 *  picks-and-shovels play (FORM — FormFactor, cryogenic test gear used
 *  by every QC lab). All have SEC EDGAR fundamentals available. */
const QUANTUM_ALLOWLIST = new Set([
  "IONQ",  // IonQ — trapped-ion
  "RGTI",  // Rigetti Computing — superconducting
  "QBTS",  // D-Wave Quantum — annealing
  "QUBT",  // Quantum Computing Inc — photonic
  "INFQ",  // Infleqtion — neutral atom (recently SPAC'd)
  "FORM",  // FormFactor — cryogenic probe stations for QC labs
]);

async function publishQuantumResearch(args: PublishResearchArgs): Promise<{
  url: string;
  ticker: string;
  scan_day: string;
  images_count: number;
  body_chars: number;
}> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!QUANTUM_ALLOWLIST.has(ticker)) {
    throw new Error(
      `ticker "${ticker}" is not in the quantum allowlist (${Array.from(QUANTUM_ALLOWLIST).join(", ")})`,
    );
  }
  return publishResearchInternal(args, "quantum");
}

/**
 * Shared upsert path for equity + metals research. Sets asset_class
 * explicitly on both insert and on conflict so re-running an existing
 * ticker can't accidentally flip its stream (an equity post will always
 * stay equity unless a manual SQL change moves it).
 *
 * URL shape:
 *   equity → /research/<scan_day>/<ticker>
 *   metals → /research/metals/<scan_day>/<ticker>
 */
async function publishResearchInternal(
  args: PublishResearchArgs,
  assetClass: "equity" | "metals" | "quantum",
): Promise<{
  url: string;
  ticker: string;
  scan_day: string;
  images_count: number;
  body_chars: number;
}> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const scanDay = args.scan_day || nyTradingDay();
  const title = args.title || `${ticker} Research — ${scanDay}`;
  const bodyMd = args.body_md || "";
  const headline = (args.headline || deriveHeadline(bodyMd)).slice(0, 240);

  // Key Level Map validator. The canonical Wicked Stocks format is a
  // 3-column markdown table — | Level | Type | Role | — with star
  // ratings embedded in the Type column via a fixed vocabulary:
  //
  //   ★★★★★  Annual containment   — cycle anchors (A/C-wave, multi-quarter)
  //   ★★★★   Multi-week contain   — major D/B-wave pivots
  //   ★★★    Weekly containment   — weekly-bar pivots
  //   ★★     Intra-day containment — round numbers / recent pivots
  //   ★      Session containment  — single-session extremes
  //   (none) Wave projection      — ABCD measured-move targets
  //
  // Two known failure modes:
  //   1. 2-column table (| Level | Context |) — no Type classifications,
  //      no ★ characters anywhere.
  //   2. Bulleted list (- ★★★ $price — context) — ★ present but rendered
  //      format doesn't match the equity research pages.
  //
  // Validator rejects both:
  //   - require ★ present somewhere in body_md
  //   - require a markdown table row (line with two or more "|" chars)
  //     within the Key Level Map section
  const hasKeyLevelsHeading = /^#{1,4}\s*key\s+(?:level|levels)\b/im.test(bodyMd);
  if (hasKeyLevelsHeading) {
    if (!bodyMd.includes("★")) {
      throw new Error(
        `body_md has a "Key Level Map" / "Key Levels" section but no ★ ` +
          `rating characters. Required format: 3-column markdown table ` +
          `\`| Level | Type | Role |\` with star ratings embedded in the ` +
          `Type column using the canonical vocabulary — Annual containment ` +
          `(★★★★★), Multi-week contain (★★★★), Weekly containment (★★★), ` +
          `Intra-day containment (★★), Session containment (★), or Wave ` +
          `projection (no stars). See examples/research-routine-mcp.md.`,
      );
    }
    // Extract the section (from the heading to the next heading / end).
    const sectionMatch = bodyMd.match(
      /(?:^|\n)#{1,4}\s*Key\s+Levels?[^\n]*\n+([\s\S]*?)(?=\n#{1,4}\s|\n---|\n+$|$)/i,
    );
    const sectionBody = sectionMatch ? sectionMatch[1] : "";
    // Require at least one markdown table row in the section — line with
    // exactly 2+ pipe characters, signalling 3+ columns.
    const hasTableRow = /\n\s*\|[^\n]*\|[^\n]*\|/.test("\n" + sectionBody);
    if (!hasTableRow) {
      throw new Error(
        `body_md "Key Level Map" section has ★ characters but no markdown ` +
          `table rows. Required format is a 3-column table with header ` +
          `\`| Level | Type | Role |\`, not a bulleted list. Re-emit the ` +
          `section as a table; star ratings stay embedded inside the Type ` +
          `column (e.g. "| $245.30 | Annual containment (★★★★★) | C-wave low |").`,
      );
    }
  }
  const images: ResearchImage[] = (args.images || []).map((img) => ({
    slot: String(img.slot || "image"),
    key: String(img.key || ""),
    url: String(img.url || ""),
    alt: img.alt,
    width: img.width,
    height: img.height,
    content_type: img.content_type,
  }));
  const meta = {
    routine_name:
      assetClass === "metals"
        ? "Metals Research"
        : assetClass === "quantum"
          ? "Quantum Research"
          : "Wicked Research",
    agent: "claude-mcp",
    asset_class: assetClass,
  };
  const runAt = new Date();

  // Upsert by composite (ticker, scan_day). Drizzle's onConflictDoUpdate
  // expects a unique target — we have research_posts_ticker_day_idx.
  const [row] = await db
    .insert(researchPosts)
    .values({
      ticker,
      scanDay,
      title,
      headline,
      bodyMd,
      images,
      assetClass,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: [researchPosts.ticker, researchPosts.scanDay],
      set: {
        title,
        headline,
        bodyMd,
        images,
        assetClass,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: researchPosts.id,
      ticker: researchPosts.ticker,
      scanDay: researchPosts.scanDay,
    });
  const url =
    assetClass === "metals"
      ? `/research/metals/${row.scanDay}/${row.ticker}`
      : assetClass === "quantum"
        ? `/research/quantum/${row.scanDay}/${row.ticker}`
        : `/research/${row.scanDay}/${row.ticker}`;
  return {
    url,
    ticker: row.ticker,
    scan_day: row.scanDay,
    images_count: images.length,
    body_chars: bodyMd.length,
  };
}

// ----------- Tradier passthrough helpers ---------------------------------

interface FetchQuoteArgs {
  tickers: string[];
}

interface QuoteOut {
  ticker: string;
  last?: number;
  bid?: number;
  ask?: number;
  prev_close?: number;
  change?: number;
  change_pct?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  description?: string;
  source: string;
  error?: string;
}

async function fetchQuotes(args: FetchQuoteArgs): Promise<QuoteOut[]> {
  const requested = (args.tickers ?? [])
    .map((t) => String(t || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
  if (requested.length === 0) return [];
  const symbols = requested.map((t) => Tradier.tradierSymbol(t));
  let quotes: Tradier.TradierQuoteFull[] = [];
  try {
    quotes = await Tradier.getQuotes(symbols);
  } catch (err) {
    return requested.map((ticker) => ({
      ticker,
      source: "Tradier (unavailable)",
      error: err instanceof Error ? err.message : String(err),
    }));
  }
  const bySym = new Map<string, Tradier.TradierQuoteFull>();
  for (const q of quotes) bySym.set(q.symbol.toUpperCase(), q);
  return requested.map((ticker) => {
    const q = bySym.get(Tradier.tradierSymbol(ticker).toUpperCase());
    if (!q) return { ticker, source: "Tradier (no data)" };
    return {
      ticker,
      last: q.last,
      bid: q.bid,
      ask: q.ask,
      prev_close: q.prevclose,
      change: q.change,
      change_pct: q.change_percentage,
      volume: q.volume,
      high: q.high,
      low: q.low,
      open: q.open,
      description: q.description,
      source: "Tradier",
    };
  });
}

interface FetchOptionContractArgs {
  ticker: string;
  expiry: string;
  strike: number;
  right: "call" | "put";
}

async function fetchOptionContract(args: FetchOptionContractArgs): Promise<Record<string, unknown>> {
  const root = String(args.ticker || "").trim().toUpperCase();
  if (!root) throw new Error("ticker required");
  const occ = Tradier.buildOccSymbol({
    root,
    expiry: args.expiry,
    right: args.right,
    strike: Number(args.strike),
  });
  const q = await Tradier.getOptionQuote(occ);
  if (!q) {
    return {
      ticker: root,
      occ_symbol: occ,
      source: "Tradier (no data)",
    };
  }
  return {
    ticker: root,
    occ_symbol: occ,
    expiry: args.expiry,
    strike: Number(args.strike),
    right: args.right,
    last: q.last,
    bid: q.bid,
    ask: q.ask,
    mid: q.bid != null && q.ask != null ? Math.round(((q.bid + q.ask) / 2) * 100) / 100 : undefined,
    volume: q.volume,
    open_interest: q.open_interest,
    iv: q.greeks?.mid_iv,
    iv_bid: q.greeks?.bid_iv,
    iv_ask: q.greeks?.ask_iv,
    delta: q.greeks?.delta,
    gamma: q.greeks?.gamma,
    theta: q.greeks?.theta,
    vega: q.greeks?.vega,
    rho: q.greeks?.rho,
    source: "Tradier",
  };
}

interface FetchBarsArgs {
  ticker: string;
  kind: "daily" | "intraday";
  days?: number;
  start?: string;
  end?: string;
  interval?: "1min" | "5min" | "15min";
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;

function validateDateLike(value: string, allowDateTime: boolean, field: string): string {
  const v = value.trim().replace("T", " ");
  if (DATE_ONLY_RE.test(v)) return v;
  if (allowDateTime && DATETIME_RE.test(v)) return v;
  throw new Error(`bad ${field} value: ${value}`);
}

async function fetchBars(args: FetchBarsArgs): Promise<Record<string, unknown>> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const symbol = Tradier.tradierSymbol(ticker);

  if (args.kind === "daily") {
    let start: string;
    let end: string;
    let useDaysSlice = false;
    let daysSliceN = 0;

    if (args.start) {
      // Explicit range mode (full historical access — no cap).
      start = validateDateLike(args.start, false, "start");
      end = args.end ? validateDateLike(args.end, false, "end") : isoDateNDaysAgo(0);
    } else {
      // Lookback mode — preserves prior behavior. No upper cap; default 20.
      const days = Math.max(args.days ?? 20, 1);
      // Pad calendar window to cover weekends/holidays.
      start = isoDateNDaysAgo(Math.ceil(days * 1.6) + 5);
      end = args.end ? validateDateLike(args.end, false, "end") : isoDateNDaysAgo(0);
      useDaysSlice = true;
      daysSliceN = days;
    }

    const bars = await Tradier.getDailyHistory(symbol, start, end);
    const sliced = useDaysSlice ? bars.slice(-daysSliceN) : bars;
    return {
      ticker,
      kind: "daily",
      start,
      end,
      bars: sliced.map((b) => ({
        date: b.date ?? b.time?.slice(0, 10),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      source: "Tradier",
    };
  }

  // Intraday.
  const interval = args.interval ?? "5min";
  let start: string;
  let end: string;
  if (args.start) {
    const s = validateDateLike(args.start, true, "start");
    start = DATE_ONLY_RE.test(s) ? `${s} 04:00` : s.slice(0, 16);
    if (args.end) {
      const e = validateDateLike(args.end, true, "end");
      end = DATE_ONLY_RE.test(e) ? `${e} 20:00` : e.slice(0, 16);
    } else {
      // No explicit end: cap at session close of the start date.
      const day = s.slice(0, 10);
      end = `${day} 20:00`;
    }
  } else {
    const today = nyTradingDay();
    start = `${today} 04:00`;
    end = `${today} 20:00`;
  }
  const bars = await Tradier.getIntradayBars(symbol, interval, start, end);
  return {
    ticker,
    kind: "intraday",
    interval,
    start,
    end,
    bars: bars.map((b) => ({
      time: b.time ?? b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      vwap: b.vwap,
    })),
    source: "Tradier",
  };
}

// ----------- max-pain helpers --------------------------------------------

interface MaxPainArgs {
  title?: string;
  body_md?: string;
  tickers?: MaxPainTicker[];
  alerts?: MaxPainAlert[];
  scan_day?: string;
  append?: boolean;
}

function mergeTickers(prev: MaxPainTicker[], next: MaxPainTicker[]): MaxPainTicker[] {
  const map = new Map<string, MaxPainTicker>();
  for (const t of prev) map.set(t.ticker.toUpperCase(), t);
  for (const t of next) map.set(t.ticker.toUpperCase(), { ...t, ticker: t.ticker.toUpperCase() });
  return Array.from(map.values());
}

async function publishMaxPain(args: MaxPainArgs): Promise<{
  url: string;
  scan_day: string;
  mode: string;
  tickers_count: number;
  alerts_count: number;
}> {
  const scanDay = args.scan_day || nyTradingDay();
  const meta = { routine_name: "Max Pain Scanner", agent: "claude-mcp" };
  const incomingTickers: MaxPainTicker[] = (args.tickers ?? []).map((t) => ({
    ...t,
    ticker: t.ticker.toUpperCase(),
  }));
  const incomingAlerts: MaxPainAlert[] = (args.alerts ?? []).map((a) => ({
    ...a,
    id: a.id ?? crypto.randomUUID(),
    ticker: a.ticker.toUpperCase(),
    acknowledged: a.acknowledged ?? false,
  }));

  if (args.append === true) {
    const existing = await db
      .select()
      .from(maxPainPosts)
      .where(eq(maxPainPosts.scanDay, scanDay))
      .limit(1);
    if (existing[0]) {
      const mergedTickers = mergeTickers(existing[0].tickers as MaxPainTicker[], incomingTickers);
      const mergedAlerts = [...(existing[0].alerts as MaxPainAlert[]), ...incomingAlerts];
      const mergedBody = args.body_md
        ? (existing[0].bodyMd ? `${existing[0].bodyMd}\n\n${args.body_md}` : args.body_md)
        : existing[0].bodyMd;
      const mergedTitle = args.title || existing[0].title || `Max Pain Scan — ${scanDay}`;
      const [row] = await db
        .update(maxPainPosts)
        .set({
          title: mergedTitle,
          bodyMd: mergedBody,
          tickers: mergedTickers,
          alerts: mergedAlerts,
          runAt: existing[0].runAt ?? new Date(),
          meta,
          updatedAt: sql`now()`,
        })
        .where(eq(maxPainPosts.scanDay, scanDay))
        .returning({ id: maxPainPosts.id, scanDay: maxPainPosts.scanDay });
      return {
        url: `/maxpain/${row.scanDay}`,
        scan_day: row.scanDay,
        mode: "append",
        tickers_count: mergedTickers.length,
        alerts_count: mergedAlerts.length,
      };
    }
    // Fall through to create.
  }

  const title = args.title || `Max Pain Scan — ${scanDay}`;
  const [row] = await db
    .insert(maxPainPosts)
    .values({
      scanDay,
      title,
      bodyMd: args.body_md ?? "",
      tickers: incomingTickers,
      alerts: incomingAlerts,
      runAt: new Date(),
      meta,
    })
    .onConflictDoUpdate({
      target: maxPainPosts.scanDay,
      set: {
        title,
        bodyMd: args.body_md ?? "",
        tickers: incomingTickers,
        alerts: incomingAlerts,
        runAt: new Date(),
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: maxPainPosts.id, scanDay: maxPainPosts.scanDay });
  return {
    url: `/maxpain/${row.scanDay}`,
    scan_day: row.scanDay,
    mode: args.append === true ? "append-create" : "replace",
    tickers_count: incomingTickers.length,
    alerts_count: incomingAlerts.length,
  };
}

async function getMaxPainYesterday(): Promise<{
  scan_day: string;
  tickers: MaxPainTicker[];
  alerts: MaxPainAlert[];
} | null> {
  const today = nyTradingDay();
  const [row] = await db
    .select({
      scanDay: maxPainPosts.scanDay,
      tickers: maxPainPosts.tickers,
      alerts: maxPainPosts.alerts,
    })
    .from(maxPainPosts)
    .where(lt(maxPainPosts.scanDay, today))
    .orderBy(desc(maxPainPosts.scanDay))
    .limit(1);
  if (!row) return null;
  return {
    scan_day: row.scanDay,
    tickers: row.tickers as MaxPainTicker[],
    alerts: row.alerts as MaxPainAlert[],
  };
}

// ----------- crypto helpers (research routine) ---------------------------

interface FetchCryptoQuoteArgs {
  tickers?: string[];
}

/** External USDT pairs that aren't on the crypto radar watchlist but
 *  the MCP fetch tools must still allow — currently just XAUTUSDT
 *  (Tether Gold), needed by the Sunday metals research routine. */
const EXTERNAL_FETCH_OK = new Set(["XAUTUSDT"]);

async function fetchCryptoQuoteForRoutine(args: FetchCryptoQuoteArgs): Promise<unknown> {
  const requested = (args.tickers ?? CRYPTO_TICKERS as readonly string[])
    .map((t) => String(t).trim().toUpperCase());
  // Split: in-watchlist tickers come from the batched fetchCryptoQuotes
  // (single OKX round-trip for everything in CRYPTO_TICKERS); external
  // allowed tickers (XAUTUSDT) fetch directly via fetchFromOkx.
  const allowed = new Set(CRYPTO_TICKERS as readonly string[]);
  const inWatch = requested.filter((t) => allowed.has(t));
  const external = requested.filter((t) => !allowed.has(t) && EXTERNAL_FETCH_OK.has(t));
  const [batch, ...externals] = await Promise.all([
    inWatch.length ? fetchCryptoQuotes() : Promise.resolve([] as Awaited<ReturnType<typeof fetchCryptoQuotes>>),
    ...external.map(async (t) => ({ ticker: t, quote: await fetchFromOkx(t) })),
  ]);
  const externalByTicker = new Map(
    externals.map((e) => [e.ticker, e.quote]),
  );
  return requested.map((ticker) => {
    if (allowed.has(ticker)) {
      const q = batch.find((qq) => qq.ticker === ticker);
      return {
        ticker,
        last: q?.usd ?? null,
        change_pct_24h: q?.change24h ?? null,
        volume_usd_24h: q?.vol24h ?? null,
        source: "OKX",
      };
    }
    if (EXTERNAL_FETCH_OK.has(ticker)) {
      const q = externalByTicker.get(ticker);
      const last = q?.last ?? null;
      const open24h = q?.open24h ?? null;
      const changePct =
        last != null && open24h != null && open24h > 0
          ? ((last - open24h) / open24h) * 100
          : null;
      return {
        ticker,
        last,
        change_pct_24h: changePct,
        volume_usd_24h: q?.volUsd ?? null,
        source: "OKX",
      };
    }
    return { ticker, source: "rejected (not in watchlist or external allowlist)" };
  });
}

interface FetchCryptoBarsArgs {
  symbol: string;
  interval: CryptoInterval;
  limit?: number;
}

async function fetchCryptoBarsForRoutine(args: FetchCryptoBarsArgs): Promise<unknown> {
  const symbol = String(args.symbol || "").trim().toUpperCase();
  if (!symbol) throw new Error("symbol required");
  // Reject symbols that aren't on the radar watchlist OR on the
  // external-allowed list (currently just XAUTUSDT for metals research).
  const inWatch = CRYPTO_TICKERS.includes(symbol as CryptoTicker);
  if (!inWatch && !EXTERNAL_FETCH_OK.has(symbol)) {
    throw new Error(
      `symbol '${symbol}' is not in the crypto watchlist or external allowlist (XAUTUSDT)`,
    );
  }
  const interval = args.interval;
  if (!interval) throw new Error("interval required");
  const limit = typeof args.limit === "number" ? args.limit : 200;
  const bars = await fetchCryptoKlines(symbol, interval, limit);
  return {
    symbol,
    interval,
    count: bars.length,
    bars,
    source: "OKX",
  };
}

interface PublishCryptoResearchArgs {
  title: string;
  headline?: string;
  body_md: string;
  trades?: CryptoTrade[];
  scan_day?: string;
}

async function publishCryptoResearch(args: PublishCryptoResearchArgs): Promise<{
  url: string;
  scan_day: string;
  trades_count: number;
  body_chars: number;
}> {
  const scanDay = args.scan_day || nyTradingDay();
  const title = String(args.title || "").trim() || `Crypto Research — ${scanDay}`;
  const bodyMd = String(args.body_md || "");
  const headline = (args.headline ?? deriveHeadline(bodyMd)).slice(0, 240);
  const trades: CryptoTrade[] = (args.trades ?? []).map((t) => ({
    ticker: String(t.ticker || "").trim().toUpperCase(),
    bias: t.bias,
    entry_zone: t.entry_zone,
    entry_trigger: t.entry_trigger,
    target1: t.target1,
    target2: t.target2,
    stop: t.stop,
    time_horizon: t.time_horizon,
    rationale: t.rationale,
  }));
  const meta = { routine_name: "Crypto Research", agent: "claude-mcp" };
  const runAt = new Date();

  const [row] = await db
    .insert(cryptoPosts)
    .values({
      scanDay,
      title,
      headline,
      bodyMd,
      trades,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: cryptoPosts.scanDay,
      set: {
        title,
        headline,
        bodyMd,
        trades,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: cryptoPosts.id, scanDay: cryptoPosts.scanDay });

  return {
    url: `/crypto/research/${row.scanDay}`,
    scan_day: row.scanDay,
    trades_count: trades.length,
    body_chars: bodyMd.length,
  };
}

interface PublishCryptoWeeklyResearchArgs {
  ticker: string;
  scan_day?: string;
  title: string;
  headline?: string;
  body_md: string;
  images?: ResearchImage[];
}

async function publishCryptoWeeklyResearch(args: PublishCryptoWeeklyResearchArgs): Promise<{
  url: string;
  ticker: string;
  scan_day: string;
  images_count: number;
  body_chars: number;
}> {
  const ticker = String(args.ticker || "").trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const scanDay = args.scan_day || nyTradingDay();
  const title = String(args.title || "").trim() || `${ticker} Weekly Research — ${scanDay}`;
  const bodyMd = String(args.body_md || "");
  const headline = (args.headline ?? deriveHeadline(bodyMd)).slice(0, 240);
  const images: ResearchImage[] = (args.images || []).map((img) => ({
    slot: String(img.slot || "image"),
    key: String(img.key || ""),
    url: String(img.url || ""),
    alt: img.alt,
    width: img.width,
    height: img.height,
    content_type: img.content_type,
  }));
  const meta = { routine_name: "Crypto Weekly Research", agent: "claude-mcp" };
  const runAt = new Date();

  const [row] = await db
    .insert(cryptoWeeklyResearchPosts)
    .values({
      ticker,
      scanDay,
      title,
      headline,
      bodyMd,
      images,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: [cryptoWeeklyResearchPosts.ticker, cryptoWeeklyResearchPosts.scanDay],
      set: {
        title,
        headline,
        bodyMd,
        images,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: cryptoWeeklyResearchPosts.id,
      ticker: cryptoWeeklyResearchPosts.ticker,
      scanDay: cryptoWeeklyResearchPosts.scanDay,
    });

  return {
    url: `/crypto/weekly/${row.scanDay}/${row.ticker}`,
    ticker: row.ticker,
    scan_day: row.scanDay,
    images_count: images.length,
    body_chars: bodyMd.length,
  };
}

// ----------- economic-calendar helper (weekly routine) -------------------

interface EconomicEventInput {
  title: string;
  country: string;
  event_time: string;
  importance: "low" | "medium" | "high";
  estimate?: number | null;
  prior?: number | null;
  actual?: number | null;
  unit?: string | null;
  description?: string | null;
  impact_text?: string | null;
  asset_tags?: string[];
}

interface PublishEconomicCalendarArgs {
  events: EconomicEventInput[];
}

function mondayOfDateString(d: Date): string {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const dow = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - ((dow + 6) % 7));
  return x.toISOString().slice(0, 10);
}

async function publishEconomicCalendar(args: PublishEconomicCalendarArgs): Promise<{
  inserted: number;
  updated: number;
  url: string;
}> {
  const events = args.events || [];
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("events array required and non-empty");
  }
  let inserted = 0;
  let updated = 0;

  for (const e of events) {
    if (!e.title || !e.country || !e.event_time) {
      throw new Error(`event missing required field: ${JSON.stringify(e).slice(0, 200)}`);
    }
    const country = e.country.toUpperCase();
    const eventTime = new Date(e.event_time);
    if (Number.isNaN(eventTime.getTime())) {
      throw new Error(`invalid event_time: ${e.event_time}`);
    }
    const externalId = `${country}|${e.title}|${eventTime.toISOString()}`;
    const weekOf = mondayOfDateString(eventTime);

    const existing = (
      await db
        .select({ id: economicEvents.id })
        .from(economicEvents)
        .where(eq(economicEvents.externalId, externalId))
        .limit(1)
    )[0];

    if (existing) {
      // Update — preserve prior commentary if the caller doesn't include
      // a new value for that field.
      const updates: Partial<typeof economicEvents.$inferInsert> = {
        importance: e.importance,
        weekOf,
        fetchedAt: new Date(),
        source: "claude_routine",
        raw: e as unknown as Record<string, unknown>,
      };
      if (e.actual != null) updates.actual = String(e.actual);
      if (e.estimate != null) updates.estimate = String(e.estimate);
      if (e.prior != null) updates.prior = String(e.prior);
      if (e.unit != null) updates.unit = e.unit;
      if (e.description != null) updates.description = e.description;
      if (e.impact_text != null) updates.impactText = e.impact_text;
      if (e.asset_tags && e.asset_tags.length > 0) updates.assetTags = e.asset_tags;
      await db.update(economicEvents).set(updates).where(eq(economicEvents.id, existing.id));
      updated += 1;
    } else {
      await db.insert(economicEvents).values({
        externalId,
        title: e.title,
        country,
        eventTime,
        importance: e.importance,
        actual: e.actual != null ? String(e.actual) : null,
        estimate: e.estimate != null ? String(e.estimate) : null,
        prior: e.prior != null ? String(e.prior) : null,
        unit: e.unit ?? null,
        description: e.description ?? null,
        impactText: e.impact_text ?? null,
        assetTags: e.asset_tags ?? [],
        source: "claude_routine",
        raw: e as unknown as Record<string, unknown>,
        weekOf,
        fetchedAt: new Date(),
      });
      inserted += 1;
    }
  }

  return { inserted, updated, url: "/calendar/economic" };
}

// ----------- institutional flow (weekly 13F scan) ------------------------

interface PublishInstitutionalArgs {
  scan_day?: string;
  summary?: string;
  methodology?: string;
  stocks: InstitutionalStock[];
  run_meta?: Record<string, unknown>;
}

async function getInstitutionalFundsList(): Promise<{
  funds: Array<{ name: string; cik: string; note: string | null; sortOrder: number }>;
  count: number;
}> {
  const rows = await db
    .select({
      name: institutionalFunds.name,
      cik: institutionalFunds.cik,
      note: institutionalFunds.note,
      sortOrder: institutionalFunds.sortOrder,
    })
    .from(institutionalFunds)
    .where(eq(institutionalFunds.enabled, true))
    .orderBy(asc(institutionalFunds.sortOrder), asc(institutionalFunds.name));
  return { funds: rows, count: rows.length };
}

async function publishInstitutionalResearch(args: PublishInstitutionalArgs): Promise<{
  id: string;
  scan_day: string;
  url: string;
  stocks: number;
}> {
  if (!Array.isArray(args.stocks)) {
    throw new Error("stocks must be an array (empty allowed when nothing qualifies)");
  }
  if (args.stocks.length > 10) {
    throw new Error(`stocks.length=${args.stocks.length} exceeds max of 10`);
  }
  for (const s of args.stocks) {
    if (!s.ticker || !s.companyName || !s.thesis) {
      throw new Error(`stock entry missing required fields: ${JSON.stringify(s).slice(0, 200)}`);
    }
    if (!Array.isArray(s.supportingFunds) || s.supportingFunds.length === 0) {
      throw new Error(`${s.ticker}: supportingFunds must be non-empty`);
    }
    if (!s.retailAttention) {
      throw new Error(`${s.ticker}: retailAttention block required`);
    }
  }

  const scanDay = args.scan_day || nyTradingDay();
  const runAt = new Date();
  const meta = args.run_meta ?? {};

  const [row] = await db
    .insert(institutionalPosts)
    .values({
      scanDay,
      summary: args.summary ?? "",
      methodology: args.methodology ?? "",
      stocks: args.stocks,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: institutionalPosts.scanDay,
      set: {
        summary: args.summary ?? "",
        methodology: args.methodology ?? "",
        stocks: args.stocks,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: institutionalPosts.id, scanDay: institutionalPosts.scanDay });

  return {
    id: row.id,
    scan_day: row.scanDay,
    url: "/research/institutional",
    stocks: args.stocks.length,
  };
}

// ----------- earnings whiplash (weekly post-earnings vol scan) -----------

interface PublishEarningsArgs {
  scan_day?: string;
  summary?: string;
  methodology?: string;
  stocks: EarningsStock[];
  run_meta?: Record<string, unknown>;
}

async function publishEarningsWhiplash(args: PublishEarningsArgs): Promise<{
  id: string;
  scan_day: string;
  url: string;
  stocks: number;
  flagged: number;
}> {
  if (!Array.isArray(args.stocks)) {
    throw new Error("stocks must be an array (empty allowed when nothing qualifies)");
  }
  if (args.stocks.length > 20) {
    throw new Error(`stocks.length=${args.stocks.length} exceeds max of 20`);
  }
  for (const s of args.stocks) {
    if (!s.ticker || !s.companyName || !s.earningsDate || !s.thesis) {
      throw new Error(`stock entry missing required fields: ${JSON.stringify(s).slice(0, 200)}`);
    }
    if (s.isFlagged && !s.flagReason) {
      throw new Error(`${s.ticker}: isFlagged=true but flagReason is empty`);
    }
  }
  const flaggedCount = args.stocks.filter((s) => s.isFlagged).length;
  if (flaggedCount > 5) {
    throw new Error(`too many flagged setups: ${flaggedCount} > 5. Routine asked for 3.`);
  }

  const scanDay = args.scan_day || nyTradingDay();
  const runAt = new Date();
  const meta = args.run_meta ?? {};

  const [row] = await db
    .insert(earningsPosts)
    .values({
      scanDay,
      summary: args.summary ?? "",
      methodology: args.methodology ?? "",
      stocks: args.stocks,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: earningsPosts.scanDay,
      set: {
        summary: args.summary ?? "",
        methodology: args.methodology ?? "",
        stocks: args.stocks,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: earningsPosts.id, scanDay: earningsPosts.scanDay });

  return {
    id: row.id,
    scan_day: row.scanDay,
    url: "/research/earnings",
    stocks: args.stocks.length,
    flagged: flaggedCount,
  };
}

// ----------- sector rotation (weekly leadership-flip scan) ---------------

interface PublishSectorRotationArgs {
  scan_day?: string;
  summary?: string;
  methodology?: string;
  sectors: SectorRotationSector[];
  run_meta?: Record<string, unknown>;
}

async function publishSectorRotation(args: PublishSectorRotationArgs): Promise<{
  id: string;
  scan_day: string;
  url: string;
  sectors: number;
  rotating: number;
}> {
  if (!Array.isArray(args.sectors)) {
    throw new Error("sectors must be an array");
  }
  if (args.sectors.length > 15) {
    throw new Error(`sectors.length=${args.sectors.length} exceeds max of 15`);
  }
  for (const s of args.sectors) {
    if (!s.sectorName || !s.sectorEtf || !s.thesis || !s.rotationDirection) {
      throw new Error(`sector entry missing required fields: ${JSON.stringify(s).slice(0, 200)}`);
    }
    if (s.isRotating && (!Array.isArray(s.topEtfs) || s.topEtfs.length === 0)) {
      throw new Error(`${s.sectorEtf}: isRotating=true requires topEtfs (got ${s.topEtfs?.length ?? 0})`);
    }
  }
  const rotatingCount = args.sectors.filter((s) => s.isRotating).length;

  const scanDay = args.scan_day || nyTradingDay();
  const runAt = new Date();
  const meta = args.run_meta ?? {};

  const [row] = await db
    .insert(sectorRotationPosts)
    .values({
      scanDay,
      summary: args.summary ?? "",
      methodology: args.methodology ?? "",
      sectors: args.sectors,
      runAt,
      meta,
    })
    .onConflictDoUpdate({
      target: sectorRotationPosts.scanDay,
      set: {
        summary: args.summary ?? "",
        methodology: args.methodology ?? "",
        sectors: args.sectors,
        runAt,
        meta,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: sectorRotationPosts.id, scanDay: sectorRotationPosts.scanDay });

  return {
    id: row.id,
    scan_day: row.scanDay,
    url: "/research/rotation",
    sectors: args.sectors.length,
    rotating: rotatingCount,
  };
}

// ----------- JSON-RPC dispatch -------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

async function dispatch(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "oliviatrades-publisher", version: "1.0.0" },
      capabilities: { tools: { listChanged: false } },
    };
  }
  if (method === "tools/list") {
    return { tools: TOOLS };
  }
  if (method === "tools/call") {
    const name = (params?.name as string) || "";
    const args = (params?.arguments as Record<string, unknown>) || {};
    if (name === "publish_dte_research") {
      try {
        const out = await publishDte(args as unknown as DteArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published 0DTE chunk (${out.mode}) to ${out.url} for trading day ${out.trading_day}, scan_kind=${out.scan_kind}. body=${out.body_chars} chars, ${out.trades_count} trades parsed.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_dte_research failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_dte_post") {
      try {
        const a = args as { scan_kind?: string; trading_day?: string };
        if (
          !a.scan_kind ||
          (a.scan_kind !== "premarket" &&
            a.scan_kind !== "market_open" &&
            a.scan_kind !== "analysis" &&
            a.scan_kind !== "settlement")
        ) {
          return {
            content: [
              {
                type: "text",
                text: "scan_kind is required and must be one of: premarket, market_open, analysis, settlement",
              },
            ],
            isError: true,
          };
        }
        const tradingDay = a.trading_day || nyTradingDay();
        const [row] = await db
          .select()
          .from(posts)
          .where(and(eq(posts.tradingDay, tradingDay), eq(posts.scanKind, a.scan_kind)))
          .limit(1);
        const payload = row
          ? {
              found: true,
              trading_day: row.tradingDay,
              scan_kind: row.scanKind,
              title: row.title,
              body_md: row.bodyMd,
              trades: row.trades,
              sentiment: row.sentiment,
              bias: row.bias,
              run_at: row.runAt ? row.runAt.toISOString() : null,
              tickers: row.tickers,
            }
          : { found: false, trading_day: tradingDay, scan_kind: a.scan_kind };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_dte_post failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "compute_settlement") {
      try {
        const a = args as { trading_day?: string };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [
              { type: "text", text: "trading_day must be YYYY-MM-DD" },
            ],
            isError: true,
          };
        }
        const { getScansForDay } = await import("@/lib/scans");
        const { mergeDayScans } = await import("@/lib/merge-trades");
        const { settleAllTrades } = await import("@/lib/settlement-engine");
        const scans = await getScansForDay(tradingDay);
        if (!scans.premarket) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  found: false,
                  trading_day: tradingDay,
                  reason: "no premarket scan for this day — nothing to settle",
                }),
              },
            ],
            isError: false,
          };
        }
        const { trades } = mergeDayScans({
          premarket: scans.premarket,
          marketOpen: scans.marketOpen,
          analysis: scans.analysis,
          settlement: null,
        });
        const livePlan = trades.filter((t) => t.status !== "killed");
        const verdicts = await settleAllTrades(livePlan, tradingDay);
        const payload = {
          found: true,
          trading_day: tradingDay,
          plan_count: trades.length,
          live_count: livePlan.length,
          killed_count: trades.length - livePlan.length,
          verdicts: verdicts.map((v, i) => ({
            ...v,
            trade: {
              ticker: livePlan[i].ticker,
              direction: livePlan[i].direction,
              strike: livePlan[i].strike,
              expiry: livePlan[i].expiry,
              entry_zone: livePlan[i].entry_zone,
              entry_trigger: livePlan[i].entry_trigger,
              target1: livePlan[i].target1,
              target2: livePlan[i].target2,
              stop: livePlan[i].stop,
              time_stop: livePlan[i].time_stop,
              rationale: livePlan[i].rationale,
              grade: livePlan[i].grade,
              rank: livePlan[i].rank,
              source: livePlan[i].source,
              status: livePlan[i].status,
            },
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `compute_settlement failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_briefing_script") {
      try {
        const a = args as {
          trading_day?: string;
          script?: string;
          setting_prompt?: string;
          tickers?: unknown;
        };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const script = (a.script ?? "").trim();
        const settingPrompt = (a.setting_prompt ?? "").trim();
        if (!script) {
          return {
            content: [{ type: "text", text: "script is required" }],
            isError: true,
          };
        }
        if (!settingPrompt) {
          return {
            content: [{ type: "text", text: "setting_prompt is required" }],
            isError: true,
          };
        }
        // Enforce the 30-45 word budget. ≈15 sec at conversational pace.
        const wordCount = script.split(/\s+/).filter(Boolean).length;
        if (wordCount < 20 || wordCount > 60) {
          return {
            content: [
              {
                type: "text",
                text: `script word count is ${wordCount}; budget is 30-45 (hard bounds 20-60). Tighten or expand and retry.`,
              },
            ],
            isError: true,
          };
        }
        // Normalize tickers: uppercase, trim, dedupe (first-occurrence order),
        // validate symbol shape. These drive the /morning-brief calls panel.
        if (!Array.isArray(a.tickers)) {
          return {
            content: [
              {
                type: "text",
                text: "tickers must be an array of the symbols named in the script (e.g. ['QCOM','INTC','MU'])",
              },
            ],
            isError: true,
          };
        }
        const seen = new Set<string>();
        const tickers: string[] = [];
        for (const raw of a.tickers) {
          if (typeof raw !== "string") continue;
          const sym = raw.trim().toUpperCase();
          if (!/^[A-Z0-9.\-]{1,6}$/.test(sym)) {
            return {
              content: [
                {
                  type: "text",
                  text: `invalid ticker "${raw}" — must be 1-6 uppercase letters/digits (dots/dashes allowed)`,
                },
              ],
              isError: true,
            };
          }
          if (!seen.has(sym)) {
            seen.add(sym);
            tickers.push(sym);
          }
        }
        const { briefings } = await import("@/lib/db/schema");
        const meta = {
          routine_name: "0DTE Daily Briefing — Script Writer",
          agent: "claude-mcp",
          word_count: wordCount,
          ticker_count: tickers.length,
        };
        const [row] = await db
          .insert(briefings)
          .values({
            tradingDay,
            script,
            settingPrompt,
            tickers,
            status: "scripted",
            meta,
          })
          .onConflictDoUpdate({
            target: briefings.tradingDay,
            set: {
              script,
              settingPrompt,
              tickers,
              status: "scripted",
              meta,
              updatedAt: sql`now()`,
            },
          })
          .returning({
            id: briefings.id,
            tradingDay: briefings.tradingDay,
            status: briefings.status,
          });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                id: row.id,
                trading_day: row.tradingDay,
                status: row.status,
                word_count: wordCount,
                tickers,
                admin_url: "/admin/briefings",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_briefing_script failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "pick_daily_briefing_setting_prompt") {
      // Locked rotation of 10 setting prompts for the daily briefing video.
      // Each prompt is EXPLICIT about cup placement (`NO cup on the desk`,
      // `held up near her chin`, etc) so Higgsfield Soul stops generating
      // double-cup scenes. 6 of 10 are beverage-free for variety. Edit only
      // with intent — also update examples/daily-briefing-setting-prompts.md
      // so the docs stay in sync.
      const DAILY_BRIEFING_SETTING_PROMPTS = [
        "Sun-drenched home office, small espresso cup held up near her shoulder, NO cup on the desk, crisp white linen shirt, confident upright posture, easy morning energy, soft smile",
        "Bright morning home office, hands resting on the desk gesturing as she speaks, NO coffee cup in the frame, white linen shirt with sleeves rolled, confident posture, warm professional energy",
        "Cozy kitchen corner at sunrise, mug of tea on the counter beside her, hands free and gesturing, soft cream sweater, easy confident smile, warm morning glow",
        "Modern home office with floor-to-ceiling windows, leaning slightly forward in her chair, hands clasped on the desk, NO beverage in shot, structured white blouse, polished morning energy",
        "Sunlit kitchen island, glass of water in hand, white linen shirt, easy confident posture, soft morning light from the side, warm friendly smile",
        "Home office at golden hour, sketchpad and pen in front of her on the desk, hands gesturing as she speaks, NO cup anywhere, navy cashmere crewneck, focused upbeat energy",
        "Bright breakfast nook, half-eaten croissant on a small plate beside her, hands free and animated, oversized white button-up, easy magnetic smile, casual Monday energy",
        "Cozy home library corner, hardcover book closed on the desk, hands gesturing as she speaks, NO mug or cup visible, soft beige turtleneck, confident posture, warm intellectual energy",
        "Sunny home office, small cappuccino in hand held near her chin between sentences, NO additional cups on the desk, crisp white shirt, easy confident smile, bright morning vibe",
        "Minimalist home office at sunrise, laptop open in front of her, hands resting on the keyboard then gesturing, NO drinkware in frame, fitted white tee under an open blazer, polished upbeat morning energy",
      ];
      try {
        const a = args as { trading_day?: string; index?: number };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        let idx: number;
        if (typeof a.index === "number" && a.index >= 0 && a.index < DAILY_BRIEFING_SETTING_PROMPTS.length) {
          idx = Math.floor(a.index);
        } else {
          // day-of-year mod 10. Deterministic per date, no DB needed.
          const d = new Date(tradingDay + "T00:00:00Z");
          const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
          const dayOfYear = Math.floor((d.getTime() - start.getTime()) / (24 * 60 * 60_000));
          idx = ((dayOfYear % DAILY_BRIEFING_SETTING_PROMPTS.length) + DAILY_BRIEFING_SETTING_PROMPTS.length) %
            DAILY_BRIEFING_SETTING_PROMPTS.length;
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                trading_day: tradingDay,
                index: idx,
                prompt: DAILY_BRIEFING_SETTING_PROMPTS[idx],
                total: DAILY_BRIEFING_SETTING_PROMPTS.length,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `pick_daily_briefing_setting_prompt failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_briefing") {
      try {
        const a = args as { trading_day?: string };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { briefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(briefings)
          .where(eq(briefings.tradingDay, tradingDay))
          .limit(1);
        const payload = row
          ? {
              found: true,
              trading_day: row.tradingDay,
              script: row.script,
              setting_prompt: row.settingPrompt,
              status: row.status,
              youtube_video_id: row.youtubeVideoId,
              video_s3_key: row.videoS3Key,
              error_log: row.errorLog,
              posted_at: row.postedAt ? row.postedAt.toISOString() : null,
              created_at: row.createdAt.toISOString(),
            }
          : { found: false, trading_day: tradingDay };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `fetch_briefing failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "generate_voiceover_for_briefing") {
      try {
        const a = args as { trading_day?: string; voice_id?: string };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const voiceId = a.voice_id || process.env.BRIEFING_VOICE_ID;
        if (!voiceId) {
          return {
            content: [
              {
                type: "text",
                text:
                  "voice_id not provided and BRIEFING_VOICE_ID env var not set. Configure one before calling.",
              },
            ],
            isError: true,
          };
        }

        const { briefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(briefings)
          .where(eq(briefings.tradingDay, tradingDay))
          .limit(1);
        if (!row || !row.script) {
          return {
            content: [
              {
                type: "text",
                text: `no scripted briefing for ${tradingDay} — run the script writer first`,
              },
            ],
            isError: true,
          };
        }

        const { generateVoiceover, buildBriefingAudioKey } = await import(
          "@/lib/elevenlabs"
        );
        const { putObject } = await import("@/lib/s3");

        const tts = await generateVoiceover(row.script, { voiceId });
        const key = buildBriefingAudioKey(tradingDay);
        const upload = await putObject(key, tts.buffer, tts.mimeType);

        const appUrl = process.env.APP_URL || "https://www.oliviatrades.com";
        const audioUrl = `${appUrl}/api/briefings/audio/${tradingDay}`;
        const meta = {
          ...((row.meta as Record<string, unknown>) ?? {}),
          voiceover: {
            voice_id: voiceId,
            model_id: tts.modelId,
            char_count: tts.charCount,
            byte_size: upload.size,
            generated_at: new Date().toISOString(),
          },
        };
        await db
          .update(briefings)
          .set({ status: "generating", meta, updatedAt: sql`now()` })
          .where(eq(briefings.tradingDay, tradingDay));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: tradingDay,
                audio_url: audioUrl,
                voice_id: voiceId,
                model_id: tts.modelId,
                char_count: tts.charCount,
                byte_size: upload.size,
                next_step:
                  "Pass `audio_url` as the value for medias[].role='audio' in Higgsfield generate_video.",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `generate_voiceover_for_briefing failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "bridge_voiceover_to_higgsfield") {
      try {
        const a = args as {
          trading_day?: string;
          higgsfield_upload_url?: string;
          content_type?: string;
        };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        if (!a.higgsfield_upload_url || !/^https:\/\//i.test(a.higgsfield_upload_url)) {
          return {
            content: [
              {
                type: "text",
                text: "higgsfield_upload_url is required and must be an https URL",
              },
            ],
            isError: true,
          };
        }
        const contentType = a.content_type || "audio/mpeg";

        const { getObjectStream } = await import("@/lib/s3");
        const { buildBriefingAudioKey } = await import("@/lib/elevenlabs");
        const obj = await getObjectStream(buildBriefingAudioKey(tradingDay));
        if (!obj) {
          return {
            content: [
              {
                type: "text",
                text: `no audio in bucket for ${tradingDay} — run generate_voiceover_for_briefing first`,
              },
            ],
            isError: true,
          };
        }
        // The stream type is web ReadableStream; collect to a Buffer for PUT.
        const chunks: Uint8Array[] = [];
        const reader = obj.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

        const headers: Record<string, string> = { "Content-Type": contentType };
        if (buffer.length > 0) headers["Content-Length"] = String(buffer.length);
        const putRes = await fetch(a.higgsfield_upload_url, {
          method: "PUT",
          headers,
          body: new Uint8Array(buffer),
        });
        if (!putRes.ok) {
          const text = await putRes.text().catch(() => "");
          return {
            content: [
              {
                type: "text",
                text: `Higgsfield PUT failed: ${putRes.status} ${putRes.statusText} ${text.slice(0, 240)}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: tradingDay,
                bytes_put: buffer.length,
                content_type: contentType,
                next_step:
                  "Now call Higgsfield `media_confirm` with the media_id and type='audio', then reference the media_id in generate_video medias[audio].",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `bridge_voiceover_to_higgsfield failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "submit_briefing_video_via_hedra") {
      try {
        const a = args as {
          trading_day?: string;
          soul_image_url?: string;
          text_prompt?: string;
          duration_ms?: number;
        };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        if (!a.soul_image_url || !/^https:\/\//i.test(a.soul_image_url)) {
          return {
            content: [
              {
                type: "text",
                text: "soul_image_url is required and must be an https URL",
              },
            ],
            isError: true,
          };
        }

        const { getObjectStream } = await import("@/lib/s3");
        const { buildBriefingAudioKey } = await import("@/lib/elevenlabs");
        const audioObj = await getObjectStream(buildBriefingAudioKey(tradingDay));
        if (!audioObj) {
          return {
            content: [
              {
                type: "text",
                text: `no audio in bucket for ${tradingDay} — run generate_voiceover_for_briefing first`,
              },
            ],
            isError: true,
          };
        }
        const audioChunks: Uint8Array[] = [];
        const audioReader = audioObj.body.getReader();
        for (;;) {
          const { value, done } = await audioReader.read();
          if (done) break;
          if (value) audioChunks.push(value);
        }
        const audioBytes = Buffer.concat(audioChunks.map((c) => Buffer.from(c)));

        const imgRes = await fetch(a.soul_image_url);
        if (!imgRes.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch Soul image: ${imgRes.status} ${imgRes.statusText}`,
              },
            ],
            isError: true,
          };
        }
        const imageBytes = Buffer.from(await imgRes.arrayBuffer());
        const imageContentType = imgRes.headers.get("content-type") || "image/png";

        const { submitHedraGeneration } = await import("@/lib/hedra");
        const submission = await submitHedraGeneration({
          imageBytes,
          imageContentType,
          audioBytes,
          audioContentType: audioObj.contentType || "audio/mpeg",
          textPrompt: a.text_prompt,
          durationMs: a.duration_ms ?? 20000,
          aspectRatio: "9:16",
          resolution: "720p",
        });

        // Persist generation_id to the briefing's meta so poll can find it
        // and orphan jobs can be recovered.
        const { briefings } = await import("@/lib/db/schema");
        const [existing] = await db
          .select()
          .from(briefings)
          .where(eq(briefings.tradingDay, tradingDay))
          .limit(1);
        const meta = {
          ...((existing?.meta as Record<string, unknown>) ?? {}),
          hedra: {
            generation_id: submission.generationId,
            image_asset_id: submission.imageAssetId,
            audio_asset_id: submission.audioAssetId,
            submitted_at: new Date().toISOString(),
            submit_elapsed_ms: submission.elapsedMs,
          },
        };
        // Clear the prior video_s3_key so the poll handler doesn't return
        // a cached URL from a previous generation. The poll cache is
        // keyed on the row having videoS3Key set — re-submit invalidates.
        await db
          .update(briefings)
          .set({
            status: "generating",
            videoS3Key: null,
            // Capture the Higgsfield Soul PNG URL as the briefing's poster.
            // Surfaces on the dashboard hero + anywhere else that wants a
            // thumbnail. Lives behind a Higgsfield-hosted URL so it's stable
            // across the briefing's lifetime.
            thumbnailUrl: a.soul_image_url,
            meta,
            updatedAt: sql`now()`,
          })
          .where(eq(briefings.tradingDay, tradingDay));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: tradingDay,
                hedra_generation_id: submission.generationId,
                hedra_image_asset_id: submission.imageAssetId,
                hedra_audio_asset_id: submission.audioAssetId,
                submit_elapsed_ms: submission.elapsedMs,
                next_step:
                  "Call poll_briefing_video_hedra every ~15-30s until status='complete' (typically 30-90s total).",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `submit_briefing_video_via_hedra failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "poll_briefing_video_hedra") {
      try {
        const a = args as { trading_day?: string; force_remirror?: boolean };
        const tradingDay = a.trading_day || nyTradingDay();
        const forceRemirror = a.force_remirror === true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { briefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(briefings)
          .where(eq(briefings.tradingDay, tradingDay))
          .limit(1);
        if (!row) {
          return {
            content: [
              { type: "text", text: `no briefing row for ${tradingDay}` },
            ],
            isError: true,
          };
        }

        const appUrl = process.env.APP_URL || "https://www.oliviatrades.com";
        const meta = (row.meta as Record<string, unknown>) ?? {};
        const hedraMeta = (meta.hedra as Record<string, unknown>) ?? {};
        const generationId = hedraMeta.generation_id as string | undefined;
        const mirroredGenerationId = hedraMeta.mirrored_generation_id as
          | string
          | undefined;

        // Cache hit: only short-circuit when the row's stored video came from
        // the CURRENT generation_id. A re-submit changes generation_id and
        // invalidates the cache so we poll Hedra for the new one.
        // `force_remirror` bypasses the cache so we can re-pull the existing
        // Hedra generation (no new generation cost) when the outro pipeline
        // had a bug last time and needs to re-run on the same source clip.
        if (
          !forceRemirror &&
          row.videoS3Key &&
          row.videoS3Key.startsWith(appUrl) &&
          generationId &&
          mirroredGenerationId === generationId
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  trading_day: tradingDay,
                  status: "complete",
                  video_url: row.videoS3Key,
                  cached: true,
                  hedra_generation_id: generationId,
                }),
              },
            ],
            isError: false,
          };
        }
        if (!generationId) {
          return {
            content: [
              {
                type: "text",
                text: `no hedra.generation_id on briefing ${tradingDay} — run submit_briefing_video_via_hedra first`,
              },
            ],
            isError: true,
          };
        }

        const { checkHedraStatus } = await import("@/lib/hedra");
        const status = await checkHedraStatus(generationId);

        if (status.status === "in_progress") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  trading_day: tradingDay,
                  status: "in_progress",
                  raw_status: status.rawStatus,
                  progress: status.progress,
                  eta_sec: status.etaSec,
                  hedra_generation_id: generationId,
                  next_step: "Call again in ~15-30 seconds.",
                }),
              },
            ],
            isError: false,
          };
        }

        if (status.status === "failed") {
          // Append to error_log + reset status so the next pipeline run can retry.
          const errorLog = Array.isArray(row.errorLog) ? row.errorLog : [];
          errorLog.push({
            at: new Date().toISOString(),
            step: "generating",
            message: `Hedra generation failed: ${status.errorMessage ?? status.rawStatus}`,
            detail: { hedra_generation_id: generationId, raw_status: status.rawStatus },
          });
          await db
            .update(briefings)
            .set({ status: "failed", errorLog, updatedAt: sql`now()` })
            .where(eq(briefings.tradingDay, tradingDay));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  trading_day: tradingDay,
                  status: "failed",
                  raw_status: status.rawStatus,
                  error_message: status.errorMessage,
                  hedra_generation_id: generationId,
                }),
              },
            ],
            isError: false,
          };
        }

        // status === "complete" and we don't yet have a mirrored copy.
        if (!status.videoUrl) {
          return {
            content: [
              {
                type: "text",
                text: `Hedra reports complete but no video URL available`,
              },
            ],
            isError: true,
          };
        }
        const videoRes = await fetch(status.videoUrl);
        if (!videoRes.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch finished Hedra video: ${videoRes.status} ${videoRes.statusText}`,
              },
            ],
            isError: true,
          };
        }
        const videoBuf = Buffer.from(await videoRes.arrayBuffer());

        const { putObject } = await import("@/lib/s3");
        const { buildBriefingVideoKey, applyOutroCard } = await import(
          "@/lib/video-mux"
        );
        const { buildBriefingAudioKey } = await import("@/lib/elevenlabs");
        // Replace the idle tail with the branded OliviaTrades.com end card.
        // Hedra renders a fixed 20s; once the narration ends we cross-fade to
        // the card so the clip never shows Olivia idling at camera. Failure
        // (ffmpeg crash, missing audio, etc.) must not block publication —
        // fall back to mirroring the raw clip.
        let outputBuf: Buffer = videoBuf;
        try {
          outputBuf = await applyOutroCard(videoBuf, buildBriefingAudioKey(tradingDay));
        } catch (outroErr) {
          console.error("[hedra-poll] outro card failed, mirroring raw clip", outroErr);
        }
        const videoKey = buildBriefingVideoKey(tradingDay);
        const upload = await putObject(
          videoKey,
          new Uint8Array(outputBuf),
          "video/mp4",
        );

        const finalVideoUrl = `${appUrl}/api/briefings/video/${tradingDay}`;

        // Tag the meta with which generation we just mirrored, so a future
        // re-submit (different generation_id) correctly invalidates the
        // cache and re-polls Hedra for the new render.
        const updatedMeta = {
          ...meta,
          hedra: {
            ...hedraMeta,
            mirrored_generation_id: generationId,
            mirrored_at: new Date().toISOString(),
            mirrored_bytes: upload.size,
          },
        };
        // First-time render flips each platform's publish state to
        // pending_review so the admin sees them in the approval queue. We
        // never overwrite a state that's already been touched by the admin
        // or by a publish routine — only null → pending_review.
        const platformInit: Record<string, unknown> = {};
        if (row.ytStatus == null) platformInit.ytStatus = "pending_review";
        if (row.ttStatus == null) platformInit.ttStatus = "pending_review";
        await db
          .update(briefings)
          .set({
            status: "pending_upload",
            videoS3Key: finalVideoUrl,
            higgsfieldJobId: generationId, // re-purposed: external job id
            meta: updatedMeta,
            ...platformInit,
            updatedAt: sql`now()`,
          })
          .where(eq(briefings.tradingDay, tradingDay));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: tradingDay,
                status: "complete",
                video_url: finalVideoUrl,
                hedra_asset_id: status.assetId,
                hedra_raw_url: status.videoUrl,
                bytes: upload.size,
                hedra_generation_id: generationId,
                next_step:
                  "Optional: call attach_briefing_video to surface this in the admin UI explicitly, though the briefing row is already updated.",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `poll_briefing_video_hedra failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "mux_briefing_audio") {
      try {
        const a = args as { trading_day?: string; higgsfield_video_url?: string };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        if (
          !a.higgsfield_video_url ||
          !/^https:\/\//i.test(a.higgsfield_video_url)
        ) {
          return {
            content: [
              {
                type: "text",
                text: "higgsfield_video_url is required and must be an https URL",
              },
            ],
            isError: true,
          };
        }
        const { swapBriefingAudio } = await import("@/lib/video-mux");
        const out = await swapBriefingAudio(tradingDay, a.higgsfield_video_url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: out.tradingDay,
                video_url: out.videoUrl,
                video_key: out.videoKey,
                bytes: out.bytes,
                duration_log: out.durationLog,
                next_step:
                  "Pass `video_url` to attach_briefing_video so the briefing row stores our muxed URL (not the Higgsfield URL).",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `mux_briefing_audio failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "attach_briefing_video") {
      try {
        const a = args as {
          trading_day?: string;
          higgsfield_job_id?: string;
          video_url?: string;
          thumbnail_url?: string;
        };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        if (!a.video_url) {
          return {
            content: [{ type: "text", text: "video_url is required" }],
            isError: true,
          };
        }
        const { briefings } = await import("@/lib/db/schema");
        const [existing] = await db
          .select()
          .from(briefings)
          .where(eq(briefings.tradingDay, tradingDay))
          .limit(1);
        if (!existing) {
          return {
            content: [
              {
                type: "text",
                text: `no briefing row for ${tradingDay}; run the script writer + voiceover first`,
              },
            ],
            isError: true,
          };
        }
        // First-time render flips each platform's publish state to
        // pending_review so the admin sees them in the approval queue. Never
        // overwrite a state that's already been touched.
        const platformInit: Record<string, unknown> = {};
        if (existing.ytStatus == null) platformInit.ytStatus = "pending_review";
        if (existing.ttStatus == null) platformInit.ttStatus = "pending_review";
        // Only OVERWRITE thumbnailUrl when this caller explicitly passed
        // a.thumbnail_url. Without this guard, an attach call from a routine
        // that doesn't know about thumbnails would null out the Higgsfield
        // Soul URL we captured during submit_briefing_video_via_hedra.
        const updateSet: Record<string, unknown> = {
          higgsfieldJobId: a.higgsfield_job_id ?? null,
          videoS3Key: a.video_url,
          status: "pending_upload",
          ...platformInit,
          updatedAt: sql`now()`,
        };
        if (a.thumbnail_url) updateSet.thumbnailUrl = a.thumbnail_url;

        const [row] = await db
          .update(briefings)
          .set(updateSet)
          .where(eq(briefings.tradingDay, tradingDay))
          .returning({
            id: briefings.id,
            tradingDay: briefings.tradingDay,
            status: briefings.status,
          });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: row.tradingDay,
                status: row.status,
                admin_url: "/admin/briefings",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `attach_briefing_video failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    // -----------------------------------------------------------------------
    // Weekly Earnings Brief — Sunday-morning 45-50s video (parallel pipeline
    // to the daily brief; writes to the `weekly_earnings_briefings` table).
    // -----------------------------------------------------------------------
    if (name === "publish_weekly_earnings_script") {
      try {
        const a = args as {
          week_anchor?: string;
          script?: string;
          setting_prompt?: string;
          tickers?: unknown;
        };
        const weekAnchor = a.week_anchor || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const script = (a.script ?? "").trim();
        const settingPrompt = (a.setting_prompt ?? "").trim();
        if (!script) {
          return {
            content: [{ type: "text", text: "script is required" }],
            isError: true,
          };
        }
        if (!settingPrompt) {
          return {
            content: [{ type: "text", text: "setting_prompt is required" }],
            isError: true,
          };
        }
        // Wider budget than daily — weekly is targeted at ~45s narration.
        const wordCount = script.split(/\s+/).filter(Boolean).length;
        if (wordCount < 60 || wordCount > 180) {
          return {
            content: [
              {
                type: "text",
                text: `script word count is ${wordCount}; budget is 80-130 (hard bounds 60-180). Tighten or expand and retry.`,
              },
            ],
            isError: true,
          };
        }
        // Normalize tickers: uppercase, trim, dedupe (case-insensitive), keep
        // first-occurrence order. Reject anything that isn't 1-6 alphanumeric
        // characters — protects against the writer pasting prose by mistake.
        if (!Array.isArray(a.tickers)) {
          return {
            content: [
              {
                type: "text",
                text: "tickers must be an array of uppercase ticker symbols (e.g. ['MRVL','DELL','AVGO'])",
              },
            ],
            isError: true,
          };
        }
        const seen = new Set<string>();
        const tickers: string[] = [];
        for (const raw of a.tickers) {
          if (typeof raw !== "string") continue;
          const t = raw.trim().toUpperCase();
          if (!/^[A-Z0-9.\-]{1,6}$/.test(t)) {
            return {
              content: [
                {
                  type: "text",
                  text: `invalid ticker "${raw}" — must be 1-6 uppercase letters/digits (dots and dashes allowed for things like BRK.B)`,
                },
              ],
              isError: true,
            };
          }
          if (!seen.has(t)) {
            seen.add(t);
            tickers.push(t);
          }
        }
        if (tickers.length > 12) {
          return {
            content: [
              {
                type: "text",
                text: `${tickers.length} tickers — cap is 12. Trim to the symbols actually narrated.`,
              },
            ],
            isError: true,
          };
        }
        const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
        const meta = {
          routine_name: "Weekly Earnings Brief — Script Writer",
          agent: "claude-mcp",
          word_count: wordCount,
          ticker_count: tickers.length,
        };
        const [row] = await db
          .insert(weeklyEarningsBriefings)
          .values({
            weekAnchor,
            script,
            settingPrompt,
            tickers,
            status: "scripted",
            meta,
          })
          .onConflictDoUpdate({
            target: weeklyEarningsBriefings.weekAnchor,
            set: {
              script,
              settingPrompt,
              tickers,
              status: "scripted",
              meta,
              updatedAt: sql`now()`,
            },
          })
          .returning({
            id: weeklyEarningsBriefings.id,
            weekAnchor: weeklyEarningsBriefings.weekAnchor,
            status: weeklyEarningsBriefings.status,
          });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                id: row.id,
                week_anchor: row.weekAnchor,
                status: row.status,
                word_count: wordCount,
                tickers,
                admin_url: "/admin/briefings/weekly",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_weekly_earnings_script failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_weekly_earnings_brief") {
      try {
        const a = args as { week_anchor?: string };
        const weekAnchor = a.week_anchor || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(weeklyEarningsBriefings)
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
          .limit(1);
        const payload = row
          ? {
              found: true,
              week_anchor: row.weekAnchor,
              script: row.script,
              setting_prompt: row.settingPrompt,
              tickers: row.tickers,
              status: row.status,
              youtube_video_id: row.youtubeVideoId,
              video_s3_key: row.videoS3Key,
              error_log: row.errorLog,
              posted_at: row.postedAt ? row.postedAt.toISOString() : null,
              created_at: row.createdAt.toISOString(),
            }
          : { found: false, week_anchor: weekAnchor };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `fetch_weekly_earnings_brief failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "generate_voiceover_for_weekly_earnings_brief") {
      try {
        const a = args as { week_anchor?: string; voice_id?: string };
        const weekAnchor = a.week_anchor || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const voiceId = a.voice_id || process.env.BRIEFING_VOICE_ID;
        if (!voiceId) {
          return {
            content: [
              {
                type: "text",
                text: "voice_id not provided and BRIEFING_VOICE_ID env var not set.",
              },
            ],
            isError: true,
          };
        }
        const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(weeklyEarningsBriefings)
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
          .limit(1);
        if (!row || !row.script) {
          return {
            content: [
              {
                type: "text",
                text: `no scripted weekly earnings brief for ${weekAnchor} — run publish_weekly_earnings_script first`,
              },
            ],
            isError: true,
          };
        }
        const { generateVoiceover, buildWeeklyEarningsAudioKey } = await import(
          "@/lib/elevenlabs"
        );
        const { putObject } = await import("@/lib/s3");
        const tts = await generateVoiceover(row.script, { voiceId });
        const key = buildWeeklyEarningsAudioKey(weekAnchor);
        const upload = await putObject(key, tts.buffer, tts.mimeType);
        const appUrl = process.env.APP_URL || "https://www.oliviatrades.com";
        const audioUrl = `${appUrl}/api/weekly-briefings/audio/${weekAnchor}`;
        const meta = {
          ...((row.meta as Record<string, unknown>) ?? {}),
          voiceover: {
            voice_id: voiceId,
            model_id: tts.modelId,
            char_count: tts.charCount,
            byte_size: upload.size,
            generated_at: new Date().toISOString(),
          },
        };
        await db
          .update(weeklyEarningsBriefings)
          .set({ status: "generating", meta, updatedAt: sql`now()` })
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                week_anchor: weekAnchor,
                audio_url: audioUrl,
                voice_id: voiceId,
                model_id: tts.modelId,
                char_count: tts.charCount,
                byte_size: upload.size,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        try {
          const a = args as { week_anchor?: string };
          const weekAnchor = a.week_anchor || nyTradingDay();
          if (/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
            const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
            const [row] = await db
              .select({ errorLog: weeklyEarningsBriefings.errorLog })
              .from(weeklyEarningsBriefings)
              .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
              .limit(1);
            if (row) {
              const errorLog = Array.isArray(row.errorLog) ? row.errorLog : [];
              errorLog.push({
                at: new Date().toISOString(),
                step: "generating",
                message: `voiceover failed: ${errMessage}`,
              });
              await db
                .update(weeklyEarningsBriefings)
                .set({ errorLog, updatedAt: sql`now()` })
                .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
            }
          }
        } catch (logErr) {
          console.error("[voiceover-weekly] failed to persist error breadcrumb", logErr);
        }
        return {
          content: [
            {
              type: "text",
              text: `generate_voiceover_for_weekly_earnings_brief failed: ${errMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "submit_weekly_earnings_video_via_hedra") {
      try {
        const a = args as {
          week_anchor?: string;
          soul_image_url?: string;
          text_prompt?: string;
          duration_ms?: number;
        };
        const weekAnchor = a.week_anchor || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        if (!a.soul_image_url || !/^https:\/\//i.test(a.soul_image_url)) {
          return {
            content: [
              { type: "text", text: "soul_image_url is required and must be an https URL" },
            ],
            isError: true,
          };
        }
        const { getObjectStream } = await import("@/lib/s3");
        const { buildWeeklyEarningsAudioKey } = await import("@/lib/elevenlabs");
        const audioObj = await getObjectStream(buildWeeklyEarningsAudioKey(weekAnchor));
        if (!audioObj) {
          return {
            content: [
              {
                type: "text",
                text: `no audio in bucket for ${weekAnchor} — run generate_voiceover_for_weekly_earnings_brief first`,
              },
            ],
            isError: true,
          };
        }
        const audioChunks: Uint8Array[] = [];
        const audioReader = audioObj.body.getReader();
        for (;;) {
          const { value, done } = await audioReader.read();
          if (done) break;
          if (value) audioChunks.push(value);
        }
        const audioBytes = Buffer.concat(audioChunks.map((c) => Buffer.from(c)));

        const imgRes = await fetch(a.soul_image_url);
        if (!imgRes.ok) {
          return {
            content: [
              { type: "text", text: `Failed to fetch Soul image: ${imgRes.status}` },
            ],
            isError: true,
          };
        }
        const imageBytes = Buffer.from(await imgRes.arrayBuffer());
        const imageContentType = imgRes.headers.get("content-type") || "image/png";

        const { submitHedraGeneration } = await import("@/lib/hedra");
        // 55s default — weekly script lands ~45s, gives Hedra runway before
        // the outro pipeline trims at narration end + appends the card.
        const submission = await submitHedraGeneration({
          imageBytes,
          imageContentType,
          audioBytes,
          audioContentType: audioObj.contentType || "audio/mpeg",
          textPrompt: a.text_prompt,
          durationMs: a.duration_ms ?? 55000,
          aspectRatio: "9:16",
          resolution: "720p",
        });

        const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
        const [existing] = await db
          .select()
          .from(weeklyEarningsBriefings)
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
          .limit(1);
        const meta = {
          ...((existing?.meta as Record<string, unknown>) ?? {}),
          hedra: {
            generation_id: submission.generationId,
            image_asset_id: submission.imageAssetId,
            audio_asset_id: submission.audioAssetId,
            submitted_at: new Date().toISOString(),
            submit_elapsed_ms: submission.elapsedMs,
          },
        };
        await db
          .update(weeklyEarningsBriefings)
          .set({
            status: "generating",
            videoS3Key: null,
            // Same as the daily path — capture Higgsfield Soul PNG as poster.
            thumbnailUrl: a.soul_image_url,
            meta,
            updatedAt: sql`now()`,
          })
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                week_anchor: weekAnchor,
                hedra_generation_id: submission.generationId,
                submit_elapsed_ms: submission.elapsedMs,
                next_step: "Call poll_weekly_earnings_video_hedra every ~30s until complete.",
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `submit_weekly_earnings_video_via_hedra failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "poll_weekly_earnings_video_hedra") {
      try {
        const a = args as { week_anchor?: string; force_remirror?: boolean };
        const weekAnchor = a.week_anchor || nyTradingDay();
        const forceRemirror = a.force_remirror === true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { weeklyEarningsBriefings } = await import("@/lib/db/schema");
        const [row] = await db
          .select()
          .from(weeklyEarningsBriefings)
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor))
          .limit(1);
        if (!row) {
          return {
            content: [{ type: "text", text: `no weekly earnings brief row for ${weekAnchor}` }],
            isError: true,
          };
        }
        const appUrl = process.env.APP_URL || "https://www.oliviatrades.com";
        const meta = (row.meta as Record<string, unknown>) ?? {};
        const hedraMeta = (meta.hedra as Record<string, unknown>) ?? {};
        const generationId = hedraMeta.generation_id as string | undefined;
        const mirroredGenerationId = hedraMeta.mirrored_generation_id as string | undefined;
        // Cache hit: serve mirrored URL when it matches the current generation.
        // `force_remirror=true` bypasses to re-pull the existing Hedra
        // generation through the outro pipeline (no new generation cost).
        if (
          !forceRemirror &&
          row.videoS3Key &&
          row.videoS3Key.startsWith(appUrl) &&
          generationId &&
          mirroredGenerationId === generationId
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  week_anchor: weekAnchor,
                  status: "complete",
                  video_url: row.videoS3Key,
                  cached: true,
                  hedra_generation_id: generationId,
                }),
              },
            ],
            isError: false,
          };
        }
        if (!generationId) {
          return {
            content: [
              {
                type: "text",
                text: `no hedra.generation_id on weekly earnings brief ${weekAnchor} — run submit_weekly_earnings_video_via_hedra first`,
              },
            ],
            isError: true,
          };
        }
        const { checkHedraStatus } = await import("@/lib/hedra");
        const status = await checkHedraStatus(generationId);
        if (status.status === "in_progress") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  week_anchor: weekAnchor,
                  status: "in_progress",
                  raw_status: status.rawStatus,
                  progress: status.progress,
                  eta_sec: status.etaSec,
                  hedra_generation_id: generationId,
                  next_step: "Call again in ~15-30 seconds.",
                }),
              },
            ],
            isError: false,
          };
        }
        if (status.status === "failed") {
          const errorLog = Array.isArray(row.errorLog) ? row.errorLog : [];
          errorLog.push({
            at: new Date().toISOString(),
            step: "generating",
            message: `Hedra generation failed: ${status.errorMessage ?? status.rawStatus}`,
            detail: { hedra_generation_id: generationId, raw_status: status.rawStatus },
          });
          await db
            .update(weeklyEarningsBriefings)
            .set({ status: "failed", errorLog, updatedAt: sql`now()` })
            .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  week_anchor: weekAnchor,
                  status: "failed",
                  raw_status: status.rawStatus,
                  error_message: status.errorMessage,
                  hedra_generation_id: generationId,
                }),
              },
            ],
            isError: false,
          };
        }
        if (!status.videoUrl) {
          return {
            content: [{ type: "text", text: "Hedra reports complete but no video URL" }],
            isError: true,
          };
        }
        const videoRes = await fetch(status.videoUrl);
        if (!videoRes.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch finished Hedra video: ${videoRes.status}`,
              },
            ],
            isError: true,
          };
        }
        const { putObject } = await import("@/lib/s3");
        const {
          buildWeeklyEarningsVideoKey,
          applyOutroCard,
          swapWeeklyEarningsAudio,
        } = await import("@/lib/video-mux");
        const { buildWeeklyEarningsAudioKey } = await import("@/lib/elevenlabs");

        // Step 1: swap Hedra's audio for our voiceover + BGM mix.
        // (Mirrors the daily briefing pipeline so weekly earnings videos
        // get the same background-music treatment.)
        let videoBuf: Buffer;
        try {
          const { getObjectStream: bucketGet } = await import("@/lib/s3");
          const swapped = await swapWeeklyEarningsAudio(
            weekAnchor,
            status.videoUrl,
          );
          // The swap uploaded to bucket; download it back for the outro step.
          const swappedObj = await bucketGet(swapped.videoKey);
          if (!swappedObj) throw new Error("swap result missing from bucket");
          const chunks: Buffer[] = [];
          const reader = swappedObj.body.getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) chunks.push(Buffer.from(value));
          }
          videoBuf = Buffer.concat(chunks);
        } catch (swapErr) {
          console.error(
            "[hedra-poll-weekly] audio swap failed, using Hedra audio",
            swapErr,
          );
          // Fall back to Hedra's audio if swap fails.
          videoBuf = Buffer.from(await videoRes.arrayBuffer());
        }

        // Step 2: outro card with continued BGM under the OliviaTrades.com hold.
        let outputBuf: Buffer = videoBuf;
        try {
          outputBuf = await applyOutroCard(
            videoBuf,
            buildWeeklyEarningsAudioKey(weekAnchor),
          );
        } catch (outroErr) {
          console.error("[hedra-poll-weekly] outro failed, mirroring raw clip", outroErr);
        }
        const videoKey = buildWeeklyEarningsVideoKey(weekAnchor);
        const upload = await putObject(videoKey, new Uint8Array(outputBuf), "video/mp4");
        const finalVideoUrl = `${appUrl}/api/weekly-briefings/video/${weekAnchor}`;
        const updatedMeta = {
          ...meta,
          hedra: {
            ...hedraMeta,
            mirrored_generation_id: generationId,
            mirrored_at: new Date().toISOString(),
            mirrored_bytes: upload.size,
          },
        };
        const platformInit: Record<string, unknown> = {};
        if (row.ytStatus == null) platformInit.ytStatus = "pending_review";
        if (row.ttStatus == null) platformInit.ttStatus = "pending_review";
        await db
          .update(weeklyEarningsBriefings)
          .set({
            status: "pending_upload",
            videoS3Key: finalVideoUrl,
            higgsfieldJobId: generationId,
            meta: updatedMeta,
            ...platformInit,
            updatedAt: sql`now()`,
          })
          .where(eq(weeklyEarningsBriefings.weekAnchor, weekAnchor));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                week_anchor: weekAnchor,
                status: "complete",
                video_url: finalVideoUrl,
                hedra_generation_id: generationId,
                bytes: upload.size,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `poll_weekly_earnings_video_hedra failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_briefing_to_youtube") {
      try {
        const a = args as {
          trading_day?: string;
          privacy?: "public" | "unlisted" | "private";
          is_short?: boolean;
        };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { publishBriefingToYouTube } = await import("@/lib/briefing-publish");
        // Cron path → requireApproved true: only publish admin-approved rows.
        const r = await publishBriefingToYouTube(tradingDay, {
          privacy: a.privacy ?? "public",
          isShort: a.is_short ?? true,
          requireApproved: true,
        });
        if (!r.ok) {
          return { content: [{ type: "text", text: r.error ?? "publish failed" }], isError: true };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: r.tradingDay,
                status: r.status,
                youtube_video_id: r.youtubeVideoId,
                watch_url: r.watchUrl,
                privacy_status: r.privacyStatus,
                elapsed_ms: r.elapsedMs,
                bytes_uploaded: r.bytesUploaded,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_briefing_to_youtube failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_briefing_to_tiktok") {
      try {
        const a = args as { trading_day?: string };
        const tradingDay = a.trading_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDay)) {
          return {
            content: [{ type: "text", text: "trading_day must be YYYY-MM-DD" }],
            isError: true,
          };
        }
        const { publishBriefingToTikTok } = await import("@/lib/briefing-publish");
        const { TIKTOK_AI_DISCLOSURE_REMINDER } = await import("@/lib/tiktok");
        const r = await publishBriefingToTikTok(tradingDay, { requireApproved: true });
        if (!r.ok) {
          return { content: [{ type: "text", text: r.error ?? "publish failed" }], isError: true };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                trading_day: r.tradingDay,
                status: r.status,
                tt_publish_id: r.ttPublishId,
                elapsed_ms: r.elapsedMs,
                bytes_uploaded: r.bytesUploaded,
                note: r.note,
                ai_disclosure_reminder: TIKTOK_AI_DISCLOSURE_REMINDER,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_briefing_to_tiktok failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_weekly_to_youtube") {
      try {
        const a = args as {
          week_anchor?: string;
          privacy?: "public" | "unlisted" | "private";
          is_short?: boolean;
        };
        const weekAnchor = a.week_anchor;
        if (!weekAnchor || !/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor (YYYY-MM-DD) is required" }],
            isError: true,
          };
        }
        const { publishWeeklyEarningsToYouTube } = await import(
          "@/lib/weekly-earnings-publish"
        );
        // Cron path → requireApproved true: only publish admin-approved rows.
        const r = await publishWeeklyEarningsToYouTube(weekAnchor, {
          privacy: a.privacy ?? "public",
          isShort: a.is_short ?? true,
          requireApproved: true,
        });
        if (!r.ok) {
          return { content: [{ type: "text", text: r.error ?? "publish failed" }], isError: true };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                week_anchor: r.weekAnchor,
                status: r.status,
                youtube_video_id: r.youtubeVideoId,
                watch_url: r.watchUrl,
                privacy_status: r.privacyStatus,
                elapsed_ms: r.elapsedMs,
                bytes_uploaded: r.bytesUploaded,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_weekly_to_youtube failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_weekly_to_tiktok") {
      try {
        const a = args as { week_anchor?: string };
        const weekAnchor = a.week_anchor;
        if (!weekAnchor || !/^\d{4}-\d{2}-\d{2}$/.test(weekAnchor)) {
          return {
            content: [{ type: "text", text: "week_anchor (YYYY-MM-DD) is required" }],
            isError: true,
          };
        }
        const { publishWeeklyEarningsToTikTok } = await import(
          "@/lib/weekly-earnings-publish"
        );
        const { TIKTOK_AI_DISCLOSURE_REMINDER } = await import("@/lib/tiktok");
        const r = await publishWeeklyEarningsToTikTok(weekAnchor, { requireApproved: true });
        if (!r.ok) {
          return { content: [{ type: "text", text: r.error ?? "publish failed" }], isError: true };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                week_anchor: r.weekAnchor,
                status: r.status,
                tt_publish_id: r.ttPublishId,
                elapsed_ms: r.elapsedMs,
                bytes_uploaded: r.bytesUploaded,
                note: r.note,
                ai_disclosure_reminder: TIKTOK_AI_DISCLOSURE_REMINDER,
              }),
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `publish_weekly_to_tiktok failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_quote") {
      try {
        const out = await fetchQuotes(args as unknown as FetchQuoteArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_quote failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_option_contract") {
      try {
        const out = await fetchOptionContract(args as unknown as FetchOptionContractArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_option_contract failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_bars") {
      try {
        const out = await fetchBars(args as unknown as FetchBarsArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_bars failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_options_snapshot") {
      try {
        const snap = await fetchOptionsSnapshot(args as unknown as FetchSnapshotArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(snap) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_options_snapshot failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "get_max_pain_yesterday") {
      try {
        const data = await getMaxPainYesterday();
        return {
          content: [
            { type: "text", text: data ? JSON.stringify(data) : "null" },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `get_max_pain_yesterday failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_max_pain_scan") {
      try {
        const out = await publishMaxPain(args as unknown as MaxPainArgs);
        return {
          content: [
            {
              type: "text",
              text: `Max-pain chunk (${out.mode}) written for ${out.scan_day}. cumulative tickers=${out.tickers_count}, alerts=${out.alerts_count}.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_max_pain_scan failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "upload_research_image") {
      try {
        const out = await uploadResearchImage(args as unknown as UploadResearchImageArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `upload_research_image failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_research") {
      try {
        const out = await publishResearch(args as unknown as PublishResearchArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published research for ${out.ticker} on ${out.scan_day} → ${out.url}. body=${out.body_chars} chars, ${out.images_count} images.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_research failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_metals_research") {
      try {
        const out = await publishMetalsResearch(args as unknown as PublishResearchArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published metals research for ${out.ticker} on ${out.scan_day} → ${out.url}. body=${out.body_chars} chars, ${out.images_count} images.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_metals_research failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_quantum_research") {
      try {
        const out = await publishQuantumResearch(args as unknown as PublishResearchArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published quantum research for ${out.ticker} on ${out.scan_day} → ${out.url}. body=${out.body_chars} chars, ${out.images_count} images.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_quantum_research failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_sec_fundamentals") {
      try {
        const { fetchSecFundamentals } = await import("@/lib/sec-edgar");
        const ticker = String((args as { ticker?: string }).ticker || "").trim();
        if (!ticker) {
          return { content: [{ type: "text", text: "ticker required" }], isError: true };
        }
        const out = await fetchSecFundamentals(ticker);
        if (!out) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  found: false,
                  ticker: ticker.toUpperCase(),
                  reason:
                    "ticker not in SEC EDGAR (foreign filer 20-F, OTC, or unknown). Skip fundamentals for this ticker; do technical-only analysis.",
                }),
              },
            ],
            isError: false,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ found: true, ...out }) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_sec_fundamentals failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "scan_options_edge") {
      try {
        const { scanOptionsEdgeUniverse } = await import("@/lib/iv-analysis");
        const full = await scanOptionsEdgeUniverse();
        // Trim the response down to what the publishing routine actually
        // consumes — rankedAnomalies + summary stats. The full byTicker
        // analyses (current metrics + 1-year series + per-ticker
        // anomaly lists) blow the agent's context budget; the routine
        // only needs the rankedAnomalies array to call
        // publish_options_edge_scan. Per-ticker detail is recomputable
        // on the page render side.
        const out = {
          scanDate: full.scanDate,
          universeSize: full.universeSize,
          rankedAnomalies: full.rankedAnomalies,
          // Compact per-ticker summary — drops the full 1-year series
          // and individual anomaly objects but KEEPS the current metric
          // percentiles. The routine uses these to write the regime
          // paragraph ("most names sit in normal ranges" / "leaning
          // sell-vol" etc.) without needing the full byTicker payload.
          tickerSummary: full.byTicker.map((t) => ({
            ticker: t.ticker,
            observations: t.observations,
            anomalyCount: t.anomalies.length,
            // Current metric snapshot — percentiles only (numeric 0..100)
            // so the routine can quickly read "is this ticker stretched
            // or normal" without parsing z-scores.
            percentiles: {
              atmIvRank: t.metrics.atm_iv_rank.percentile,
              skew: t.metrics.skew_z.percentile,
              termSlope: t.metrics.term_z.percentile,
              ivHvRatio: t.metrics.iv_hv_ratio.percentile,
            },
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `scan_options_edge failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "publish_options_edge_scan") {
      try {
        const a = args as {
          scan_day?: string;
          title?: string;
          summary?: string;
          anomalies?: unknown;
          universe_size?: number;
        };
        const scanDay = a.scan_day || nyTradingDay();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scanDay)) {
          return { content: [{ type: "text", text: "scan_day must be YYYY-MM-DD" }], isError: true };
        }
        if (!a.title) return { content: [{ type: "text", text: "title is required" }], isError: true };
        if (!a.summary) return { content: [{ type: "text", text: "summary is required" }], isError: true };
        if (!Array.isArray(a.anomalies)) return { content: [{ type: "text", text: "anomalies must be an array" }], isError: true };
        const { optionsEdgeScans } = await import("@/lib/db/schema");
        const meta = {
          routine_name: "Options Edge — Weekly Scan",
          agent: "claude-mcp",
          anomaly_count: a.anomalies.length,
        };
        const [row] = await db
          .insert(optionsEdgeScans)
          .values({
            scanDay,
            title: a.title,
            summary: a.summary,
            anomalies: a.anomalies as never,
            universeSize: a.universe_size ?? 0,
            runAt: new Date(),
            meta,
          })
          .onConflictDoUpdate({
            target: optionsEdgeScans.scanDay,
            set: {
              title: a.title,
              summary: a.summary,
              anomalies: a.anomalies as never,
              universeSize: a.universe_size ?? 0,
              runAt: new Date(),
              meta,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: optionsEdgeScans.id, scanDay: optionsEdgeScans.scanDay });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              id: row.id,
              scan_day: row.scanDay,
              url: `/research/options-edge/${row.scanDay}`,
            }),
          }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `publish_options_edge_scan failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "publish_insider_scan") {
      try {
        const out = await publishInsider(args as unknown as InsiderArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published insider scan to ${out.url} for scan day ${out.scan_day}. ${out.buys_count} qualifying buys recorded.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_insider_scan failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_crypto_quote") {
      try {
        const out = await fetchCryptoQuoteForRoutine(args as unknown as FetchCryptoQuoteArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `fetch_crypto_quote failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "fetch_crypto_bars") {
      try {
        const out = await fetchCryptoBarsForRoutine(args as unknown as FetchCryptoBarsArgs);
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `fetch_crypto_bars failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "publish_crypto_research") {
      try {
        const out = await publishCryptoResearch(args as unknown as PublishCryptoResearchArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published crypto research for ${out.scan_day} → ${out.url}. body=${out.body_chars} chars, ${out.trades_count} trades.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `publish_crypto_research failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "publish_crypto_weekly_research") {
      try {
        const out = await publishCryptoWeeklyResearch(args as unknown as PublishCryptoWeeklyResearchArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published crypto weekly research for ${out.ticker} on ${out.scan_day} → ${out.url}. body=${out.body_chars} chars, ${out.images_count} images.`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `publish_crypto_weekly_research failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "publish_economic_calendar") {
      try {
        const out = await publishEconomicCalendar(args as unknown as PublishEconomicCalendarArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published economic calendar: ${out.inserted} inserted, ${out.updated} updated → ${out.url}`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `publish_economic_calendar failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    if (name === "get_institutional_funds") {
      try {
        const out = await getInstitutionalFundsList();
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `get_institutional_funds failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_13f_holdings") {
      try {
        const a = args as { cik?: string | number; num_quarters?: number };
        if (a.cik == null || a.cik === "") {
          return {
            content: [{ type: "text", text: "cik is required (10-digit CIK string or number)" }],
            isError: true,
          };
        }
        const out = await fetch13FHoldings(a.cik, {
          numQuarters: a.num_quarters,
        });
        // Inline summary for the model — total holdings count per filing —
        // so it can sanity-check before consuming the JSON.
        const summary = out.filings
          .map(
            (f) =>
              `${f.filingDate} (period ${f.reportDate ?? "?"}): ${f.holdings.length} holdings`,
          )
          .join(", ") || "no 13F-HR filings found";
        return {
          content: [
            {
              type: "text",
              text: `${out.fundName} (CIK ${out.cik}) — ${summary}\n\n${JSON.stringify(out)}`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `fetch_13f_holdings failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_institutional_research") {
      try {
        const out = await publishInstitutionalResearch(args as unknown as PublishInstitutionalArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published institutional scan for ${out.scan_day}: ${out.stocks} stocks → ${out.url}`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_institutional_research failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_earnings_whiplash") {
      try {
        const a = args as { scan_day?: string };
        const { earningsPosts } = await import("@/lib/db/schema");
        const { desc } = await import("drizzle-orm");
        let row;
        if (a.scan_day) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(a.scan_day)) {
            return {
              content: [{ type: "text", text: "scan_day must be YYYY-MM-DD" }],
              isError: true,
            };
          }
          [row] = await db
            .select()
            .from(earningsPosts)
            .where(eq(earningsPosts.scanDay, a.scan_day))
            .limit(1);
        } else {
          [row] = await db
            .select()
            .from(earningsPosts)
            .orderBy(desc(earningsPosts.scanDay))
            .limit(1);
        }
        const payload = row
          ? {
              found: true,
              scan_day: row.scanDay,
              summary: row.summary,
              methodology: row.methodology,
              stocks: row.stocks,
              run_at: row.runAt ? row.runAt.toISOString() : null,
              created_at: row.createdAt.toISOString(),
            }
          : { found: false };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `fetch_earnings_whiplash failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "fetch_latest_earnings_scan") {
      try {
        const a = args as { scan_week?: string };
        const { earningsScans } = await import("@/lib/db/schema");
        const { desc } = await import("drizzle-orm");
        let row;
        if (a.scan_week) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(a.scan_week)) {
            return {
              content: [{ type: "text", text: "scan_week must be YYYY-MM-DD" }],
              isError: true,
            };
          }
          [row] = await db
            .select()
            .from(earningsScans)
            .where(eq(earningsScans.scanWeek, a.scan_week))
            .limit(1);
        } else {
          [row] = await db
            .select()
            .from(earningsScans)
            .orderBy(desc(earningsScans.scanWeek))
            .limit(1);
        }
        const payload = row
          ? {
              found: true,
              scan_week: row.scanWeek,
              universe_size: row.universeSize,
              computed_size: row.computedSize,
              covered_from: row.data?.coveredFrom ?? null,
              covered_to: row.data?.coveredTo ?? null,
              tickers: row.data?.tickers ?? [],
              run_at: row.runAt ? row.runAt.toISOString() : null,
            }
          : { found: false };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `fetch_latest_earnings_scan failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_earnings_whiplash") {
      try {
        const out = await publishEarningsWhiplash(args as unknown as PublishEarningsArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published earnings whiplash scan for ${out.scan_day}: ${out.stocks} stocks (${out.flagged} flagged asymmetric) → ${out.url}`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_earnings_whiplash failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    if (name === "publish_sector_rotation") {
      try {
        const out = await publishSectorRotation(args as unknown as PublishSectorRotationArgs);
        return {
          content: [
            {
              type: "text",
              text: `Published sector rotation scan for ${out.scan_day}: ${out.sectors} sectors (${out.rotating} rotating) → ${out.url}`,
            },
          ],
          isError: false,
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `publish_sector_rotation failed: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  if (method === "ping") {
    return {};
  }
  // Notifications (initialized, cancelled, etc.) we just acknowledge silently.
  if (method.startsWith("notifications/")) {
    return null;
  }
  throw new Error(`Method not found: ${method}`);
}

// publicUrlFor is used by lib/s3.ts internally (re-exported for completeness);
// keep the reference live for tree-shaking safety in case future tools need it.
void publicUrlFor;
void and;

// ----------- HTTP handlers ------------------------------------------------

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.MCP_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  // Notification (no id): JSON-RPC 2.0 says return 202 Accepted with no body.
  if (body.id === undefined || body.id === null) {
    try {
      await dispatch(body.method, body.params);
    } catch {
      // notifications swallow errors
    }
    return new Response(null, { status: 202 });
  }

  // Request: return JSON-RPC response.
  try {
    const result = await dispatch(body.method, body.params);
    return NextResponse.json(
      { jsonrpc: "2.0", id: body.id, result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    const code = message.startsWith("Method not found") ? -32601 : -32603;
    return NextResponse.json(
      { jsonrpc: "2.0", id: body.id, error: { code, message } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.MCP_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  // We don't implement server→client SSE; signal that.
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, DELETE" },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const expected = process.env.MCP_TOKEN;
  if (!expected || token !== expected) return unauthorized();

  // Stateless server — clients can "close" sessions but there's nothing to clean up.
  return new Response(null, { status: 200 });
}
